import { ai, db, functions } from "@alfred/sdk";
import { lireRegles, type Regle } from "../lib/regles";

interface Entree {
  instance?: string;
  dossier?: string;
  limite?: number;
  simuler?: boolean;
  /** Ne tenter qu’une règle (juste après sa création). */
  regle?: string;
  /** Ne traiter que les messages reçus après cette date (ISO). */
  depuis?: string;
}

interface MessageListe {
  id: string;
  objet: string;
  expediteur: string;
  expediteurAdresse: string;
  extrait?: string;
  recu?: string | null;
  lu: boolean;
  dossier: string;
}

const SEUIL = 0.8;

function sansAccents(texte: string): string {
  return texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("fr");
}

/** Le message parle-t-il de ce sujet ? Décidé sur l’ordinateur, sans service extérieur. */
async function parleDe(sujet: string, message: MessageListe): Promise<boolean> {
  try {
    const reponse = (await ai.decide({
      text: { expediteur: message.expediteur, objet: message.objet, debut: message.extrait ?? "" },
      question: `Ce courriel parle-t-il de : ${sujet} ?`,
      choices: { oui: `le courriel traite de ${sujet}`, non: "le courriel traite d’autre chose" },
    })) as { choice: string; confidence: number };
    return reponse.choice === "oui" && reponse.confidence >= SEUIL;
  } catch (erreur) {
    const texte = erreur instanceof Error ? erreur.message : String(erreur);
    if (/install/i.test(texte)) {
      throw new Error(
        "Le tri par sujet a besoin des décisions locales : installez-les dans Réglages, Général, rubrique « Décisions locales ».",
      );
    }
    throw erreur;
  }
}

async function correspond(regle: Regle, message: MessageListe): Promise<boolean> {
  const conditions = regle.conditions;
  const expediteur = sansAccents(`${message.expediteur} ${message.expediteurAdresse}`);
  const objet = sansAccents(message.objet ?? "");

  if (conditions.expediteur && !expediteur.includes(sansAccents(conditions.expediteur))) return false;
  if (conditions.objet && !objet.includes(sansAccents(conditions.objet))) return false;
  if (conditions.nonLu && message.lu) return false;
  // Le sujet en dernier : c’est la seule condition qui demande de lire le message.
  if (conditions.sujet && !(await parleDe(conditions.sujet, message))) return false;
  return true;
}

/** Applique les règles actives aux messages existants d’un dossier. */
export default async function (entree: Entree) {
  const limite = Math.min(200, Math.max(1, entree.limite ?? 50));

  const comptes = await functions.call<{ pret: boolean }>("comptes-outlook", {});
  if (!comptes.pret) return { examines: 0, appliques: 0, details: [] };

  const regles = (await lireRegles()).filter(
    (regle) => regle.actif && (!entree.regle || regle.id === entree.regle),
  );
  if (regles.length === 0) return { examines: 0, appliques: 0, details: [] };

  const depuis = entree.depuis ? new Date(entree.depuis).getTime() : null;
  const messages: MessageListe[] = [];
  let debut = 0;
  lecture: while (messages.length < limite) {
    const page = await functions.call<{ messages: MessageListe[]; suivant: boolean }>("lister-messages", {
      instance: entree.instance,
      dossier: entree.dossier,
      debut,
      limite: Math.min(100, limite - messages.length),
    });
    for (const message of page.messages) {
      // Les messages arrivent du plus récent au plus ancien : on s’arrête au premier déjà traité.
      if (depuis !== null && message.recu && new Date(message.recu).getTime() <= depuis) break lecture;
      messages.push(message);
    }
    if (!page.suivant || page.messages.length === 0) break;
    debut += page.messages.length;
  }

  const details: Array<{ message: string; sujet: string; regle: string; action: string }> = [];
  let appliques = 0;

  for (const message of messages) {
    let regle: Regle | undefined;
    for (const candidate of regles) {
      if (await correspond(candidate, message)) {
        regle = candidate;
        break;
      }
    }
    if (!regle) continue;

    const actions: string[] = [];
    if (regle.actions.marquerLu && !message.lu) {
      if (!entree.simuler) {
        await functions.call("marquer-message", { instance: entree.instance, id: message.id, lu: true });
      }
      actions.push("marqué comme lu");
    }
    if (regle.actions.deplacerVers && message.dossier !== regle.actions.deplacerVers) {
      if (!entree.simuler) {
        await functions.call("deplacer-message", {
          instance: entree.instance,
          id: message.id,
          dossier: regle.actions.deplacerVers,
        });
      }
      actions.push("déplacé vers le dossier choisi");
    }

    if (actions.length === 0) continue;
    appliques += 1;
    details.push({
      message: message.id,
      sujet: message.objet?.trim() || "(sans objet)",
      regle: regle.nom,
      action: actions.join(" · "),
    });

    if (!entree.simuler) {
      await db.execute(
        "INSERT INTO outlook_journal (id, regle_id, message_id, sujet, action) VALUES (?, ?, ?, ?, ?)",
        [crypto.randomUUID(), regle.id, message.id, message.objet?.trim() ?? "", actions.join(" · ")],
      );
    }
  }

  return { examines: messages.length, appliques, details: details.slice(0, 30) };
}
