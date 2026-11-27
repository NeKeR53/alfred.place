// Données de la page Usine, comme l’Usine de OneApp : une ligne par conteneur, une colonne par environnement, les
// conteneurs regroupés par pile (le produit de OneApp), l’état de chaque case et ses écarts de version.
import { functions } from "./source";
import type { StatusMap } from "socle-ui";
import { environnementsAvec } from "./environnements";

export type EnvPortainer = Awaited<ReturnType<typeof environnementsAvec>>[number];
export type Conteneur = {
  id: string;
  nom: string;
  image: string;
  etat: string;
  statut: string;
  pile: string | null;
  service: string | null;
  creeLe: string | null;
  /** Adresse de l’application servie par le conteneur (étiquette `atom.url` ou règle Traefik), sinon absente. */
  url?: string | null;
};
export type Pile = { id: number; nom: string; etat: string; type: string; modifieLe: string | null; variables: string[] };
export type Cellule = { env: EnvPortainer; conteneur: Conteneur };
/** Une ligne de l’Usine : un conteneur (son nom), avec son service et sa pile. */
export type Ligne = {
  cle: string;
  pile: string;
  service: string;
  conteneur: string;
  /** Première ligne de son service : le nom du service n’est écrit qu’une fois, comme le composant dans OneApp. */
  premier: boolean;
  cellules: Record<string, Cellule>;
};

export const ETATS_CONTENEUR: StatusMap = {
  running: { label: "En marche", tone: "success" },
  restarting: { label: "Redémarre", tone: "warning" },
  paused: { label: "En pause", tone: "warning" },
  created: { label: "Créé", tone: "pending" },
  exited: { label: "Arrêté", tone: "neutral" },
  dead: { label: "En échec", tone: "danger" },
};

/** Version lue dans l’image (« registre/atom/portail-web:2.4.1 » → « 2.4.1 ») ; sans étiquette, « latest ». */
export const version = (image: string) => {
  const nom = image.split("/").pop() ?? image;
  return nom.includes(":") ? nom.slice(nom.indexOf(":") + 1) : nom.includes("@") ? "digest" : "latest";
};

export type Usine = {
  envs: EnvPortainer[];
  lignes: Ligne[];
  /** Nombre de piles (les « produits » du résumé). */
  piles: number;
  erreurs: { env: EnvPortainer; message: string }[];
};

const SANS_PILE = "Sans pile";

export async function lireUsine(): Promise<Usine> {
  const envs = await environnementsAvec("portainer");
  const lectures = await Promise.all(
    envs.map(async (env) => {
      try {
        const { conteneurs } = await functions.call<{ conteneurs: Conteneur[] }>("portainer/lister-conteneurs", { instance: env.instance });
        return { env, conteneurs, erreur: null as string | null };
      } catch (erreur) {
        return { env, conteneurs: [] as Conteneur[], erreur: (erreur as Error).message };
      }
    }),
  );
  const lignes = new Map<string, Omit<Ligne, "premier">>();
  for (const { env, conteneurs } of lectures)
    for (const conteneur of conteneurs) {
      const cle = conteneur.nom.replace(/^\/+/, "").toLocaleLowerCase();
      const ligne = lignes.get(cle) ?? {
        cle,
        pile: conteneur.pile ?? SANS_PILE,
        service: conteneur.service ?? conteneur.nom.replace(/[-_]\d+$/, ""),
        conteneur: conteneur.nom,
        cellules: {},
      };
      ligne.cellules[env.id] = { env, conteneur };
      lignes.set(cle, ligne);
    }
  // Comme OneApp : par pile, puis par service, puis par nom de conteneur (numéros dans l’ordre).
  const triees = [...lignes.values()].sort(
    (a, b) =>
      a.pile.localeCompare(b.pile, "fr") ||
      a.service.localeCompare(b.service, "fr") ||
      a.conteneur.localeCompare(b.conteneur, "fr", { numeric: true }),
  );
  return {
    envs,
    lignes: triees.map((ligne, index) => ({
      ...ligne,
      premier: index === 0 || triees[index - 1].service !== ligne.service || triees[index - 1].pile !== ligne.pile,
    })),
    piles: new Set(triees.map((ligne) => ligne.pile)).size,
    erreurs: lectures.filter((lecture) => lecture.erreur).map((lecture) => ({ env: lecture.env, message: lecture.erreur as string })),
  };
}

export type Ton = "success" | "warning" | "danger" | "neutral";

