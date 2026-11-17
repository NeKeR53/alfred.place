import { client } from "@alfred/sdk";
import { erreurAtlassian, texteJira, urlTicket } from "./jira-api";

/** Certaines routes de Jira Service Management (les files) sont encore « expérimentales » sur Data Center. */
export const ENTETES_SUPPORT = { "X-ExperimentalApi": "opt-in" };

export interface DureeJsm {
  millis?: number;
  friendly?: string;
}

export interface CycleSla {
  breached?: boolean;
  paused?: boolean;
  goalDuration?: DureeJsm;
  elapsedTime?: DureeJsm;
  remainingTime?: DureeJsm;
}

export interface SlaJsm {
  name?: string;
  ongoingCycle?: CycleSla;
  completedCycles?: CycleSla[];
}

export interface SlaResume {
  nom: string;
  restant: string;
  restantMs: number | null;
  objectif: string | null;
  depasse: boolean;
  enPause: boolean;
  termine: boolean;
}

/** Délai d’un SLA, en clair : en cours, en pause, atteint ou dépassé. */
export function resumerSla(sla: SlaJsm): SlaResume | null {
  const nom = sla.name ?? "Délai";
  const enCours = sla.ongoingCycle;
  if (enCours) {
    return {
      nom,
      restant: enCours.remainingTime?.friendly ?? "—",
      restantMs: typeof enCours.remainingTime?.millis === "number" ? enCours.remainingTime.millis : null,
      objectif: enCours.goalDuration?.friendly ?? null,
      depasse: Boolean(enCours.breached),
      enPause: Boolean(enCours.paused),
      termine: false,
    };
  }
  const dernier = sla.completedCycles?.[sla.completedCycles.length - 1];
  if (!dernier) return null;
  return {
    nom,
    restant: dernier.breached ? "Dépassé" : "Atteint",
    restantMs: null,
    objectif: dernier.goalDuration?.friendly ?? null,
    depasse: Boolean(dernier.breached),
    enPause: false,
    termine: true,
  };
}

/** Le délai le plus pressant parmi ceux qui courent encore (dépassé d’abord, puis le moins de temps restant). */
export function slaLePlusUrgent(slas: SlaJsm[]): Omit<SlaResume, "objectif" | "termine"> | null {
  const enCours = slas
    .map(resumerSla)
    .filter((sla): sla is SlaResume => sla !== null && !sla.termine);
  if (enCours.length === 0) return null;
  enCours.sort((a, b) => {
    if (a.enPause !== b.enPause) return a.enPause ? 1 : -1;
    return (a.restantMs ?? Number.MAX_SAFE_INTEGER) - (b.restantMs ?? Number.MAX_SAFE_INTEGER);
  });
  const { nom, restant, restantMs, depasse, enPause } = enCours[0];
  return { nom, restant, restantMs: restantMs ?? 0, depasse, enPause };
}

/** Catégorie d’état au format de Jira (« new », « indeterminate », « done »). */
export function categorieEtat(valeur: string | undefined): string {
  const v = (valeur ?? "").toLowerCase();
  if (v === "done") return "done";
  if (v === "indeterminate") return "indeterminate";
  return "new";
}

/** Champs de Jira qui portent le type de demande et les SLA (leurs identifiants varient d’une instance à l’autre). */
export async function champsSupport(instance?: string): Promise<{ typeDemande: string | null; slas: string[] }> {
  const reponse = await client("jira", { instance }).get<
    Array<{ id: string; schema?: { custom?: string; type?: string } }>
  >("/rest/api/2/field", undefined, { cache: 3600 });
  if (!reponse.ok) erreurAtlassian("Jira", reponse);
  const champs = Array.isArray(reponse.body) ? reponse.body : [];
  const typeDemande = champs.find((champ) => champ.schema?.custom === "com.atlassian.servicedesk:vp-origin")?.id ?? null;
  const slas = champs
    .filter(
      (champ) =>
        champ.schema?.custom === "com.atlassian.servicedesk:sla-field" || champ.schema?.type === "sd-servicelevelagreement",
    )
    .map((champ) => champ.id);
  return { typeDemande, slas };
}

/** Premier centre de services du compte, quand la page n’en a pas choisi. */
export async function premierService(instance?: string): Promise<string | null> {
  const reponse = await client("jira", { instance }).get<{ values?: Array<{ id: string | number }> }>(
    "/rest/servicedeskapi/servicedesk",
    { start: 0, limit: 1 },
  );
  if (!reponse.ok) erreurAtlassian("Jira Service Management", reponse);
  const premier = reponse.body?.values?.[0];
  return premier ? String(premier.id) : null;
}

