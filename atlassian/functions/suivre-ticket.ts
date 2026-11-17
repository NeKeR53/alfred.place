import { client } from "@alfred/sdk";
import { erreurAtlassian } from "../lib/jira-api";

/** Commence ou arrête de suivre un ticket Jira (être prévenu de ses changements). */
export default async function ({ instance, cle, suivre }: { instance?: string; cle: string; suivre: boolean }) {
  if (!cle?.trim()) throw new Error("La clé du ticket est vide.");
  const jira = client("jira", { instance });
  const moi = await jira.get<{ name?: string; accountId?: string }>("/rest/api/2/myself", undefined, { cache: 3600 });
  if (!moi.ok) erreurAtlassian("Jira", moi);
  const adresse = `/rest/api/2/issue/${encodeURIComponent(cle.trim())}/watchers`;
  const identifiant = moi.body.accountId ?? moi.body.name ?? "";
  const reponse = suivre
    ? await jira.request({
        method: "POST",
        path: adresse,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(identifiant),
      })
    : await jira.request({
        method: "DELETE",
        path: adresse,
        query: moi.body.accountId ? { accountId: identifiant } : { username: identifiant },
      });
  if (!reponse.ok) erreurAtlassian("Jira", reponse);
  return { suivi: suivre };
}
