import { client } from "@alfred/sdk";
import { erreurAtlassian } from "../lib/jira-api";

/** Ajoute un commentaire à un ticket. */
export default async function ({ instance, cle, texte }: { instance?: string; cle: string; texte: string }) {
  if (!cle.trim()) throw new Error("La clé du ticket est vide.");
  if (!texte.trim()) throw new Error("Le commentaire est vide.");
  const reponse = await client("jira", { instance }).post(`/rest/api/2/issue/${encodeURIComponent(cle.trim())}/comment`, {
    body: texte.trim(),
  });
  if (!reponse.ok) erreurAtlassian("Jira", reponse);
  const corps = reponse.body as { id?: string } | undefined;
  return { commentaire: corps?.id ?? null };
}
