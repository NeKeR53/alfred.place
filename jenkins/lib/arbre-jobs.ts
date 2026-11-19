/**
 * Parcours de l’arbre des jobs Jenkins, à n’importe quelle profondeur.
 *
 * Une demande lit trois niveaux d’un dossier (`tree=jobs[…,jobs[…,jobs[…]]]`) ; un dossier trouvé au dernier niveau
 * est relu à son tour, par sa propre adresse. Jenkins n’a donc jamais à rendre tout l’arbre d’un coup, et un job à
 * huit dossiers de profondeur est trouvé comme un autre. Le parcours s’arrête à un nombre de demandes et à une
 * profondeur raisonnables, et le dit (`incomplet`).
 *
 * Ce fichier n’importe rien du SDK : la lecture d’un dossier lui est passée, ce qui permet de le tester sur un faux
 * Jenkins (`faux-jenkins.ts`).
 */

export interface NoeudJenkins {
  _class?: string;
  name: string;
  fullName?: string;
  url?: string;
  color?: string;
  jobs?: NoeudJenkins[];
}

export interface JobTrouve {
  chemin: string;
  nom: string;
  dossier: string;
  etat: string;
  url: string;
}

/** Lit les jobs d’un dossier (« » pour la racine), avec l’arbre `tree` demandé. */
export type LireDossier = (dossier: string, tree: string) => Promise<NoeudJenkins[]>;

const CHAMPS = "_class,name,fullName,url,color";
/** Niveaux lus par demande : assez pour un dossier / multibranche / branche, sans alourdir la réponse de Jenkins. */
export const NIVEAUX_PAR_DEMANDE = 3;

/** `jobs[champs,jobs[champs,jobs[champs]]]` pour `niveaux` niveaux. */
export function arbre(niveaux = NIVEAUX_PAR_DEMANDE): string {
  let tree = `jobs[${CHAMPS}]`;
  for (let i = 1; i < niveaux; i += 1) tree = `jobs[${CHAMPS},${tree}]`;
  return tree;
}

/** Classes Jenkins qui contiennent d’autres jobs, sans se lancer elles-mêmes. */
const DOSSIERS = [
  "com.cloudbees.hudson.plugins.folder.Folder",
  "jenkins.branch.OrganizationFolder",
  "org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject",
];

/** Un job se lance et porte une couleur ; un dossier (dossier, organisation, multibranche) n’en a pas. */
const estDossier = (noeud: NoeudJenkins) =>
  noeud.color === undefined && (noeud._class === undefined || DOSSIERS.includes(noeud._class) || /Folder|MultiBranch/.test(noeud._class));

export interface Limites {
  /** Nombre de demandes à Jenkins au plus (200 par défaut). */
  demandes?: number;
  /** Profondeur de dossiers au plus (30 par défaut). */
  profondeur?: number;
  /** Demandes menées en même temps (4 par défaut). */
  parallele?: number;
}

export interface Parcours {
  jobs: JobTrouve[];
  /** Vrai si des dossiers n’ont pas pu être lus (droits, erreur) ou si une limite a arrêté le parcours. */
  incomplet: boolean;
  demandes: number;
}

export async function parcourirJobs(lire: LireDossier, limites: Limites = {}): Promise<Parcours> {
  const maxDemandes = limites.demandes ?? 200;
  const maxProfondeur = limites.profondeur ?? 30;
  const parallele = Math.max(1, limites.parallele ?? 4);
  const tree = arbre();

  const trouves = new Map<string, JobTrouve>();
  const vus = new Set<string>();
  let demandes = 0;
  let incomplet = false;

  // File des dossiers à lire : nom complet et profondeur du dossier.
  const file: { dossier: string; profondeur: number }[] = [{ dossier: "", profondeur: 0 }];

  const ranger = (noeuds: NoeudJenkins[] | undefined, parents: string[], niveau: number, profondeur: number) => {
    for (const noeud of noeuds ?? []) {
      const chemin = noeud.fullName ?? [...parents, noeud.name].join("/");
      const morceaux = chemin.split("/");
      if (noeud.color !== undefined) {
        trouves.set(chemin, {
          chemin,
          nom: decodeURIComponent(morceaux[morceaux.length - 1] ?? noeud.name),
          dossier: morceaux.slice(0, -1).map((m) => decodeURIComponent(m)).join(" / "),
          etat: noeud.color || "notbuilt",
          url: noeud.url ?? "",
        });
      }
      if (noeud.jobs) {
        ranger(noeud.jobs, morceaux, niveau + 1, profondeur + 1);
      } else if (niveau === NIVEAUX_PAR_DEMANDE && estDossier(noeud)) {
        // Dossier au dernier niveau lu : son contenu n’a pas été demandé, il sera lu à son tour.
        if (profondeur + 1 > maxProfondeur) incomplet = true;
        else if (!vus.has(chemin)) {
          vus.add(chemin);
          file.push({ dossier: chemin, profondeur: profondeur + 1 });
        }
      }
    }
  };

  const lireUn = async ({ dossier, profondeur }: { dossier: string; profondeur: number }) => {
    demandes += 1;
    try {
      const noeuds = await lire(dossier, tree);
      ranger(noeuds, dossier ? dossier.split("/") : [], 1, profondeur);
    } catch (erreur) {
      // La racine illisible rend la recherche impossible ; un sous-dossier illisible est seulement signalé.
      if (!dossier) throw erreur;
      incomplet = true;
    }
  };

  while (file.length > 0) {
    if (demandes >= maxDemandes) {
      incomplet = true;
      break;
    }
    const lot = file.splice(0, Math.min(parallele, maxDemandes - demandes));
    await Promise.all(lot.map(lireUn));
  }

  return { jobs: [...trouves.values()], incomplet, demandes };
}
