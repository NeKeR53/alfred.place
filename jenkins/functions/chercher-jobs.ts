import { type LireDossier, type NoeudJenkins, parcourirJobs } from "../lib/arbre-jobs";
import { lireFauxJenkins } from "../lib/faux-jenkins";
import { cheminJob, erreurJenkins, jenkins } from "../lib/jenkins-api";

function sansAccents(texte: string) {
  return texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Lit un dossier du compte : trois niveaux par demande, gardés une minute (la recherche relit à chaque frappe). */
function lireCompte(instance?: string): LireDossier {
  const client = jenkins(instance);
  return async (dossier, tree) => {
    const reponse = await client.get<{ jobs?: NoeudJenkins[] }>(
      `${dossier ? cheminJob(dossier) : ""}/api/json`,
      { tree },
      { cache: 60 },
    );
    if (!reponse.ok)
      throw erreurJenkins(reponse.status, dossier ? `le dossier « ${decodeURIComponent(dossier)} »` : "la liste des jobs");
    return reponse.body?.jobs ?? [];
  };
}

export default async function (input: { instance?: string; texte?: string; limite?: number; simulation?: boolean }) {
  const lire = input.simulation ? lireFauxJenkins : lireCompte(input.instance);
  const { jobs, incomplet } = await parcourirJobs(lire);

  const mots = sansAccents(input.texte ?? "").split(/\s+/).filter(Boolean);
  const retenus = jobs
    .filter((job) => {
      const cible = sansAccents(decodeURIComponent(job.chemin));
      return mots.every((mot) => cible.includes(mot));
    })
    .sort((a, b) => a.chemin.localeCompare(b.chemin, "fr"));

  return { total: retenus.length, incomplet, jobs: retenus.slice(0, input.limite ?? 200) };
}
