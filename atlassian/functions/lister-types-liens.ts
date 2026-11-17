import { client } from "@alfred/sdk";
import { aucunCompte } from "../lib/comptes-api";
import { erreurAtlassian } from "../lib/jira-api";

/** Types de liens entre tickets Jira (« bloque », « est dupliqué par »…), dans les deux sens. */
export default async function ({ instance }: { instance?: string }) {
  if (await aucunCompte("jira")) return { types: [] };
  const reponse = await client("jira", { instance }).get<{
    issueLinkTypes?: Array<{ id: string; name: string; inward: string; outward: string }>;
  }>("/rest/api/2/issueLinkType", undefined, { cache: 3600 });
  if (!reponse.ok) erreurAtlassian("Jira", reponse);
  return {
    types: (reponse.body?.issueLinkTypes ?? []).map((t) => ({
      id: t.id,
      nom: t.name,
      sortant: t.outward,
      entrant: t.inward,
    })),
  };
}
