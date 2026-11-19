import { executionOuDerniere } from "../lib/derniere-execution";
import { erreurPrefect, execution, filtrer, type FlowRunPrefect, nomsFlows, prefect } from "../lib/prefect-api";

export default async function (input: { instance?: string; execution?: string }) {
  const id = await executionOuDerniere(input.instance, input.execution);
  const reponse = await prefect(input.instance).get<FlowRunPrefect>(`/flow_runs/${encodeURIComponent(id)}`);
  if (!reponse.ok) throw erreurPrefect(reponse.status, "cette exécution", reponse.body);
  const run = reponse.body;

  const [flows, deploiement, taches] = await Promise.all([
    nomsFlows(input.instance, [run.flow_id]),
    run.deployment_id
      ? prefect(input.instance)
          .get<{ name: string }>(`/deployments/${encodeURIComponent(run.deployment_id)}`)
          .then((r) => (r.ok ? r.body.name : null))
          .catch(() => null)
      : Promise.resolve(null),
    filtrer<FlowRunPrefect[]>(
      input.instance,
      "/task_runs/filter",
      { flow_runs: { id: { any_: [run.id] } }, sort: "EXPECTED_START_TIME_ASC", limit: 200 },
      "les tâches de l’exécution",
    ),
  ]);

  return {
    execution: {
      ...execution(run),
      flux: flows.get(run.flow_id) ?? "",
      deploiement,
      parametres: run.parameters ?? {},
      tags: run.tags ?? [],
      tentatives: run.run_count ?? 0,
      pool: run.work_pool_name ?? null,
      file: run.work_queue_name ?? null,
      creePar: run.created_by?.display_value ?? null,
      cree: run.created ?? null,
    },
    taches: taches.map((tache) => {
      const t = execution(tache);
      return { id: t.id, nom: t.nom, etat: t.etat, etatNom: t.etatNom, debut: t.debut, fin: t.fin, duree: t.duree };
    }),
  };
}
