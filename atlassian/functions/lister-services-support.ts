import { client } from "@alfred/sdk";
import { aucunCompte } from "../lib/comptes-api";
import { erreurAtlassian } from "../lib/jira-api";

/** Centres de services Jira Service Management du compte. */
export default async function ({ instance }: { instance?: string }) {
  if (await aucunCompte("jira")) return { services: [] };
  const reponse = await client("jira", { instance }).get<{
    values?: Array<{ id: string | number; projectKey?: string; projectName?: string }>;
  }>("/rest/servicedeskapi/servicedesk", { start: 0, limit: 100 }, { cache: 300 });
  // Un Jira sans Service Management n’a pas cette route : aucun centre de services.
  if (reponse.status === 404) return { services: [] };
  if (!reponse.ok) erreurAtlassian("Jira Service Management", reponse);
  return {
    services: (reponse.body?.values ?? []).map((service) => ({
      id: String(service.id),
      projetCle: service.projectKey ?? "",
      projetNom: service.projectName ?? service.projectKey ?? `Centre ${service.id}`,
    })),
  };
}
