import { ai, db } from "@alfred/sdk";

interface MessageAAnalyser {
  id: string;
  objet: string;
  expediteur?: string;
  expediteurAdresse?: string;
  extrait?: string;
}

interface Reponse {
  type?: string;
  choice?: string;
  answer?: boolean | string;
  probability?: number;
  score?: number;
  level?: string;
}

const oui = (r?: Reponse) => r?.answer === true || r?.answer === "yes" || (r?.probability ?? 0) > 0.5;

/** Lit des messages sur l’ordinateur : hameçonnage, indésirable, urgence, réponse attendue. Un message déjà lu n’est pas relu. */
export default async function ({ messages = [] }: { messages?: MessageAAnalyser[] }) {
  const resultats = [];
  for (const message of messages.slice(0, 3)) {
    const [connu] = await db.query<{
      categorie: string;
      hameconnage: number;
      indesirable: number;
      urgent: number;
      reponse_attendue: number;
    }>("SELECT categorie, hameconnage, indesirable, urgent, reponse_attendue FROM outlook_analyses WHERE id = ?", [message.id]);
    if (connu) {
      resultats.push({
        id: message.id,
        categorie: connu.categorie,
        hameconnage: connu.hameconnage === 1,
        indesirable: connu.indesirable === 1,
        urgent: connu.urgent === 1,
        reponseAttendue: connu.reponse_attendue === 1,
      });
      continue;
    }
    let reponses: Record<string, Reponse>;
    try {
      ({ answers: reponses } = (await ai.decide({
        text: `De : ${message.expediteur ?? ""} <${message.expediteurAdresse ?? ""}>\nObjet : ${message.objet}\n${(message.extrait ?? "").slice(0, 2500)}`,
        questions: {
          is_phishing: { type: "yesno", question: "Ce message cherche-t-il à voler des identifiants ou de l’argent (hameçonnage) ?" },
          is_spam: { type: "yesno", question: "Ce message est-il de la publicité non sollicitée ?" },
          urgent: { type: "yesno", question: "Ce message demande-t-il une action rapide, aujourd’hui ?" },
          needs_reply: { type: "yesno", question: "L’expéditeur attend-il une réponse personnelle ?" },
        },
      })) as { answers: Record<string, Reponse> });
    } catch (erreur) {
      const texte = erreur instanceof Error ? erreur.message : String(erreur);
      if (/install/i.test(texte)) {
        throw new Error("Les décisions locales ne sont pas encore installées : ouvrez Réglages, Général, rubrique « Décisions locales ».");
      }
      throw erreur;
    }
    const resultat = {
      id: message.id,
      categorie: "",
      hameconnage: oui(reponses.is_phishing),
      indesirable: oui(reponses.is_spam),
      urgent: oui(reponses.urgent),
      reponseAttendue: oui(reponses.needs_reply),
    };
    await db.execute(
      `INSERT OR REPLACE INTO outlook_analyses (id, categorie, hameconnage, indesirable, urgent, reponse_attendue, analyse_le)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        resultat.id,
        resultat.categorie,
        resultat.hameconnage ? 1 : 0,
        resultat.indesirable ? 1 : 0,
        resultat.urgent ? 1 : 0,
        resultat.reponseAttendue ? 1 : 0,
      ],
    );
    resultats.push(resultat);
  }
  return { resultats };
}
