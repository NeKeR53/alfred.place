/**
 * Faux Jenkins en mémoire, pour les tests de `chercher-jobs` (entrée `simulation: true`).
 *
 * Il répond comme Jenkins à `/api/json?tree=…` : il ne rend que les niveaux demandés par `tree`, et refuse un
 * dossier (403). Ses jobs vont jusqu’à cinq niveaux de dossiers, dans des dossiers, un dossier d’organisation et un
 * pipeline multibranche.
 */
import type { LireDossier, NoeudJenkins } from "./arbre-jobs";

const DOSSIER = "com.cloudbees.hudson.plugins.folder.Folder";
const ORGANISATION = "jenkins.branch.OrganizationFolder";
const MULTIBRANCHE = "org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject";
const PIPELINE = "org.jenkinsci.plugins.workflow.job.WorkflowJob";
const LIBRE = "hudson.model.FreeStyleProject";

interface Faux {
  _class: string;
  name: string;
  color?: string;
  refuse?: boolean;
  jobs?: Faux[];
}

const job = (name: string, color: string, classe = LIBRE): Faux => ({ _class: classe, name, color });
const dossier = (name: string, jobs: Faux[], classe = DOSSIER): Faux => ({ _class: classe, name, jobs });

const RACINE: Faux[] = [
  job("front-web", "red"),
  dossier("plateforme", [
    dossier("equipes", [
      dossier("paiement", [
        dossier("services", [
          job("api-paiement", "blue", PIPELINE),
          dossier("batch", [job("rapprochement-nocturne", "yellow", PIPELINE)]),
        ]),
      ]),
      { _class: DOSSIER, name: "archives", refuse: true, jobs: [job("ancien-deploiement", "disabled")] },
    ]),
    dossier("outils", [job("migration-donnees", "notbuilt")]),
  ]),
  dossier(
    "github-acme",
    [
      dossier(
        "facturation",
        [job("main", "blue", PIPELINE), job("feature%2Fexport-pdf", "blue_anime", PIPELINE)],
        MULTIBRANCHE,
      ),
    ],
    ORGANISATION,
  ),
];

/** Nombre de niveaux qu’un `tree=jobs[…,jobs[…]]` demande. */
const niveauxDe = (tree: string) => (tree.match(/jobs\[/g) ?? []).length;

function copier(noeuds: Faux[], parents: string[], niveaux: number): NoeudJenkins[] {
  return noeuds.map((noeud) => {
    const chemin = [...parents, noeud.name];
    const copie: NoeudJenkins = {
      _class: noeud._class,
      name: noeud.name,
      fullName: chemin.join("/"),
      url: `https://jenkins.exemple.fr/${chemin.map((m) => `job/${encodeURIComponent(m)}/`).join("")}`,
    };
    if (noeud.color !== undefined) copie.color = noeud.color;
    if (noeud.jobs && niveaux > 1) copie.jobs = copier(noeud.jobs, chemin, niveaux - 1);
    return copie;
  });
}

export const lireFauxJenkins: LireDossier = async (dossier, tree) => {
  let noeuds = RACINE;
  const parents = dossier ? dossier.split("/") : [];
  for (const nom of parents) {
    const suivant = noeuds.find((n) => n.name === nom);
    if (!suivant?.jobs) throw new Error(`Jenkins ne trouve pas le dossier « ${dossier} ».`);
    if (suivant.refuse) throw new Error(`Ce compte n’a pas le droit d’accéder au dossier « ${dossier} ».`);
    noeuds = suivant.jobs;
  }
  return copier(noeuds, parents, niveauxDe(tree));
};
