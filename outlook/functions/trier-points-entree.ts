import { db, functions } from "@alfred/sdk";
import { classerMessages, lirePoints } from "../lib/points";
import { lireReglage } from "../lib/regles";

interface Entree {
  instance?: string;
  dossier?: string;
  limite?: number;
  depuis?: string;
  simuler?: boolean;
}

interface MessageListe {
  id: string;
  objet: string;
  expediteur: string;
  expediteurAdresse: string;
  extrait?: string;
  recu?: string | null;
  dossier: string;
}

/** Range les messages d’un dossier selon leur point d’entrée. */
export default async function (entree: Entree) {
  const vide = { examines: 0, ranges: 0, douteux: 0, details: [] };
  const limite = Math.min(200, Math.max(1, entree.limite ?? 50));

  const points = await lirePoints(true);
  if (points.length === 0) return vide;

  const comptes = await functions.call<{ pret: boolean }>("comptes-outlook", {});
  if (!comptes.pret) return vide;

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
      // Du plus récent au plus ancien : on s’arrête au premier message déjà relevé.
      if (depuis !== null && message.recu && new Date(message.recu).getTime() <= depuis) break lecture;
      messages.push(message);
    }
    if (!page.suivant || page.messages.length === 0) break;
    debut += page.messages.length;
  }

  const classements = await classerMessages(messages);
  const parId = new Map(points.map((point) => [point.id, point]));
  const dossierDouteux = await lireReglage("dossier_douteux");

  const details: Array<{ message: string; sujet: string; point: string; action: string }> = [];
  let ranges = 0;
  let douteux = 0;

  for (const classement of classements) {
    const message = messages.find((element) => element.id === classement.id);
    if (!message) continue;
    const point = classement.point ? parId.get(classement.point) : undefined;

    let cible = "";
    let action = "";
    if (classement.statut === "classe" && point?.dossier) {
      cible = point.dossier;
      action = `rangé dans le dossier de « ${point.nom} »`;
    } else if (classement.statut === "douteux") {
      douteux += 1;
      if (dossierDouteux) {
        cible = dossierDouteux;
        action = "mis de côté, à trier";
      }
    }
    if (!cible || message.dossier === cible) continue;

    if (!entree.simuler) {
      await functions.call("deplacer-message", { instance: entree.instance, id: message.id, dossier: cible });
      await db.execute(
        "INSERT INTO outlook_journal (id, regle_id, message_id, sujet, action) VALUES (?, ?, ?, ?, ?)",
        [crypto.randomUUID(), point ? `point:${point.id}` : null, message.id, message.objet?.trim() ?? "", action],
      );
    }
    ranges += 1;
    details.push({
      message: message.id,
      sujet: message.objet?.trim() || "(sans objet)",
      point: point?.nom ?? "À trier",
      action,
    });
  }

  return { examines: messages.length, ranges, douteux, details: details.slice(0, 30) };
}