export interface FileJsm {
  id: string | number;
  name?: string;
  jql?: string;
  issueCount?: number;
}

/** Files d’attente d’un centre de services, avec leur requête JQL. */
export async function filesDuService(service: string, instance?: string): Promise<FileJsm[]> {
  const reponse = await client("jira", { instance }).request<{ values?: FileJsm[] }>({
    path: `/rest/servicedeskapi/servicedesk/${encodeURIComponent(service)}/queue`,
    query: { includeCount: true, start: 0, limit: 100 },
    headers: ENTETES_SUPPORT,
  });
  if (!reponse.ok) erreurAtlassian("Jira Service Management", reponse);
  return reponse.body?.values ?? [];
}

/** Valeur d’un champ saisi par le client, rendue en texte lisible. */
export function valeurEnTexte(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return "";
  if (typeof valeur === "string") return valeur;
  if (typeof valeur === "number" || typeof valeur === "boolean") return String(valeur);
  if (Array.isArray(valeur)) return valeur.map(valeurEnTexte).filter(Boolean).join(", ");
  if (typeof valeur === "object") {
    const objet = valeur as Record<string, unknown>;
    if (objet.type === "doc") return texteJira(objet).trim();
    for (const cle of ["displayName", "value", "name", "label", "text", "key"]) {
      if (typeof objet[cle] === "string") return objet[cle] as string;
    }
  }
  return "";
}

interface DemandeJira {
  key: string;
  id: string;
  self?: string;
  fields?: Record<string, unknown> & {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    reporter?: { displayName?: string; emailAddress?: string };
    assignee?: { displayName?: string } | null;
    priority?: { name?: string } | null;
    created?: string;
    updated?: string;
  };
}

/** Demandes qui répondent à une requête JQL, avec le client, le type de demande et le délai le plus pressant. */
export async function chercherDemandes(jql: string, debut: number, limite: number, instance?: string) {
  const champs = await champsSupport(instance);
  const reponse = await client("jira", { instance }).get<{ issues?: DemandeJira[]; total?: number }>("/rest/api/2/search", {
    jql,
    startAt: debut,
    maxResults: limite,
    fields: ["summary", "status", "reporter", "assignee", "priority", "created", "updated", champs.typeDemande, ...champs.slas]
      .filter(Boolean)
      .join(","),
  });
  if (!reponse.ok) erreurAtlassian("Jira", reponse);
  return {
    total: reponse.body?.total ?? 0,
    demandes: (reponse.body?.issues ?? []).map((issue) => {
      const f = issue.fields ?? {};
      const origine = champs.typeDemande ? (f[champs.typeDemande] as { requestType?: { name?: string } } | null) : null;
      const slas = champs.slas.map((id) => f[id] as SlaJsm | null).filter((sla): sla is SlaJsm => Boolean(sla));
      return {
        cle: issue.key,
        id: issue.id,
        instance: instance ?? null,
        titre: f.summary ?? "(sans titre)",
        client: f.reporter?.displayName ?? "Client inconnu",
        clientEmail: f.reporter?.emailAddress ?? null,
        typeDemande: origine?.requestType?.name ?? null,
        statut: f.status?.name ?? "",
        statutCategorie: f.status?.statusCategory?.key ?? "new",
        assigne: f.assignee?.displayName ?? "Non assigné",
        priorite: f.priority?.name ?? "",
        creee: f.created ?? null,
        misAJour: f.updated ?? null,
        sla: slaLePlusUrgent(slas),
        url: urlTicket(issue.self, issue.key),
      };
    }),
  };
}

/** Tous les centres de services du compte (identifiant et clé de projet). */
export async function tousLesServices(instance?: string): Promise<Array<{ id: string; projetCle: string }>> {
  const reponse = await client("jira", { instance }).get<{ values?: Array<{ id: string | number; projectKey?: string }> }>(
    "/rest/servicedeskapi/servicedesk",
    { start: 0, limit: 100 },
    { cache: 300 },
  );
  if (reponse.status === 404) return [];
  if (!reponse.ok) erreurAtlassian("Jira Service Management", reponse);
  return (reponse.body?.values ?? []).map((s) => ({ id: String(s.id), projetCle: s.projectKey ?? "" }));
}
