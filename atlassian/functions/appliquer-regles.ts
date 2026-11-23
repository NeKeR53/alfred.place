import { ai, db, functions, shell } from "@alfred/sdk";
import { analyserRegle, instructionAgent, lireTags, OUTILS_AGENT, type Regle, type TicketRegle } from "../lib/regles";

/** Au plus trois agents lancés par règle à chaque passage : les suivants attendent le passage d’après. */
const AGENTS_PAR_PASSAGE = 3;

interface Compte {
  id: string;
  label: string;
}

interface Fait {
  regle: string;
  compte: string;
  cle: string;
  titre: string;
  action: string;
  statut: "fait" | "echec" | "prevu";
  detail: string;
}

async function lancerAgent(regle: Regle, compte: string, ticket: TicketRegle) {
  const lancement = ai.startAgent({
    title: `${regle.nom} · ${ticket.cle}`,
    instruction: instructionAgent(regle.consigne, ticket.cle, compte),
    context: ticket,
    functions: OUTILS_AGENT,
  });
  // La conversation continue dans la page Agent : on n’attend que de savoir qu’elle a bien démarré.
  await Promise.race([lancement, new Promise((resoudre) => setTimeout(resoudre, 5000))]);
  lancement.catch(() => undefined);
}

/**
 * Applique les règles Jira : pour chaque compte, cherche les tickets qui remplissent les critères de chaque règle
 * automatique (ou de la règle demandée), pose sa question s’il y en a une, puis fait son action une fois par ticket.
 * Au premier passage d’une règle automatique, les tickets déjà là sont notés sans rien faire : seuls ceux qui arrivent ensuite déclenchent l’action.
 */
export default async function ({
  regle: seule,
  simulation = false,
}: {
  regle?: string;
  simulation?: boolean;
}) {
  const manuel = Boolean(seule);
  const regles = await db.query<Regle>(
    manuel
      ? "SELECT * FROM atlassian_regles WHERE id = ?"
      : "SELECT * FROM atlassian_regles WHERE active = 1 AND automatique = 1",
    manuel ? [seule] : [],
  );
  if (manuel && regles.length === 0) throw new Error("Cette règle n’existe plus.");
  if (regles.length === 0) return { regles: 0, actions: [] as Fait[], simulation };

  const { comptes } = await functions.call<{ comptes: Compte[] }>("comptes-jira");
  const faits: Fait[] = [];

  for (const compte of Array.isArray(comptes) ? comptes : []) {
    const referentiels = await functions
      .call<{ moi: { id: string } | null }>("lister-referentiels", { instance: compte.id })
      .catch(() => ({ moi: null }));
    const moi = referentiels.moi?.id ?? null;

    for (const regle of regles) {
      const { vue, criteres } = analyserRegle(lireTags(regle.criteres));
      const { tickets } = await functions.call<{ tickets: TicketRegle[] }>("lister-tickets", {
        instance: compte.id,
        ...criteres,
        vue,
        tri: "maj",
        limite: 50,
      });
      const candidats = Array.isArray(tickets) ? tickets : [];
      const retenus: TicketRegle[] = [];
      for (let debut = 0; debut < candidats.length; debut += 10) {
        const lot = candidats.slice(debut, debut + 10);
        const { resultats } = await functions.call<{ resultats: Array<{ cle: string; regles: Array<{ id: string }> }> }>(
          "evaluer-regles",
          { instance: compte.id, moi, tickets: lot, regle: regle.id },
        );
        for (const r of resultats) {
          if (r.regles.some((x) => x.id === regle.id)) {
            const ticket = lot.find((t) => t.cle === r.cle);
            if (ticket) retenus.push(ticket);
          }
        }
      }

      const marque = `regles.init.${regle.id}.${compte.id}`;
      const [initialisee] = await db.query<{ valeur: string }>("SELECT valeur FROM atlassian_reglages WHERE cle = ?", [marque]);
      const deja = new Set(
        (
          await db.query<{ cle: string }>("SELECT cle FROM atlassian_regles_executions WHERE regle = ? AND instance = ?", [
            regle.id,
            compte.id,
          ])
        ).map((ligne) => ligne.cle),
      );
      const nouveaux = retenus.filter((ticket) => !deja.has(ticket.cle));

      if (!manuel && !initialisee) {
        // Premier passage : ce qui existait déjà n’est pas traité.
        if (!simulation) {
          for (const ticket of nouveaux) {
            await db.execute(
              "INSERT OR IGNORE INTO atlassian_regles_executions (regle, instance, cle, statut, detail) VALUES (?, ?, ?, 'ignore', 'Déjà présent à la création de la règle')",
              [regle.id, compte.id, ticket.cle],
            );
          }
          await db.execute("INSERT OR REPLACE INTO atlassian_reglages (cle, valeur) VALUES (?, datetime('now'))", [marque]);
        }
        continue;
      }

      const aPrevenir: TicketRegle[] = [];
      let agents = 0;
      for (const ticket of nouveaux) {
        const base = { regle: regle.nom, compte: compte.label, cle: ticket.cle, titre: ticket.titre, action: regle.action };
        if (simulation) {
          faits.push({ ...base, statut: "prevu", detail: "" });
          continue;
        }
        if (regle.action === "agent" && agents >= AGENTS_PAR_PASSAGE) continue;
        let statut: "fait" | "echec" = "fait";
        let detail = "";
        try {
          if (regle.action === "agent") {
            agents += 1;
            await lancerAgent(regle, compte.id, ticket);
            detail = "Agent lancé";
          } else if (regle.action === "commenter") {
            await functions.call("commenter-ticket", { instance: compte.id, cle: ticket.cle, texte: regle.consigne });
            detail = "Commentaire ajouté";
          } else {
            aPrevenir.push(ticket);
            detail = "Prévenu";
          }
        } catch (erreur) {
          statut = "echec";
          detail = (erreur as Error).message;
        }
        await db.execute(
          `INSERT INTO atlassian_regles_executions (regle, instance, cle, statut, detail) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(regle, instance, cle) DO UPDATE SET statut = excluded.statut, detail = excluded.detail, quand = datetime('now')`,
          [regle.id, compte.id, ticket.cle, statut, detail],
        );
        faits.push({ ...base, statut, detail });
      }
      if (!simulation) {
        await db.execute("INSERT OR REPLACE INTO atlassian_reglages (cle, valeur) VALUES (?, datetime('now'))", [marque]);
      }

      if (aPrevenir.length > 0) {
        await shell.notify({
          title:
            aPrevenir.length === 1
              ? `Règle « ${regle.nom} » : ${aPrevenir[0].cle}`
              : `Règle « ${regle.nom} » : ${aPrevenir.length} tickets`,
          description: [regle.consigne.trim(), ...aPrevenir.slice(0, 3).map((t) => `${t.cle} : ${t.titre}`)]
            .filter(Boolean)
            .join("\n"),
          tone: "info",
        });
      }
    }
  }
  return { regles: regles.length, actions: faits, simulation };
}
