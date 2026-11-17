import { client } from "@alfred/sdk";
import { aucunCompte } from "../lib/comptes-api";
import { erreurAtlassian } from "../lib/jira-api";

/** Notifications Confluence non lues (la « boîte de travail » de Confluence Data Center). */
export default async function ({ instance }: { instance?: string }) {
  if (await aucunCompte("confluence")) return { nonLues: 0 };
  const reponse = await client("confluence", { instance }).get<{ count?: number }>(
    "/rest/mywork/latest/status/notification/count",
  );
  // Confluence Cloud n’expose pas ce compteur : rien à compter.
  if (reponse.status === 404) return { nonLues: null };
  if (!reponse.ok) erreurAtlassian("Confluence", reponse);
  return { nonLues: typeof reponse.body?.count === "number" ? reponse.body.count : 0 };
}
