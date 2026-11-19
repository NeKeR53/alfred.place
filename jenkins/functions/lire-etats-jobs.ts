import { cheminJob, erreurJenkins, jenkins } from "../lib/jenkins-api";

interface BuildJenkins {
  number: number;
  result: string | null;
  building?: boolean;
  timestamp?: number;
  duration?: number;
  estimatedDuration?: number;
  url?: string;
}

interface JobJenkins {
  name: string;
  displayName?: string;
  url?: string;
  color?: string;
  buildable?: boolean;
  inQueue?: boolean;
  property?: { parameterDefinitions?: unknown[] }[];
  lastBuild?: BuildJenkins | null;
  lastCompletedBuild?: BuildJenkins | null;
}

const BUILD = "number,result,building,timestamp,duration,estimatedDuration,url";
// Une seule demande par dossier : tous ses jobs, avec leur dernier build.
const ARBRE = `jobs[name,displayName,url,color,buildable,inQueue,property[parameterDefinitions[name]],lastBuild[${BUILD}],lastCompletedBuild[${BUILD}]]`;

const iso = (horodatage?: number) => (horodatage ? new Date(horodatage).toISOString() : null);

function vide(chemin: string, nom: string, existe: boolean, erreur: string) {
  return { chemin, nom, url: null, existe, erreur, desactive: false, enFile: false, parametre: false, dernier: null, dernierTermine: null };
}

export default async function (input: { instance?: string; jobs: string[] }) {
  const demandes = [...new Set(input.jobs ?? [])].slice(0, 200);
  const client = jenkins(input.instance);

  // Regroupe les jobs par dossier parent.
  const parDossier = new Map<string, string[]>();
  for (const chemin of demandes) {
    const morceaux = chemin.split("/");
    const dossier = morceaux.slice(0, -1).join("/");
    parDossier.set(dossier, [...(parDossier.get(dossier) ?? []), chemin]);
  }

  const etats = new Map<string, ReturnType<typeof vide> | Record<string, unknown>>();
  await Promise.all(
    [...parDossier].map(async ([dossier, chemins]) => {
      const nomDe = (chemin: string) => chemin.split("/").pop() ?? chemin;
      try {
        const reponse = await client.get<{ jobs?: JobJenkins[] }>(`${dossier ? cheminJob(dossier) : ""}/api/json`, { tree: ARBRE });
        if (reponse.status === 404) {
          for (const chemin of chemins)
            etats.set(chemin, vide(chemin, decodeURIComponent(nomDe(chemin)), false, "Ce job n’existe plus dans Jenkins."));
          return;
        }
        if (!reponse.ok) throw erreurJenkins(reponse.status, dossier ? `le dossier « ${decodeURIComponent(dossier)} »` : "la liste des jobs");
        const parNom = new Map((reponse.body.jobs ?? []).map((job) => [job.name, job]));
        for (const chemin of chemins) {
          const job = parNom.get(nomDe(chemin));
          if (!job) {
            etats.set(chemin, vide(chemin, decodeURIComponent(nomDe(chemin)), false, "Ce job n’existe plus dans Jenkins."));
            continue;
          }
          const dernier = job.lastBuild;
          const termine = job.lastCompletedBuild;
          etats.set(chemin, {
            chemin,
            nom: decodeURIComponent(job.displayName ?? job.name),
            url: job.url ?? null,
            existe: true,
            erreur: null,
            desactive: job.buildable === false || job.color === "disabled",
            enFile: Boolean(job.inQueue),
            parametre: (job.property ?? []).some((p) => (p.parameterDefinitions?.length ?? 0) > 0),
            dernier: dernier
              ? {
                  numero: dernier.number,
                  resultat: dernier.result ?? null,
                  enCours: Boolean(dernier.building),
                  debut: iso(dernier.timestamp),
                  duree: dernier.duration ?? null,
                  dureeEstimee: dernier.estimatedDuration && dernier.estimatedDuration > 0 ? dernier.estimatedDuration : null,
                  url: dernier.url ?? null,
                }
              : null,
            dernierTermine: termine
              ? { numero: termine.number, resultat: termine.result ?? null, debut: iso(termine.timestamp), duree: termine.duration ?? null }
              : null,
          });
        }
      } catch (erreur) {
        for (const chemin of chemins) etats.set(chemin, vide(chemin, decodeURIComponent(nomDe(chemin)), true, (erreur as Error).message));
      }
    }),
  );

  return { jobs: demandes.map((chemin) => etats.get(chemin)) };
}
