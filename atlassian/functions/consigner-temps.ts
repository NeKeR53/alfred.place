import { client } from "@alfred/sdk";
import { erreurAtlassian } from "../lib/jira-api";

interface Entree {
  instance?: string;
  cle: string;
  /** Durée au format Jira : « 1h 30m », « 2d ». */
  duree: string;
  commentaire?: string;
  /** Date du travail (AAAA-MM-JJ) ; aujourd’hui par défaut. */
  jour?: string;
  /** Nouvelle estimation du temps restant, au même format. */
  restant?: string;
}

function debut(jour?: string): string {
  const date = jour ? new Date(`${jour}T09:00:00`) : new Date();
  const decalage = -date.getTimezoneOffset();
  const signe = decalage >= 0 ? "+" : "-";
  const abs = Math.abs(decalage);
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}T${deux(date.getHours())}:${deux(date.getMinutes())}:00.000${signe}${deux(Math.floor(abs / 60))}${deux(abs % 60)}`;
}

/** Consigne du temps passé sur un ticket Jira, avec un commentaire et, au besoin, le temps restant. */
export default async function (entree: Entree) {
  const cle = entree.cle?.trim();
  const duree = entree.duree?.trim();
  if (!cle || !duree) throw new Error("Précisez le ticket et la durée (par exemple « 1h 30m »).");
  const requete: Record<string, string> = entree.restant?.trim()
    ? { adjustEstimate: "new", newEstimate: entree.restant.trim() }
    : {};
  const reponse = await client("jira", { instance: entree.instance }).request({
    method: "POST",
    path: `/rest/api/2/issue/${encodeURIComponent(cle)}/worklog`,
    query: requete,
    body: { timeSpent: duree, comment: entree.commentaire?.trim() || undefined, started: debut(entree.jour) },
  });
  if (!reponse.ok) erreurAtlassian("Jira", reponse);
  return { consigne: true };
}
