import { ai, db } from "@alfred/sdk";

export interface PointEntree {
  id: string;
  nom: string;
  description: string;
  dossier: string;
  actif: boolean;
}

export interface MessageAClasser {
  id: string;
  objet?: string;
  expediteur?: string;
  expediteurAdresse?: string;
  extrait?: string;
}

/** `classe` : sûr ; `douteux` : à trancher par l’utilisateur ; `aucun` : hors de tous les points d’entrée. */
export type StatutClassement = "classe" | "douteux" | "aucun";

export interface Classement {
  id: string;
  point: string | null;
  nom: string | null;
  certitude: number;
  statut: StatutClassement;
}

/** Sous ce degré de certitude, le message reste à trier par l’utilisateur. */
export const SEUIL = 0.8;
const AUCUN = "Aucun de ces sujets";

export async function lirePoints(actifsSeulement = false): Promise<PointEntree[]> {
  const lignes = await db.query<{ id: string; nom: string; description: string; dossier: string; actif: number }>(
    `SELECT id, nom, description, dossier, actif FROM outlook_points_entree
     ${actifsSeulement ? "WHERE actif = 1" : ""} ORDER BY nom COLLATE NOCASE`,
  );
  return lignes.map((ligne) => ({ ...ligne, actif: ligne.actif === 1 }));
}

/** Empreinte de la liste active : un classement fait avec une autre liste est refait. */
export function signature(points: PointEntree[]): string {
  const texte = points.map((point) => `${point.id}|${point.nom}|${point.description}`).join("\n");
  let empreinte = 5381;
  for (let i = 0; i < texte.length; i += 1) empreinte = ((empreinte * 33) ^ texte.charCodeAt(i)) >>> 0;
  return `${points.length}-${empreinte.toString(36)}`;
}

function messageInstallation(erreur: unknown): Error {
  const texte = erreur instanceof Error ? erreur.message : String(erreur);
  if (/install/i.test(texte)) {
    return new Error(
      "Le tri par point d’entrée a besoin des décisions locales : installez-les dans Réglages, Général, rubrique « Décisions locales ».",
    );
  }
  return erreur instanceof Error ? erreur : new Error(texte);
}

/** Classe chaque message dans un point d’entrée actif, en une seule décision prise sur l’ordinateur. */
export async function classerMessages(messages: MessageAClasser[]): Promise<Classement[]> {
  const points = await lirePoints(true);
  if (points.length === 0 || messages.length === 0) return [];
  const empreinte = signature(points);
  const parNom = new Map(points.map((point) => [point.nom, point]));
  const parId = new Map(points.map((point) => [point.id, point]));

  const resultats: Classement[] = [];
  for (const message of messages) {
    const [connu] = await db.query<{ point_id: string | null; certitude: number; statut: StatutClassement }>(
      "SELECT point_id, certitude, statut FROM outlook_classements WHERE message_id = ? AND signature = ?",
      [message.id, empreinte],
    );
    if (connu) {
      resultats.push({
        id: message.id,
        point: connu.point_id,
        nom: connu.point_id ? (parId.get(connu.point_id)?.nom ?? null) : null,
        certitude: connu.certitude,
        statut: connu.statut,
      });
      continue;
    }

    let reponse: { choice: string; confidence: number };
    try {
      reponse = (await ai.decide({
        text: {
          expediteur: `${message.expediteur ?? ""} <${message.expediteurAdresse ?? ""}>`,
          objet: message.objet ?? "",
          debut: (message.extrait ?? "").slice(0, 2500),
        },
        question: "À quel point d’entrée ce courriel appartient-il ?",
        choices: [
          ...points.map((point) => ({ label: point.nom, description: point.description || point.nom })),
          { label: AUCUN, description: "le courriel ne relève d’aucune de ces catégories" },
        ],
      })) as { choice: string; confidence: number };
    } catch (erreur) {
      throw messageInstallation(erreur);
    }

    const point = parNom.get(reponse.choice) ?? null;
    const statut: StatutClassement = reponse.confidence < SEUIL ? "douteux" : point ? "classe" : "aucun";
    const classement: Classement = {
      id: message.id,
      point: point?.id ?? null,
      nom: point?.nom ?? null,
      certitude: Math.round(reponse.confidence * 100) / 100,
      statut,
    };
    await db.execute(
      `INSERT OR REPLACE INTO outlook_classements (message_id, point_id, certitude, statut, signature, classe_le)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [message.id, classement.point, classement.certitude, statut, empreinte],
    );
    resultats.push(classement);
  }
  return resultats;
}