/**
 * État d’une case, comme `deploymentMatrixState` de OneApp : version, note sous la version, ton et libellé complet.
 * Un conteneur arrêté ou qui redémarre est orange, un conteneur en échec rouge, une autre version que celle attendue
 * orange (« attendu 2.4.1 »), une case sans conteneur grise (« non déployé »).
 */
export function etatCase(cellule: Cellule | undefined, attendue: string | undefined) {
  if (!cellule)
    return { ton: "neutral" as Ton, version: "—", note: "non déployé", age: undefined, libelle: "Non déployé", present: false, ecart: false };
  const { conteneur } = cellule;
  const v = version(conteneur.image);
  const age = ageConteneur(conteneur.creeLe);
  if (conteneur.etat === "dead") return { ton: "danger" as Ton, version: v, note: "en échec", age, libelle: `En échec · ${v}`, present: true, ecart: true };
  if (conteneur.etat !== "running") {
    const etat = (ETATS_CONTENEUR[conteneur.etat]?.label ?? conteneur.etat).toLocaleLowerCase("fr");
    return { ton: "warning" as Ton, version: v, note: etat, age, libelle: `${etat[0]?.toLocaleUpperCase("fr")}${etat.slice(1)} · ${v}`, present: true, ecart: true };
  }
  if (attendue && v !== attendue)
    return { ton: "warning" as Ton, version: v, note: `attendu ${attendue}`, age, libelle: `${v} → ${attendue}`, present: true, ecart: true };
  return { ton: "success" as Ton, version: v, note: "", age, libelle: v, present: true, ecart: false };
}

/** « 2 j », « 3 h », « 12 min », comme `formatContainerAge` de OneApp ; rien sans date. */
export function ageConteneur(date: string | null | undefined) {
  if (!date) return undefined;
  const minutes = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  if (minutes < 1440) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} j`;
}

/** Version la plus fréquente d’un conteneur dans les environnements : celle qu’on attend partout. */
export function versionAttendue(ligne: Ligne) {
  const comptes = new Map<string, number>();
  for (const cellule of Object.values(ligne.cellules)) {
    const v = version(cellule.conteneur.image);
    comptes.set(v, (comptes.get(v) ?? 0) + 1);
  }
  const triees = [...comptes].sort((a, b) => b[1] - a[1]);
  // À égalité, aucune version n’est « attendue ».
  return triees.length > 1 && triees[0][1] === triees[1][1] ? undefined : triees[0]?.[0];
}

/** Santé d’un environnement dans l’en-tête : « N écarts », « x/y sains » ou rien sans conteneur. */
export function santeEnv(lignes: Ligne[], env: string) {
  const cases = lignes.filter((ligne) => ligne.cellules[env]).map((ligne) => etatCase(ligne.cellules[env], versionAttendue(ligne)));
  if (!cases.length) return { texte: "", ton: "neutral" as const };
  const ecarts = cases.filter((etat) => etat.ecart).length;
  if (ecarts) return { texte: `${ecarts} écart${ecarts > 1 ? "s" : ""}`, ton: "warning" as const };
  const sains = cases.filter((etat) => etat.ton === "success").length;
  return { texte: `${sains}/${cases.length} sains`, ton: sains === cases.length ? ("success" as const) : ("neutral" as const) };
}

/** Ce qu’une fenêtre de déploiement reçoit en paramètres : de quoi rejoindre le conteneur et le nommer. */
export type CibleDeploiement = {
  outil: "logs" | "console";
  instance: string;
  conteneur: string;
  nom: string;
  envNom: string;
  service: string;
  etat: string;
};

export function cibleDeploiement(outil: CibleDeploiement["outil"], ligne: Ligne, cellule: Cellule): CibleDeploiement {
  return {
    outil,
    instance: cellule.env.instance,
    conteneur: cellule.conteneur.id,
    nom: cellule.conteneur.nom,
    envNom: cellule.env.nom,
    service: ligne.service,
    etat: cellule.conteneur.etat,
  };
}

/** Lit les paramètres d’une fenêtre de déploiement ; `null` s’ils sont incomplets. */
export function lireCible(params: Record<string, unknown> | null | undefined): CibleDeploiement | null {
  if (!params) return null;
  const outil = params.outil;
  const champs = ["instance", "conteneur", "nom", "envNom"] as const;
  if ((outil !== "logs" && outil !== "console") || champs.some((champ) => typeof params[champ] !== "string" || !params[champ])) return null;
  return {
    outil,
    instance: String(params.instance),
    conteneur: String(params.conteneur),
    nom: String(params.nom),
    envNom: String(params.envNom),
    service: typeof params.service === "string" ? params.service : String(params.nom),
    etat: typeof params.etat === "string" ? params.etat : "running",
  };
}
