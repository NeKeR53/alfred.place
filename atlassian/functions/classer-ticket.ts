import { client } from "@alfred/sdk";
import { erreurAtlassian } from "../lib/jira-api";

/**
 * Place un ticket juste après `apres` (ou avant `avant`) dans le classement partagé du board (Rank de Jira
 * Software). L’ordre de chaque personne d’un tableau de projet s’en déduit, comme dans OneApp.
 */
export default async function ({ instance, cle, apres, avant }: { instance?: string; cle: string; apres?: string; avant?: string }) {
  if (!cle.trim()) throw new Error("La clé du ticket est vide.");
  if (!apres?.trim() && !avant?.trim()) throw new Error("Donnez le ticket voisin (apres ou avant).");
  const reponse = await client("jira", { instance }).put("/rest/agile/1.0/issue/rank", {
    issues: [cle.trim()],
    ...(apres?.trim() ? { rankAfterIssue: apres.trim() } : { rankBeforeIssue: avant?.trim() }),
  });
  if (reponse.status === 404)
    throw new Error("Le classement Jira (Rank) est indisponible : Jira Software est nécessaire pour ordonner les tickets.");
  if (!reponse.ok) erreurAtlassian("Jira", reponse);
  return { classe: true };
}
