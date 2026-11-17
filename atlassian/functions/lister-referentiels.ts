import { client } from "@alfred/sdk";
import { erreurAtlassian } from "../lib/jira-api";
import { aucunCompte } from "../lib/comptes-api";

interface Projet { key: string; name: string }
interface Statut { name: string }
interface Priorite { name: string }
interface TypeTicket { name: string }

/**
 * Projets, statuts, priorités et types d’un compte Jira : de quoi proposer
 * des valeurs justes dans la recherche et les formulaires.
 */
export default async function ({ instance }: { instance?: string }) {
  if (await aucunCompte("jira")) return { projets: [], statuts: [], priorites: [], types: [], moi: null };
  const jira = client("jira", { instance });
  const [rProjets, rStatuts, rPriorites, rTypes, rMoi] = await Promise.all([
    jira.get<Projet[] | { values: Projet[] }>("/rest/api/2/project", undefined, { cache: 600 }),
    jira.get<Statut[]>("/rest/api/2/status", undefined, { cache: 600 }),
    jira.get<Priorite[]>("/rest/api/2/priority", undefined, { cache: 600 }),
    jira.get<TypeTicket[]>("/rest/api/2/issuetype", undefined, { cache: 600 }),
    jira.get<{ displayName?: string; name?: string; accountId?: string }>("/rest/api/2/myself"),
  ]);

  if (!rProjets.ok) erreurAtlassian("Jira", rProjets);
  if (!rStatuts.ok) erreurAtlassian("Jira", rStatuts);
  if (!rPriorites.ok) erreurAtlassian("Jira", rPriorites);
  if (!rTypes.ok) erreurAtlassian("Jira", rTypes);

  const projetsBruts = Array.isArray(rProjets.body) ? rProjets.body : (rProjets.body?.values ?? []);
  const moi = rMoi.ok
    ? { nom: rMoi.body?.displayName ?? rMoi.body?.name ?? "Moi", id: rMoi.body?.name ?? rMoi.body?.accountId ?? "" }
    : null;

  return {
    projets: projetsBruts.map((projet) => ({ cle: projet.key, nom: projet.name })).sort((a, b) => a.cle.localeCompare(b.cle)),
    statuts: (rStatuts.body ?? []).map((statut) => statut.name),
    priorites: (rPriorites.body ?? []).map((priorite) => priorite.name),
    types: (rTypes.body ?? []).map((type) => type.name),
    moi,
  };
}
