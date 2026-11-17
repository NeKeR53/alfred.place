import { client } from "@alfred/sdk";
import { aucunCompte } from "../lib/comptes-api";
import { echapperJql, erreurAtlassian, urlTicket } from "../lib/jira-api";

interface Entree {
  instance?: string;
  texte?: string;
  projet?: string;
  statuts?: string[];
  assignes?: string[];
  priorites?: string[];
  types?: string[];
  etiquettes?: string[];
  vue?: "ouverts" | "mes" | "tous";
  tri?: "maj" | "priorite" | "echeance" | "creation";
  debut?: number;
  limite?: number;
}

interface TicketJira {
  key: string;
  id: string;
  self?: string;
  fields?: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string; name?: string } };
    assignee?: { displayName?: string; name?: string; accountId?: string };
    reporter?: { displayName?: string };
    priority?: { name?: string };
    issuetype?: { name?: string };
    project?: { key?: string; name?: string };
    duedate?: string | null;
    updated?: string;
    labels?: string[];
  };
}

const ORDRES: Record<string, string> = {
  maj: "updated DESC",
  priorite: "priority DESC, updated DESC",
  echeance: "duedate ASC, updated DESC",
  creation: "created DESC",
};

/** Liste les tickets d’un compte Jira, filtrés par une recherche structurée. */
export default async function (entree: Entree) {
  const debut = Math.max(0, entree.debut ?? 0);
  const limite = Math.min(100, Math.max(1, entree.limite ?? 50));
  if (await aucunCompte("jira")) return { tickets: [], total: 0, debut, limite };

  const conditions: string[] = [];
  if (entree.projet) conditions.push(`project = ${echapperJql(entree.projet)}`);
  if (entree.texte?.trim()) conditions.push(`text ~ ${echapperJql(entree.texte.trim())}`);
  if (entree.statuts?.length) conditions.push(`status IN (${entree.statuts.map(echapperJql).join(", ")})`);
  if (entree.priorites?.length) conditions.push(`priority IN (${entree.priorites.map(echapperJql).join(", ")})`);
  if (entree.types?.length) conditions.push(`issuetype IN (${entree.types.map(echapperJql).join(", ")})`);
  if (entree.etiquettes?.length) conditions.push(`labels IN (${entree.etiquettes.map(echapperJql).join(", ")})`);
  if (entree.vue === "ouverts" || entree.vue === "mes") conditions.push("resolution = EMPTY");
  if (entree.vue === "mes") conditions.push("assignee = currentUser()");
  if (entree.assignes?.length) {
    const valeurs = entree.assignes.map((assigne) => (assigne.toLowerCase() === "moi" ? "currentUser()" : echapperJql(assigne)));
    conditions.push(`assignee IN (${valeurs.join(", ")})`);
  }
  if (conditions.length === 0) conditions.push("created >= 1970-01-01");

  const jql = `${conditions.join(" AND ")} ORDER BY ${ORDRES[entree.tri ?? "maj"] ?? ORDRES.maj}`;
  const reponse = await client("jira", { instance: entree.instance }).get<{
    issues?: TicketJira[];
    total?: number;
  }>("/rest/api/2/search", {
    jql,
    startAt: debut,
    maxResults: limite,
    fields: "summary,status,assignee,reporter,priority,issuetype,project,duedate,updated,labels",
  });
  if (!reponse.ok) erreurAtlassian("Jira", reponse);

  const tickets = (reponse.body?.issues ?? []).map((issue) => {
    const champs = issue.fields ?? {};
    const assigneId = champs.assignee?.name ?? champs.assignee?.accountId ?? null;
    return {
      cle: issue.key,
      id: issue.id,
      instance: entree.instance ?? null,
      titre: champs.summary ?? "(sans titre)",
      projet: champs.project?.key ?? "",
      projetNom: champs.project?.name ?? "",
      type: champs.issuetype?.name ?? "",
      statut: champs.status?.name ?? "",
      statutCategorie: champs.status?.statusCategory?.key ?? "new",
      assigne: champs.assignee?.displayName ?? "Non assigné",
      assigneId,
      rapporteur: champs.reporter?.displayName ?? "",
      priorite: champs.priority?.name ?? "",
      echeance: champs.duedate ?? null,
      etiquettes: champs.labels ?? [],
      misAJour: champs.updated ?? null,
      url: urlTicket(issue.self, issue.key),
    };
  });

  return { tickets, total: reponse.body?.total ?? tickets.length, debut, limite };
}
