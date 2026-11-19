import { client } from "@alfred/sdk";

/** Client Prefect de l’instance demandée (instance par défaut si vide). */
export function prefect(instance?: string | null) {
  return client("prefect", instance ? { instance } : undefined);
}

export function erreurPrefect(status: number, quoi: string, corps?: unknown): Error {
  const detail =
    corps && typeof corps === "object" && "detail" in corps && typeof (corps as { detail: unknown }).detail === "string"
      ? ` (${(corps as { detail: string }).detail})`
      : "";
  if (status === 401) return new Error(`Prefect refuse la clé ou l’identifiant (${quoi}).`);
  if (status === 403) return new Error(`Ce compte n’a pas le droit d’accéder à ${quoi}.`);
  if (status === 404) return new Error(`Prefect ne trouve pas ${quoi}.`);
  return new Error(`Prefect a répondu ${status} pour ${quoi}${detail}.`);
}

/** POST d’un filtre Prefect, avec l’erreur en clair. */
export async function filtrer<T>(instance: string | undefined, chemin: string, corps: unknown, quoi: string): Promise<T> {
  const reponse = await prefect(instance).post<T>(chemin, corps);
  if (!reponse.ok) throw erreurPrefect(reponse.status, quoi, reponse.body);
  return reponse.body;
}

export interface EtatPrefect {
  type: string;
  name?: string | null;
  message?: string | null;
  timestamp?: string | null;
}

export interface FlowRunPrefect {
  id: string;
  name: string;
  flow_id: string;
  deployment_id?: string | null;
  state?: EtatPrefect | null;
  state_type?: string | null;
  state_name?: string | null;
  expected_start_time?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  total_run_time?: number | null;
  estimated_run_time?: number | null;
  parameters?: Record<string, unknown> | null;
  tags?: string[] | null;
  run_count?: number | null;
  work_pool_name?: string | null;
  work_queue_name?: string | null;
  created?: string | null;
  created_by?: { display_value?: string | null; type?: string | null } | null;
}

export interface Execution {
  id: string;
  nom: string;
  deploiementId: string | null;
  etat: string;
  etatNom: string;
  message: string | null;
  debutPrevu: string | null;
  debut: string | null;
  fin: string | null;
  duree: number | null;
}

/** Exécution Prefect → forme rendue par les fonctions. */
export function execution(run: FlowRunPrefect): Execution {
  const enCours = run.state?.type === "RUNNING";
  return {
    id: run.id,
    nom: run.name,
    deploiementId: run.deployment_id ?? null,
    etat: run.state?.type ?? run.state_type ?? "UNKNOWN",
    etatNom: run.state?.name ?? run.state_name ?? "",
    message: run.state?.message ?? null,
    debutPrevu: run.expected_start_time ?? null,
    debut: run.start_time ?? null,
    fin: run.end_time ?? null,
    duree: enCours ? (run.estimated_run_time ?? null) : (run.total_run_time ?? null),
  };
}

/** Noms des flows, par identifiant. */
export async function nomsFlows(instance: string | undefined, ids: string[]): Promise<Map<string, string>> {
  const uniques = [...new Set(ids.filter(Boolean))];
  if (uniques.length === 0) return new Map();
  const flows = await filtrer<{ id: string; name: string }[]>(
    instance,
    "/flows/filter",
    { flows: { id: { any_: uniques } }, limit: 200 },
    "les flows",
  );
  return new Map(flows.map((flow) => [flow.id, flow.name]));
}

export interface Planification {
  active?: boolean;
  schedule?: { cron?: string; timezone?: string | null; interval?: number; rrule?: string } | null;
}

export interface DeploiementPrefect {
  id: string;
  name: string;
  flow_id: string;
  description?: string | null;
  tags?: string[] | null;
  work_pool_name?: string | null;
  paused?: boolean | null;
  is_schedule_active?: boolean | null;
  status?: string | null;
  schedules?: Planification[] | null;
  schedule?: Planification["schedule"];
  parameters?: Record<string, unknown> | null;
  parameter_openapi_schema?: Record<string, unknown> | null;
  updated?: string | null;
}

function intervalle(secondes: number): string {
  if (secondes % 86400 === 0) return secondes === 86400 ? "tous les jours" : `tous les ${secondes / 86400} jours`;
  if (secondes % 3600 === 0) return secondes === 3600 ? "toutes les heures" : `toutes les ${secondes / 3600} h`;
  if (secondes % 60 === 0) return `toutes les ${secondes / 60} min`;
  return `toutes les ${secondes} s`;
}

function decrire(schedule: Planification["schedule"]): string | null {
  if (!schedule) return null;
  if (schedule.cron) return `cron ${schedule.cron}${schedule.timezone ? ` (${schedule.timezone})` : ""}`;
  if (schedule.interval) return intervalle(schedule.interval);
  if (schedule.rrule) return `règle ${schedule.rrule}`;
  return null;
}

/** Déploiement Prefect → forme rendue par les fonctions. */
export function decrireDeploiement(d: DeploiementPrefect, flows: Map<string, string>) {
  const planifs = d.schedules?.length ? d.schedules : d.schedule ? [{ active: d.is_schedule_active ?? true, schedule: d.schedule }] : [];
  return {
    id: d.id,
    nom: d.name,
    flux: flows.get(d.flow_id) ?? "",
    fluxId: d.flow_id,
    description: d.description || null,
    tags: d.tags ?? [],
    pool: d.work_pool_name ?? null,
    enPause: Boolean(d.paused ?? d.is_schedule_active === false),
    statut: d.status ?? null,
    planifications: planifs
      .filter((p) => p.active !== false)
      .map((p) => decrire(p.schedule))
      .filter((p): p is string => Boolean(p)),
    parametres: d.parameters ?? {},
    schemaParametres: d.parameter_openapi_schema ?? null,
    misAJour: d.updated ?? null,
  };
}

