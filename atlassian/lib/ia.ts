import { ai } from "@alfred/sdk";

/** Texte lisible d’un HTML (page Confluence, description rendue), pour le donner à l’IA. */
export function texteBrut(html: string, limite = 60000): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "’")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim()
    .slice(0, limite);
}

/** Message clair quand le modèle de décision locale n’est pas installé. */
export function erreurDecision(erreur: unknown): Error {
  const texte = erreur instanceof Error ? erreur.message : String(erreur);
  if (/install/i.test(texte)) {
    return new Error(
      "Les décisions locales ne sont pas encore installées : ouvrez Réglages, Général, rubrique « Décisions locales ».",
    );
  }
  return erreur instanceof Error ? erreur : new Error(texte);
}

export const NIVEAUX_CRITICITE = ["critique", "important", "normal", "faible"] as const;
export type NiveauCriticite = (typeof NIVEAUX_CRITICITE)[number];

interface Reponse {
  type?: string;
  choice?: string;
  confidence?: number;
  answer?: boolean | string;
  probability?: number;
}

/** Criticité d’un ticket et ses signaux, jugés sur l’ordinateur par le modèle de décision. */
export async function jugerTicket(ticket: {
  titre: string;
  description?: string;
  type?: string;
  priorite?: string;
  dernierCommentaire?: string;
}, signaux = true) {
  try {
    const texte = [
      `Ticket : ${ticket.titre}`,
      ticket.type ? `Type : ${ticket.type}` : "",
      ticket.priorite ? `Priorité déclarée : ${ticket.priorite}` : "",
      ticket.description ? `Description : ${ticket.description.slice(0, 2500)}` : "",
      ticket.dernierCommentaire ? `Dernier commentaire : ${ticket.dernierCommentaire.slice(0, 600)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    // La gravité se pose seule : c’est la question qui compte, et la forme la plus fiable.
    const gravite = (await ai.decide({
      text: texte,
      question: "Quelle est la gravité de ce ticket ?",
      choices: {
        faible: "détail visuel, couleur, texte, confort, suggestion ou question",
        normal: "bogue courant ou demande classique, un contournement existe",
        important: "fonction importante dégradée pour plusieurs personnes, ou échéance proche",
        critique: "service arrêté, tous les utilisateurs bloqués, perte de données ou faille de sécurité",
      },
    })) as Reponse & { probabilities?: Record<string, number> };
    // Les signaux (urgence, blocage, agacement) ne se posent que pour un ticket ouvert : c’est plus lent.
    const { answers } = signaux
      ? ((await ai.decide({
      text: texte,
      questions: {
        urgent: { type: "yesno", question: "Faut-il traiter ce ticket aujourd’hui ?" },
        bloquant: { type: "yesno", question: "Des utilisateurs sont-ils empêchés de travailler ?" },
        frustration: { type: "yesno", question: "Le demandeur exprime-t-il de la frustration ou de l’agacement ?" },
      },
    })) as { answers: Record<string, Reponse> })
      : { answers: {} as Record<string, Reponse> };
    answers.criticite = gravite;
    const oui = (r?: Reponse) => (r?.answer === true || r?.answer === "yes" || (r?.probability ?? 0) > 0.5);
    let niveau = (answers.criticite?.choice ?? "normal") as NiveauCriticite;
    let confiance = Number(answers.criticite?.confidence ?? 0);
    const urgent = oui(answers.urgent);
    const bloquant = oui(answers.bloquant);
    const prioriteBasse = /(low|lowest|basse|faible|trivial|mineure|minor)/i.test(ticket.priorite ?? "");
    // Garde-fou : le modèle surestime parfois. « Critique » ou « important » sans urgence ni blocage,
    // ou avec une priorité déclarée basse, redescend à « normal » et reste à vérifier.
    if ((niveau === "critique" || niveau === "important") && confiance < 0.8 && ((!urgent && !bloquant) || prioriteBasse)) {
      niveau = "normal";
      confiance = Math.min(confiance, 0.79);
    }
    return { niveau, confiance, urgent, bloquant, frustration: oui(answers.frustration) };
  } catch (erreur) {
    throw erreurDecision(erreur);
  }
}

/** Risque d’une pull request (faible, moyen, élevé), jugé sur l’ordinateur. */
export async function jugerPr(pr: { titre: string; description?: string; source?: string; cible?: string; fichiers?: string[] }) {
  try {
    const reponse = (await ai.decide({
      text: {
        titre: pr.titre,
        branches: `${pr.source ?? ""} → ${pr.cible ?? ""}`,
        description: (pr.description ?? "").slice(0, 2000),
        fichiers: (pr.fichiers ?? []).slice(0, 40).join("\n"),
      },
      question: "Quel est le risque de fusionner cette pull request ?",
      choices: {
        eleve: "touche la sécurité, les données, la base, la facturation, une migration ou beaucoup de fichiers",
        moyen: "change un comportement visible ou une fonction métier",
        faible: "documentation, texte, style, test ou petit correctif isolé",
      },
    })) as Reponse;
    return { niveau: reponse.choice ?? "moyen", confiance: Number(reponse.confidence ?? 0) };
  } catch (erreur) {
    throw erreurDecision(erreur);
  }
}
