import { executionOuDerniere } from "../lib/derniere-execution";
import { erreurPrefect, filtrer, type FlowRunPrefect, prefect } from "../lib/prefect-api";

interface LogPrefect {
  timestamp: string;
  level: number;
  message: string;
  name?: string | null;
  task_run_id?: string | null;
}

const PAGE = 200;
const PAGES = 5;

export default async function (input: { instance?: string; execution?: string; niveauMin?: number }) {
  const id = await executionOuDerniere(input.instance, input.execution);
  const reponse = await prefect(input.instance).get<FlowRunPrefect>(`/flow_runs/${encodeURIComponent(id)}`);
  if (!reponse.ok) throw erreurPrefect(reponse.status, "cette exécution", reponse.body);
  const etat = reponse.body.state?.type ?? "UNKNOWN";

  const filtreLogs: Record<string, unknown> = { flow_run_id: { any_: [id] } };
  if (input.niveauMin) filtreLogs.level = { ge_: input.niveauMin };

  // Les plus récents d’abord, puis remis dans l’ordre : on garde la fin d’un log très long.
  const lus: LogPrefect[] = [];
  let tronque = false;
  for (let page = 0; page < PAGES; page++) {
    const lot = await filtrer<LogPrefect[]>(
      input.instance,
      "/logs/filter",
      { logs: filtreLogs, sort: "TIMESTAMP_DESC", limit: PAGE, offset: page * PAGE },
      "les logs",
    );
    lus.push(...lot);
    if (lot.length < PAGE) break;
    if (page === PAGES - 1) tronque = true;
  }

  const idsTaches = [...new Set(lus.map((l) => l.task_run_id).filter((id): id is string => Boolean(id)))];
  const taches = idsTaches.length
    ? new Map(
        (
          await filtrer<{ id: string; name: string }[]>(
            input.instance,
            "/task_runs/filter",
            { task_runs: { id: { any_: idsTaches } }, limit: 200 },
            "les tâches",
          ).catch(() => [])
        ).map((t) => [t.id, t.name]),
      )
    : new Map<string, string>();

  return {
    etat,
    enCours: ["RUNNING", "PENDING", "CANCELLING"].includes(etat),
    tronque,
    lignes: lus.reverse().map((l) => ({
      horodatage: l.timestamp,
      niveau: l.level,
      message: l.message,
      source: l.name ?? null,
      tache: l.task_run_id ? (taches.get(l.task_run_id) ?? null) : null,
    })),
  };
}
