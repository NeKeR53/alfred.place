import { client } from "@alfred/sdk";
import { erreurAtlassian } from "../lib/jira-api";

/** Supprime un lien entre deux tickets Jira. */
export default async function ({ instance, lien }: { instance?: string; lien: string }) {
  if (!lien?.trim()) throw new Error("Précisez le lien.");
  const reponse = await client("jira", { instance }).delete(`/rest/api/2/issueLink/${encodeURIComponent(lien.trim())}`);
  if (!reponse.ok) erreurAtlassian("Jira", reponse);
  return { supprime: true };
}
