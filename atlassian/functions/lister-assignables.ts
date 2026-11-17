import { client } from "@alfred/sdk";
import { aucunCompte } from "../lib/comptes-api";
import { erreurAtlassian } from "../lib/jira-api";

interface Utilisateur { displayName?: string; name?: string; accountId?: string; emailAddress?: string }

/** Personnes à qui l’on peut assigner un ticket d’un projet. */
export default async function ({ instance, projet, recherche }: { instance?: string; projet: string; recherche?: string }) {
  if (await aucunCompte("jira")) return { utilisateurs: [] };
  if (!projet.trim()) return { utilisateurs: [] };

  const jira = client("jira", { instance });
  const texte = (recherche ?? "").trim();
  let reponse = await jira.get<Utilisateur[]>("/rest/api/2/user/assignable/search", {
    project: projet,
    query: texte,
    maxResults: 30,
  });
  if (reponse.status === 400) {
    reponse = await jira.get<Utilisateur[]>("/rest/api/2/user/assignable/search", {
      project: projet,
      username: texte,
      maxResults: 30,
    });
  }
  if (!reponse.ok) erreurAtlassian("Jira", reponse);

  return {
    utilisateurs: (reponse.body ?? []).map((utilisateur) => ({
      id: utilisateur.name ?? utilisateur.accountId ?? "",
      nom: utilisateur.displayName ?? utilisateur.name ?? "Quelqu’un",
      email: utilisateur.emailAddress ?? "",
    })),
  };
}
