import { ai, db } from "@alfred/sdk";
import { erreurDecision } from "../lib/ia";
import { correspond, lireTags, type Regle, type TicketRegle } from "../lib/regles";

interface Reponse {
  answer?: boolean | string;
  probability?: number;
  confidence?: number;
}

/** Pose la question d’une règle sur un ticket, sur l’ordinateur ; la réponse est gardée tant que rien ne change. */
async function trancher(regle: Regle, instance: string, ticket: TicketRegle) {
  const empreinte = `${ticket.misAJour ?? ""}|${regle.maj_le}`;
  const [connue] = await db.query<{ empreinte: string; oui: number; confiance: number }>(
    "SELECT empreinte, oui, confiance FROM atlassian_regles_decisions WHERE regle = ? AND instance = ? AND cle = ?",
    [regle.id, instance, ticket.cle],
  );
  if (connue && connue.empreinte === empreinte) return { oui: connue.oui === 1, confiance: connue.confiance };

  let reponse: Reponse;
  try {
    const { answers } = (await ai.decide({
      text: {
        ticket: `${ticket.cle} : ${ticket.titre}`,
        type: ticket.type ?? "",
        priorite: ticket.priorite ?? "",
        etat: ticket.statut ?? "",
        etiquettes: (ticket.etiquettes ?? []).join(", "),
        description: (ticket.description ?? "").slice(0, 2500),
      },
      questions: { regle: { type: "yesno", question: regle.question } },
    })) as { answers: Record<string, Reponse> };
    reponse = answers.regle ?? {};
  } catch (erreur) {
    throw erreurDecision(erreur);
  }
  const oui = reponse.answer === true || reponse.answer === "yes" || (reponse.probability ?? 0) > 0.5;
  const confiance = Number(reponse.confidence ?? 0);
  await db.execute(
    `INSERT INTO atlassian_regles_decisions (regle, instance, cle, empreinte, oui, confiance) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(regle, instance, cle) DO UPDATE SET empreinte = excluded.empreinte, oui = excluded.oui, confiance = excluded.confiance`,
    [regle.id, instance, ticket.cle, empreinte, oui ? 1 : 0, confiance],
  );
  return { oui, confiance };
}

/** Règles actives auxquelles chaque ticket correspond : critères d’abord, puis la question de la règle s’il y en a une. */
export default async function ({
  instance = "",
  moi = null,
  tickets = [],
  regle: seule,
}: {
  instance?: string;
  moi?: string | null;
  tickets?: TicketRegle[];
  regle?: string;
}) {
  const regles = await db.query<Regle>(
    seule
      ? "SELECT * FROM atlassian_regles WHERE id = ?"
      : "SELECT * FROM atlassian_regles WHERE active = 1 ORDER BY nom",
    seule ? [seule] : [],
  );
  const resultats: Array<{ cle: string; regles: Array<{ id: string; nom: string; action: string; aVerifier: boolean }> }> = [];
  for (const ticket of (Array.isArray(tickets) ? tickets : []).slice(0, 10)) {
    const trouvees = [];
    for (const regle of regles) {
      if (!correspond(ticket, lireTags(regle.criteres), moi)) continue;
      let aVerifier = false;
      if (regle.question.trim()) {
        const { oui, confiance } = await trancher(regle, instance, ticket);
        if (!oui) continue;
        aVerifier = confiance < 0.8;
      }
      trouvees.push({ id: regle.id, nom: regle.nom, action: regle.action, aVerifier });
    }
    resultats.push({ cle: ticket.cle, regles: trouvees });
  }
  return { resultats };
}
