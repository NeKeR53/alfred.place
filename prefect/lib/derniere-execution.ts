import { filtrer } from "./prefect-api";

/** Identifiant de l’exécution demandée, ou de la plus récente quand aucune n’est donnée. */
export async function executionOuDerniere(instance: string | undefined, id?: string): Promise<string> {
  if (id) return id;
  const runs = await filtrer<{ id: string }[]>(
    instance,
    "/flow_runs/filter",
    { flow_runs: { start_time: { is_null_: false } }, sort: "START_TIME_DESC", limit: 1 },
    "la dernière exécution",
  );
  if (!runs[0]) throw new Error("Cette instance Prefect n’a encore aucune exécution.");
  return runs[0].id;
}
