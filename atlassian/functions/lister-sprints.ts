import { client } from "@alfred/sdk";
import { aucunCompte } from "../lib/comptes-api";

/** Sprints actifs et à venir des tableaux d’un projet Jira, pour ranger un ticket dans un sprint. */
export default async function ({ instance, projet }: { instance?: string; projet: string }) {
  if (!projet?.trim() || (await aucunCompte("jira"))) return { sprints: [] };
  const jira = client("jira", { instance });
  const tableaux = await jira.get<{ values?: Array<{ id: number; name: string; type?: string }> }>(
    "/rest/agile/1.0/board",
    { projectKeyOrId: projet.trim(), maxResults: 20 },
    { cache: 600 },
  );
  // Sans Jira Software, l’API agile n’existe pas : aucun sprint à proposer.
  if (!tableaux.ok) return { sprints: [] };

  const vus = new Map<string, { id: string; nom: string; etat: string; tableau: string }>();
  for (const tableau of (tableaux.body?.values ?? []).filter((t) => t.type !== "kanban")) {
    const sprints = await jira.get<{ values?: Array<{ id: number; name: string; state: string }> }>(
      `/rest/agile/1.0/board/${tableau.id}/sprint`,
      { state: "active,future", maxResults: 50 },
    );
    if (!sprints.ok) continue;
    for (const sprint of sprints.body?.values ?? []) {
      vus.set(String(sprint.id), {
        id: String(sprint.id),
        nom: sprint.name,
        etat: sprint.state === "active" ? "En cours" : "À venir",
        tableau: tableau.name,
      });
    }
  }
  return { sprints: [...vus.values()] };
}
