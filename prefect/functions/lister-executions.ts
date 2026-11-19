import { execution, filtrer, type FlowRunPrefect, nomsFlows, prefect } from "../lib/prefect-api";

export default async function (input: {
  instance?: string;
  deploiement?: string;
  etats?: string[];
  texte?: string;
  limite?: number;
  decalage?: number;
}) {
  const limite = Math.min(Math.max(input.limite ?? 50, 1), 200);
  const flowRuns: Record<string, unknown> = { expected_start_time: { before_: new Date(Date.now() + 60_000).toISOString() } };
  if (input.deploiement) flowRuns.deployment_id = { any_: [input.deploiement] };
  if (input.etats?.length) flowRuns.state = { type: { any_: input.etats } };
  if (input.texte?.trim()) flowRuns.name = { like_: input.texte.trim() };

  const [runs, total] = await Promise.all([
    filtrer<FlowRunPrefect[]>(
      input.instance,
      "/flow_runs/filter",
      { flow_runs: flowRuns, sort: "EXPECTED_START_TIME_DESC", limit: limite, offset: Math.max(input.decalage ?? 0, 0) },
      "les exécutions",
    ),
    prefect(input.instance)
      .post<number>("/flow_runs/count", { flow_runs: flowRuns })
      .then((r) => (r.ok && typeof r.body === "number" ? r.body : null))
      .catch(() => null),
  ]);

  const idsDeploiements = [...new Set(runs.map((r) => r.deployment_id).filter((id): id is string => Boolean(id)))];
  const [flows, deploiements] = await Promise.all([
    nomsFlows(input.instance, runs.map((r) => r.flow_id)),
    idsDeploiements.length
      ? filtrer<{ id: string; name: string }[]>(
          input.instance,
          "/deployments/filter",
          { deployments: { id: { any_: idsDeploiements } }, limit: 200 },
          "les déploiements",
        ).then((liste) => new Map(liste.map((d) => [d.id, d.name])))
      : Promise.resolve(new Map<string, string>()),
  ]);

  return {
    total: total ?? runs.length,
    executions: runs.map((run) => ({
      ...execution(run),
      flux: flows.get(run.flow_id) ?? "",
      deploiement: run.deployment_id ? (deploiements.get(run.deployment_id) ?? null) : null,
      parametres: run.parameters ?? {},
    })),
  };
}
