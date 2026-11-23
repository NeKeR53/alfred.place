import { db, functions, shell } from "@alfred/sdk";
import { analyserExecution, recompterNonLus } from "../lib/rapport";

/** Seuls les échecs récents sont analysés d’eux-mêmes : les plus anciens restent à la demande. */
const FENETRE = 24 * 3600_000;
/** Une analyse restée « en cours » plus longtemps a été interrompue : elle est reprise. */
const INTERROMPUE = 15 * 60_000;
const PAR_PASSAGE = 2;
const ECHECS = new Set(["FAILED", "CRASHED"]);

interface ExecutionListee {
  id: string;
  nom: string;
  etat: string;
  flux: string;
  deploiement: string | null;
  fin: string | null;
  debut: string | null;
}

export default async function () {
  const { comptes } = await functions.call<{ comptes: { id: string }[] }>("comptes-prefect", {});
  const maintenant = Date.now();
  const candidats: { instance: string; execution: ExecutionListee }[] = [];
  let illisibles = 0;
  for (const compte of comptes) {
    try {
      const { executions } = await functions.call<{ executions: ExecutionListee[] }>("lister-executions", {
        instance: compte.id,
        etats: ["FAILED", "CRASHED"],
        limite: 20,
      });
      for (const execution of executions) {
        if (!ECHECS.has(execution.etat)) continue;
        const fin = execution.fin ?? execution.debut;
        if (fin && maintenant - new Date(fin).getTime() <= FENETRE) candidats.push({ instance: compte.id, execution });
      }
    } catch {
      illisibles++;
    }
  }

  const connus = candidats.length
    ? await db.query<{ execution: string; statut: string; cree_le: string }>(
        `SELECT execution, statut, cree_le FROM prefect_analyses WHERE execution IN (${candidats.map(() => "?").join(", ")})`,
        candidats.map((c) => c.execution.id),
      )
    : [];
  const aFaire = candidats.filter((c) => {
    const connu = connus.find((r) => r.execution === c.execution.id);
    if (!connu) return true;
    return connu.statut === "en_cours" && maintenant - new Date(`${connu.cree_le.replace(" ", "T")}Z`).getTime() > INTERROMPUE;
  });

  const lot = aFaire.slice(0, PAR_PASSAGE);
  const resultats = await Promise.allSettled(lot.map((c) => analyserExecution({ instance: c.instance, execution: c.execution.id })));
  let echouees = 0;
  for (const [index, resultat] of resultats.entries()) {
    const { execution } = lot[index];
    const nom = execution.deploiement ? `${execution.flux} ${execution.deploiement}` : execution.flux;
    if (resultat.status === "fulfilled") {
      await shell.notify({
        title: `L’exécution ${nom} a échoué`,
        description: resultat.value.cause ?? `L’exécution ${execution.nom} a échoué.`,
        tone: "error",
      });
    } else {
      echouees++;
      await shell.notify({
        title: `L’exécution ${nom} a échoué`,
        description: `L’exécution ${execution.nom} a échoué, mais je n’ai pas pu analyser ses logs.`,
        tone: "error",
      });
    }
  }

  return {
    analyses: lot.length - echouees,
    echouees,
    enAttente: aFaire.length - lot.length,
    comptesIllisibles: illisibles,
    nonLus: await recompterNonLus(),
  };
}
