import { db } from "@alfred/sdk";
import { jugerTicket } from "../lib/ia";

interface TicketAJuger {
  cle: string;
  titre: string;
  description?: string;
  type?: string;
  priorite?: string;
  misAJour?: string | null;
  dernierCommentaire?: string;
}

// Seuil de certitude sous lequel l’utilisateur tranche (règle du garde-fou incluse).
/** Sous ce seuil de certitude, l’utilisateur tranche. */
const SEUIL = 0.8;

/**
 * Criticité de tickets Jira (critique, important, normal, faible), jugée sur l’ordinateur.
 * Un ticket déjà jugé et inchangé depuis n’est pas relu. Sous 0,8 de certitude, il est « à vérifier ».
 */
export default async function ({
  instance = "",
  tickets = [],
  complet = false,
}: {
  instance?: string;
  tickets?: TicketAJuger[];
  /** Avec les signaux (urgent, bloquant, agacement) : plus lent, pour un ticket ouvert. */
  complet?: boolean;
}) {
  const resultats = [];
  for (const ticket of tickets.slice(0, 5)) {
    const base = `${ticket.titre}|${ticket.misAJour ?? ""}|${ticket.priorite ?? ""}`;
    const empreinte = complet ? `${base}#complet` : base;
    const [connu] = await db.query<{
      empreinte: string;
      niveau: string;
      confiance: number;
      urgent: number;
      bloquant: number;
      frustration: number;
    }>("SELECT empreinte, niveau, confiance, urgent, bloquant, frustration FROM atlassian_criticite WHERE instance = ? AND cle = ?", [
      instance,
      ticket.cle,
    ]);
    let jugement;
    // Un jugement complet sert aussi à la liste ; un jugement simple ne suffit pas à la fiche.
    if (connu && (connu.empreinte === empreinte || (!complet && connu.empreinte === `${base}#complet`))) {
      jugement = {
        niveau: connu.niveau,
        confiance: connu.confiance,
        urgent: connu.urgent === 1,
        bloquant: connu.bloquant === 1,
        frustration: connu.frustration === 1,
      };
    } else {
      jugement = await jugerTicket(ticket, complet);
      // Garde-fou : « critique » ou « important » sans urgence ni blocage, ou avec une priorité déclarée basse,
      // redescend à « normal » tant que le modèle n’en est pas sûr ; l’utilisateur tranche.
      const prioriteBasse = /(low|lowest|basse|faible|trivial|mineure|minor)/i.test(ticket.priorite ?? "");
      if (
        (jugement.niveau === "critique" || jugement.niveau === "important") &&
        jugement.confiance < SEUIL &&
        ((!jugement.urgent && !jugement.bloquant) || prioriteBasse)
      ) {
        jugement = { ...jugement, niveau: "normal", confiance: Math.min(jugement.confiance, SEUIL - 0.01) };
      }
      await db.execute(
        `INSERT INTO atlassian_criticite (instance, cle, empreinte, niveau, confiance, urgent, bloquant, frustration, evalue_le)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(instance, cle) DO UPDATE SET empreinte = excluded.empreinte, niveau = excluded.niveau,
           confiance = excluded.confiance, urgent = excluded.urgent, bloquant = excluded.bloquant,
           frustration = excluded.frustration, evalue_le = excluded.evalue_le`,
        [
          instance,
          ticket.cle,
          empreinte,
          jugement.niveau,
          jugement.confiance,
          jugement.urgent ? 1 : 0,
          jugement.bloquant ? 1 : 0,
          jugement.frustration ? 1 : 0,
        ],
      );
    }
    resultats.push({ cle: ticket.cle, ...jugement, aVerifier: jugement.confiance < SEUIL });
  }
  return { resultats };
}
