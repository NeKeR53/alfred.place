import { client } from "@alfred/sdk";
import { erreurAtlassian } from "../lib/jira-api";

/** Supprime un commentaire d’un ticket Jira. */
export default async function ({ instance, cle, commentaire }: { instance?: string; cle: string; commentaire: string }) {
  if (!cle?.trim() || !commentaire) throw new Error("Précisez le ticket et le commentaire.");
  const reponse = await client("jira", { instance }).delete(
    `/rest/api/2/issue/${encodeURIComponent(cle.trim())}/comment/${encodeURIComponent(commentaire)}`,
  );
  if (!reponse.ok) erreurAtlassian("Jira", reponse);
  return { supprime: true };
}
