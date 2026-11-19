import { execution, filtrer, type FlowRunPrefect } from "../lib/prefect-api";

const ACTIFS = new Set(["RUNNING", "PENDING", "CANCELLING"]);

function mediane(valeurs: number[]): number | null {
  if (valeurs.length === 0) return null;
  const triees = [...valeurs].sort((a, b) => a - b);
  return triees[Math.floor(triees.length / 2)];
}

export default async function (input: { instance?: string; deploiements: string[] }) {
  const ids = [...new Set(input.deploiements ?? [])].slice(0, 60);
  const maintenant = new Date(Date.now() + 60_000).toISOString();

  const deploiements = await Promise.all(
    ids.map(async (id) => {
      try {
        const [recentes, prochaines] = await Promise.all([
          filtrer<FlowRunPrefect[]>(
            input.instance,
            "/flow_runs/filter",
            {
              flow_runs: { deployment_id: { any_: [id] }, expected_start_time: { before_: maintenant } },
              sort: "EXPECTED_START_TIME_DESC",
              limit: 8,
            },
            "les exécutions du déploiement",
          ),
          filtrer<FlowRunPrefect[]>(
            input.instance,
            "/flow_runs/filter",
            {
              flow_runs: {
                deployment_id: { any_: [id] },
                state: { type: { any_: ["SCHEDULED"] } },
                expected_start_time: { after_: maintenant },
              },
              sort: "EXPECTED_START_TIME_ASC",
              limit: 1,
            },
            "la prochaine exécution",
          ),
        ]);
        const lues = recentes.map(execution);
        const terminees = lues.filter((r) => r.etat === "COMPLETED" && r.duree).map((r) => r.duree as number);
        const prochaine = prochaines[0];
        return {
          id,
          erreur: null,
          dernier: lues[0] ?? null,
          recentes: lues.map((r) => ({ id: r.id, nom: r.nom, etat: r.etat, etatNom: r.etatNom, debut: r.debut ?? r.debutPrevu })),
          enCours: lues.filter((r) => ACTIFS.has(r.etat)).length,
          dureeHabituelle: mediane(terminees),
          prochaine: prochaine ? { id: prochaine.id, nom: prochaine.name, debutPrevu: prochaine.expected_start_time ?? null } : null,
        };
      } catch (erreur) {
        return { id, erreur: (erreur as Error).message, dernier: null, recentes: [], enCours: 0, dureeHabituelle: null, prochaine: null };
      }
    }),
  );

  return { deploiements };
}
