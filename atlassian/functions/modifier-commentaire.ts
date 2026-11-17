import { client } from "@alfred/sdk";
import { erreurAtlassian } from "../lib/jira-api";

/** Modifie le texte d’un commentaire d’un ticket Jira. */
export default async function ({ instance, cle, commentaire, texte }: { instance?: string; cle: string; commentaire: string; texte: string }) {
  if (!cle?.trim() || !commentaire || !texte?.trim()) throw new Error("Précisez le ticket, le commentaire et le texte.");
  const reponse = await client("jira", { instance }).put(
    `/rest/api/2/issue/${encodeURIComponent(cle.trim())}/comment/${encodeURIComponent(commentaire)}`,
    { body: texte },
  );
  if (!reponse.ok) erreurAtlassian("Jira", reponse);
  return { modifie: true };
}
