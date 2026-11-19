import { erreurJenkins, jenkins } from "../lib/jenkins-api";

interface NoeudJenkins {
  _class?: string;
  name: string;
  fullName?: string;
  url?: string;
  color?: string;
  jobs?: NoeudJenkins[];
}

const CHAMPS = "_class,name,fullName,url,color";
// Quatre niveaux de dossiers : dossier / pipeline multibranche / branche…
const ARBRE = `jobs[${CHAMPS},jobs[${CHAMPS},jobs[${CHAMPS},jobs[${CHAMPS}]]]]`;

function sansAccents(texte: string) {
  return texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export default async function (input: { instance?: string; texte?: string; limite?: number }) {
  const reponse = await jenkins(input.instance).get<{ jobs?: NoeudJenkins[] }>("/api/json", { tree: ARBRE });
  if (!reponse.ok) throw erreurJenkins(reponse.status, "la liste des jobs");

  const trouves: { chemin: string; nom: string; dossier: string; etat: string; url: string }[] = [];
  const parcourir = (noeuds: NoeudJenkins[] | undefined, parents: string[]) => {
    for (const noeud of noeuds ?? []) {
      const chemin = noeud.fullName ?? [...parents, noeud.name].join("/");
      // Un job qui se lance a une couleur ; un dossier n’en a pas.
      if (noeud.color !== undefined) {
        const morceaux = chemin.split("/");
        trouves.push({
          chemin,
          nom: decodeURIComponent(morceaux[morceaux.length - 1] ?? noeud.name),
          dossier: morceaux.slice(0, -1).map((m) => decodeURIComponent(m)).join(" / "),
          etat: noeud.color ?? "notbuilt",
          url: noeud.url ?? "",
        });
      }
      if (noeud.jobs) parcourir(noeud.jobs, chemin.split("/"));
    }
  };
  parcourir(reponse.body?.jobs, []);

  const mots = sansAccents(input.texte ?? "").split(/\s+/).filter(Boolean);
  const retenus = trouves
    .filter((job) => {
      const cible = sansAccents(decodeURIComponent(job.chemin));
      return mots.every((mot) => cible.includes(mot));
    })
    .sort((a, b) => a.chemin.localeCompare(b.chemin, "fr"));

  return { total: retenus.length, jobs: retenus.slice(0, input.limite ?? 200) };
}
