/**
 * Faux Prefect en mémoire, pour les tests de `lister-deploiements` (entrée `simulation: true`).
 *
 * 260 déploiements répartis sur 230 flows, dont 20 suspendus, 40 sans planification ni exécution, et deux
 * déploiements de même nom dans deux flows différents. Comme Prefect, il ne rend jamais plus de 200 éléments par
 * demande et honore `offset`, `limit` et le filtre `name.like_`.
 */
import type { DeploiementPrefect } from "./prefect-api";
import { type Poste } from "./liste-deploiements";

const MAX = 200;

const DEPLOIEMENTS: DeploiementPrefect[] = Array.from({ length: 260 }, (_, i) => {
  const n = String(i + 1).padStart(3, "0");
  const suspendu = i % 13 === 5;
  const sansExecution = i >= 220;
  return {
    id: `dep-${n}`,
    name: i === 259 ? "export-quotidien" : i === 258 ? "export-quotidien" : `deploiement-${n}`,
    flow_id: `flow-${String((i % 230) + 1).padStart(3, "0")}`,
    tags: suspendu ? ["suspendu"] : sansExecution ? ["nouveau"] : [],
    work_pool_name: "pool-k8s",
    paused: suspendu,
    status: sansExecution ? "NOT_READY" : "READY",
    schedules: sansExecution ? [] : [{ active: true, schedule: { cron: "0 * * * *" } }],
    parameters: {},
  };
});

const FLOWS = Array.from({ length: 230 }, (_, i) => ({ id: `flow-${String(i + 1).padStart(3, "0")}`, name: `flux-${i + 1}` }));

export const SUSPENDUS = DEPLOIEMENTS.filter((d) => d.paused).length;

export const posteFauxPrefect: Poste = async <T>(chemin: string, corps: unknown) => {
  const c = (corps ?? {}) as {
    deployments?: { name?: { like_?: string } };
    flows?: { id?: { any_?: string[] } };
    sort?: string;
    limit?: number;
    offset?: number;
  };
  const limite = Math.min(c.limit ?? MAX, MAX);
  const debut = c.offset ?? 0;
  if (chemin === "/deployments/filter") {
    const like = c.deployments?.name?.like_?.toLowerCase();
    const choisis = DEPLOIEMENTS.filter((d) => !like || d.name.toLowerCase().includes(like)).sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
    return choisis.slice(debut, debut + limite) as T;
  }
  if (chemin === "/deployments/count") {
    const like = c.deployments?.name?.like_?.toLowerCase();
    return DEPLOIEMENTS.filter((d) => !like || d.name.toLowerCase().includes(like)).length as T;
  }
  if (chemin === "/flows/filter") {
    const ids = new Set(c.flows?.id?.any_ ?? []);
    return FLOWS.filter((f) => ids.has(f.id)).slice(0, limite) as T;
  }
  throw new Error(`Le faux Prefect ne connaît pas ${chemin}.`);
};
