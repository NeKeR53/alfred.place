import { client } from "@alfred/sdk";
import { aucunCompte } from "../lib/comptes-api";
import { echapperJql, erreurAtlassian, urlTicket } from "../lib/jira-api";

interface Entree {
  instance?: string;
  /** Clés des projets Jira (ATOM). Vide : tous les projets visibles. */
  projets?: string[];
  /** `actifs` : tout sauf la catégorie Terminé ; `termines` : la catégorie Terminé, par pages. */
  mode?: "actifs" | "termines";
  debut?: number;
  limite?: number;
  /** Lit aussi l’historique des statuts et responsables (changelog), pour le passé d’un planning. */
  historique?: boolean;
}

type Utilisateur = { displayName?: string; name?: string; accountId?: string; emailAddress?: string; key?: string };
type Champs = Record<string, unknown> & {
  summary?: string;
  status?: { name?: string; statusCategory?: { key?: string } };
  assignee?: Utilisateur | null;
  priority?: { name?: string };
  issuetype?: { name?: string };
  project?: { key?: string; name?: string };
  duedate?: string | null;
  updated?: string;
  created?: string;
  timeoriginalestimate?: number | null;
  timeestimate?: number | null;
};
type Historique = { created?: string; items?: { field?: string; from?: string | null; fromString?: string | null; to?: string | null; toString?: string | null }[] };
type Issue = { key: string; id: string; self?: string; fields?: Champs; changelog?: { histories?: Historique[] } };

/** Champ Rank de Jira Software (LexoRank) ; absent sans Jira Software. Même règle que OneApp. */
async function champRang(jira: ReturnType<typeof client>) {
  const reponse = await jira.get<{ id?: string; name?: string; schema?: { custom?: string } }[]>("/rest/api/2/field");
  if (!reponse.ok || !Array.isArray(reponse.body)) return undefined;
  return reponse.body.find(
    ({ id, name, schema }) =>
      typeof id === "string" &&
      ((typeof schema?.custom === "string" && schema.custom.toLowerCase().includes("lexo-rank")) || name?.toLowerCase() === "rank"),
  )?.id;
}

/** Catégorie (new, indeterminate, done) de chaque statut, par nom en minuscules. */
async function categories(jira: ReturnType<typeof client>) {
  const reponse = await jira.get<{ name?: string; statusCategory?: { key?: string } }[]>("/rest/api/2/status");
  const carte = new Map<string, string>();
  if (reponse.ok && Array.isArray(reponse.body))
    for (const statut of reponse.body) if (statut.name && statut.statusCategory?.key) carte.set(statut.name.toLowerCase(), statut.statusCategory.key);
  return carte;
}

/**
 * Tickets d’un tableau de projet, comme la page Projets de OneApp : suivi du temps (estimation initiale et reste à
 * faire, en secondes), rang partagé du board (Rank) et, sur demande, historique des statuts et des responsables.
 */
export default async function (entree: Entree) {
  const debut = Math.max(0, entree.debut ?? 0);
  const limite = Math.min(100, Math.max(1, entree.limite ?? 100));
  if (await aucunCompte("jira")) return { tickets: [], total: 0, debut, limite, rangDisponible: false };
  const jira = client("jira", { instance: entree.instance });
  const projets = (entree.projets ?? []).map((projet) => projet.trim()).filter(Boolean);
  const [rang, statuts] = await Promise.all([champRang(jira), entree.historique ? categories(jira) : undefined]);
  const conditions = [
    ...(projets.length ? [`project IN (${projets.map(echapperJql).join(", ")})`] : []),
    entree.mode === "termines" ? "statusCategory = Done" : "statusCategory != Done",
  ];
  const champs = [
    "summary", "status", "assignee", "priority", "issuetype", "project", "duedate", "updated", "created",
    "timeoriginalestimate", "timeestimate", ...(rang ? [rang] : []),
  ];
  const reponse = await jira.get<{ issues?: Issue[]; total?: number }>("/rest/api/2/search", {
    jql: `${conditions.join(" AND ")} ORDER BY updated DESC`,
    startAt: debut,
    maxResults: limite,
    fields: champs.join(","),
    ...(entree.historique ? { expand: "changelog" } : {}),
  });
  if (!reponse.ok) erreurAtlassian("Jira", reponse);

  const tickets = (reponse.body?.issues ?? []).map((issue) => {
    const f = issue.fields ?? {};
    const assigne = f.assignee ?? null;
    return {
      cle: issue.key,
      id: issue.id,
      instance: entree.instance ?? null,
      titre: f.summary ?? "(sans titre)",
      projet: f.project?.key ?? "",
      projetNom: f.project?.name ?? "",
      type: f.issuetype?.name ?? "",
      priorite: f.priority?.name ?? "",
      statut: f.status?.name ?? "",
      statutCategorie: f.status?.statusCategory?.key ?? "new",
      assigne: assigne ? (assigne.displayName ?? assigne.name ?? null) : null,
      assigneId: assigne ? (assigne.name ?? assigne.accountId ?? null) : null,
      assigneLogin: assigne?.name ?? assigne?.key ?? null,
      assigneEmail: assigne?.emailAddress ?? null,
      echeance: f.duedate ?? null,
      misAJour: f.updated ?? null,
      cree: f.created ?? null,
      estimationSecondes: typeof f.timeoriginalestimate === "number" ? f.timeoriginalestimate : null,
      restantSecondes: typeof f.timeestimate === "number" ? f.timeestimate : null,
      rang: rang && typeof f[rang] === "string" ? (f[rang] as string) : null,
      url: urlTicket(issue.self, issue.key),
      ...(statuts ? { historique: historique(issue, statuts) } : {}),
    };
  });
  return { tickets, total: reponse.body?.total ?? tickets.length, debut, limite, rangDisponible: Boolean(rang) };
}

/** Événements de statut et de responsable, précédés de l’état à la création (comme `jiraWorkflowHistory` de OneApp). */
function historique(issue: Issue, statuts: Map<string, string>) {
  const histoires = (issue.changelog?.histories ?? [])
    .filter((h) => typeof h.created === "string")
    .sort((a, b) => String(a.created).localeCompare(String(b.created)));
  const statut = (nom: string | null | undefined) =>
    nom ? { statut: nom, ...(statuts.get(nom.toLowerCase()) ? { statutCategorie: statuts.get(nom.toLowerCase()) } : {}) } : {};
  const elements = histoires.flatMap((h) => h.items ?? []);
  const premierStatut = elements.find((item) => item.field === "status");
  const premierAssigne = elements.find((item) => item.field === "assignee");
  const changements = histoires.flatMap((h) => {
    const evenement: Record<string, unknown> = { le: String(h.created) };
    for (const item of h.items ?? []) {
      if (item.field === "status") Object.assign(evenement, statut(item.toString));
      if (item.field === "assignee") evenement.assigneId = item.to ?? null;
    }
    return "statut" in evenement || "assigneId" in evenement ? [evenement] : [];
  });
  const f = issue.fields ?? {};
  const initial = {
    le: f.created ?? (changements[0]?.le as string | undefined) ?? "",
    ...statut(premierStatut ? premierStatut.fromString : f.status?.name),
    assigneId: premierAssigne ? (premierAssigne.from ?? null) : (f.assignee?.name ?? f.assignee?.accountId ?? null),
  };
  return initial.le ? [initial, ...changements] : changements;
}
