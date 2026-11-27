// Secrets : la vue d’ensemble et l’inventaire de OneApp, lus dans OpenBao par le connecteur openbao (valeurs scellées).
// Un composant logiciel est un dossier <produit>/<composant> du coffre ; il hérite des secrets partagés du produit
// (<produit>/shared) et de l’environnement (shared), comme dans OneApp. Aucune valeur n’arrive jamais ici : seulement
// les noms des clés, et des références scellées que la coquille affiche, copie ou écrit dans un .env.
import { DEMO_LECTURE_SEULE } from "./demo";
import { environnementsAvec } from "./environnements";
import { lireReglages, projetsSuivis } from "./reglages";
import { enDemo, functions, secrets } from "./source";

export type EnvOpenBao = Awaited<ReturnType<typeof environnementsAvec>>[number];
/** Ce qu’il faut d’un environnement pour lire ou copier dans son coffre. */
export type Coffre = Pick<EnvOpenBao, "instance" | "nom">;
export type Secret = { chemin: string; trouve: boolean; version: number; cles: string[]; valeurs: Record<string, string> };

/** Portée d’une référence : d’où elle vient dans la hiérarchie du composant. */
export type Portee = "environment" | "product" | "component" | "shared";
export const LIBELLES_PORTEE: Record<Portee, string> = {
  environment: "Environnement",
  product: "Produit logiciel",
  component: "Composant logiciel",
  shared: "Partagé",
};

/** Une clé d’un document OpenBao, vue depuis un composant : son document (`emplacement`), sa clé, sa portée. */
export type Reference = { id: string; emplacement: string; cle: string; portee: Portee };

// ------------------------------------------------------------------------------------------------ Chemins
const segments = (chemin: string | undefined) =>
  (chemin ?? "")
    .split("/")
    .map((segment) => segment.trim().toLocaleLowerCase())
    .filter(Boolean);

const partieNom = (valeur: string) =>
  valeur
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

/** Nom de variable d’environnement d’une clé, comme OneApp : segments du document puis clé (ATOM_WEB_CONFIG_DB_URL). */
export const nomVariable = (emplacement: string, cle: string) =>
  [...emplacement.split("/").filter(Boolean), cle].map(partieNom).filter(Boolean).join("_");

export const cheminProduit = (produit: string) => segments(produit).join("/");
export const cheminComposant = (produit: string, composant: string) => [...segments(produit), ...segments(composant)].join("/");
/** Chemin d’un nouveau secret : le dossier de la portée choisie, puis le nom saisi, en minuscules. */
export function cheminSecret(base: string, nom: string) {
  const parties = segments(nom);
  return parties.length ? [...segments(base), ...parties].join("/") : "";
}

/** Niveaux lus pour un composant : lui-même, puis les dossiers « shared » de ses parents (produit, environnement). */
export function hierarchie(composant: string): { portee: Portee; chemin: string }[] {
  const parties = segments(composant);
  if (!parties.length) return [];
  const niveaux: { portee: Portee; chemin: string }[] = [{ portee: "component", chemin: parties.join("/") }];
  for (let distance = 1; distance <= parties.length; distance += 1) {
    const portee: Portee = distance === parties.length ? "environment" : distance === 1 ? "product" : "shared";
    niveaux.push({ portee, chemin: [...parties.slice(0, -distance), "shared"].join("/") });
  }
  return [...new Map(niveaux.map((niveau) => [niveau.chemin, niveau])).values()];
}

/** Fusionne les niveaux : une même clé au même document relatif n’est gardée qu’au niveau le plus proche. */
export function fusionner(niveaux: readonly { chemin: string; references: readonly Reference[] }[]) {
  const vues = new Map<string, Reference>();
  for (const { chemin, references } of niveaux)
    for (const reference of references) {
      const document = reference.emplacement.startsWith(`${chemin}/`)
        ? reference.emplacement.slice(chemin.length + 1)
        : reference.emplacement === chemin
          ? ""
          : reference.emplacement;
      const identite = JSON.stringify([document, reference.cle]);
      if (!vues.has(identite)) vues.set(identite, reference);
    }
  return [...vues.values()];
}

/** Seules les clés du composant et du produit se modifient ici ; les secrets hérités restent en lecture seule. */
export const gerable = (reference: Pick<Reference, "portee">) => reference.portee === "product" || reference.portee === "component";

/** Dossiers de composants d’un produit : sans « shared », sans doublon, par ordre alphabétique. */
export function dossiersComposants(dossiers: readonly string[]) {
  const vus = new Map<string, string>();
  for (const dossier of dossiers) {
    const nom = dossier.trim();
    const identite = nom.toLocaleLowerCase("fr");
    if (nom && identite !== "shared" && !vus.has(identite)) vus.set(identite, nom);
  }
  return [...vus.values()].sort((a, b) => a.localeCompare(b, "fr"));
}

/** « Atom » pour le dossier « atom » : le nom affiché d’un produit. */
export const libelleProduit = (produit: string) => produit.charAt(0).toLocaleUpperCase("fr") + produit.slice(1);

// ------------------------------------------------------------------------------------------------ Lectures OpenBao
export const lireSecret = (env: Pick<EnvOpenBao, "instance">, chemin: string) => functions.call<Secret>("openbao/lire-secret", { instance: env.instance, chemin });
export const listerDossier = (env: Pick<EnvOpenBao, "instance">, chemin: string) =>
  functions.call<{ dossiers: string[]; secrets: string[] }>("openbao/lister-dossier", { instance: env.instance, chemin });

const PROFONDEUR = 8;
const joindre = (dossier: string, nom: string) => (dossier ? `${dossier}/${nom}` : nom);

/** Documents sous un dossier, à toute profondeur. */
async function documentsSous(env: Pick<EnvOpenBao, "instance">, dossier: string, profondeur = 0): Promise<string[]> {
  const niveau = await listerDossier(env, dossier);
  const ici = niveau.secrets.map((nom) => joindre(dossier, nom));
  if (profondeur >= PROFONDEUR) return ici;
  const dessous = await Promise.all(niveau.dossiers.map((nom) => documentsSous(env, joindre(dossier, nom), profondeur + 1)));
  return [...ici, ...dessous.flat()];
}

/** Clés du document `chemin` lui-même et de tous les documents dessous, avec leur portée. */
export async function listerReferences(env: Pick<EnvOpenBao, "instance">, chemin: string, portee: Portee): Promise<Reference[]> {
  const [lui, dessous] = await Promise.all([lireSecret(env, chemin), documentsSous(env, chemin)]);
  const documents = await Promise.all(dessous.map((emplacement) => lireSecret(env, emplacement)));
  return [lui, ...documents]
    .filter((document) => document.trouve)
    .flatMap((document) => document.cles.map((cle) => ({ id: `${document.chemin}#${cle}`, emplacement: document.chemin, cle, portee })));
}

export type Listeur = (env: EnvOpenBao, chemin: string, portee: Portee) => Promise<Reference[]>;
/** Partage les lectures d’un même chargement : un niveau commun n’est lu qu’une fois par environnement. */
export function listeurPartage(): Listeur {
  const lectures = new Map<string, Promise<Reference[]>>();
  return (env, chemin, portee) => {
    const cle = JSON.stringify([env.instance, chemin, portee]);
    let lecture = lectures.get(cle);
    if (!lecture) {
      lecture = listerReferences(env, chemin, portee);
      lectures.set(cle, lecture);
    }
    return lecture;
  };
}

/** Références d’un composant dans un environnement : ses niveaux lus puis fusionnés. */
export async function referencesComposant(env: EnvOpenBao, produit: string, composant: string, lister: Listeur = listerReferences) {
  const niveaux = await Promise.all(
    hierarchie(cheminComposant(produit, composant)).map(async ({ portee, chemin }) => ({ chemin, references: await lister(env, chemin, portee) })),
  );
  return fusionner(niveaux);
}

// ------------------------------------------------------------------------------------------------ Vue d’ensemble
export type Cible = { produit: string; composant: string };
export const cleCible = ({ produit, composant }: Cible) => `${produit}|${composant}`;
export const cleChargee = (produit: string, composant: string, env: string) => `${produit}|${composant}|${env}`;

/** Une variable d’un composant : présente ou non dans chaque environnement, et le document qui la porte. */
export type Ligne = {
  nom: string;
  cle: string;
  portee: Portee;
  produit: string;
  composant: string;
  presente: Record<string, boolean>;
  emplacements: Record<string, string>;
};
export type ResultatCible = { lignes: Ligne[]; charges: string[]; erreurs: string[] };

/** Produits (dossiers de la racine) et leurs composants, dans tous les environnements reliés à OpenBao. */
export async function decouvrirCibles(envs: readonly EnvOpenBao[]) {
  const [reglages] = await Promise.all([lireReglages()]);
  const ordre = projetsSuivis(reglages["secrets.ordre"]).map((nom) => nom.toLowerCase());
  const parProduit = new Map<string, Set<string>>();
  const erreurs: string[] = [];
  await Promise.all(
    envs.map(async (env) => {
      try {
        const racine = await listerDossier(env, "");
        await Promise.all(
          dossiersComposants(racine.dossiers).map(async (produit) => {
            const composants = dossiersComposants((await listerDossier(env, produit)).dossiers);
            const connus = parProduit.get(produit) ?? new Set<string>();
            for (const composant of composants) connus.add(composant);
            parProduit.set(produit, connus);
          }),
        );
      } catch (erreur) {
        erreurs.push(`${env.nom} : ${(erreur as Error).message}`);
      }
    }),
  );
  const rang = (composant: string) => {
    const index = ordre.indexOf(composant.toLowerCase());
    return index < 0 ? ordre.length : index;
  };
  const cibles = [...parProduit]
    .sort(([a], [b]) => a.localeCompare(b, "fr"))
    .flatMap(([produit, composants]) =>
      [...composants].sort((a, b) => rang(a) - rang(b) || a.localeCompare(b, "fr")).map((composant) => ({ produit, composant })),
    );
  return { cibles, erreurs };
}

/** Lignes d’un composant, dès que ses environnements sont lus ; un environnement en échec reste « non lu ». */
export async function chargerCible({ produit, composant }: Cible, envs: readonly EnvOpenBao[], lister: Listeur): Promise<ResultatCible> {
  const parEnv = new Map<string, Reference[]>();
  const erreurs: string[] = [];
  await Promise.all(
    envs.map(async (env) => {
      try {
        parEnv.set(env.id, await referencesComposant(env, produit, composant, lister));
      } catch (erreur) {
        erreurs.push(`${libelleProduit(produit)} › ${composant} · ${env.nom} : ${(erreur as Error).message}`);
      }
    }),
  );
  const lignes = new Map<string, Ligne>();
  for (const env of envs)
    for (const reference of parEnv.get(env.id) ?? []) {
      const nom = nomVariable(reference.emplacement, reference.cle);
      const ligne = lignes.get(nom) ?? { nom, cle: reference.cle, portee: reference.portee, produit, composant, presente: {}, emplacements: {} };
      ligne.presente[env.id] = true;
      ligne.emplacements[env.id] = reference.emplacement;
      lignes.set(nom, ligne);
    }
  return {
    lignes: [...lignes.values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr")),
    charges: [...parEnv.keys()].map((env) => cleChargee(produit, composant, env)),
    erreurs,
  };
}

/** Nombre de variables manquantes par environnement (environnements lus seulement). */
export function manquantsParEnv(lignes: readonly Ligne[], envs: readonly Pick<EnvOpenBao, "id" | "nom">[], charges: ReadonlySet<string>) {
  return envs
    .map(({ id, nom }) => ({
      nom,
      nombre: lignes.filter((ligne) => charges.has(cleChargee(ligne.produit, ligne.composant, id)) && !ligne.presente[id]).length,
    }))
    .filter(({ nombre }) => nombre > 0);
}

/** Titre d’un groupe de la vue d’ensemble : « Atom › web ». */
export const titreGroupe = (ligne: Pick<Ligne, "produit" | "composant">) => `${libelleProduit(ligne.produit)} › ${ligne.composant}`;

// ------------------------------------------------------------------------------------------------ Copies
const message = (erreur: unknown, defaut: string) => (erreur instanceof Error && erreur.message ? erreur.message : defaut);

/** Copie un document vers chaque destination, sans écraser ; rend le nombre copié et les échecs. */
export async function copierDocument(source: Coffre, destinations: readonly Coffre[], chemin: string) {
  let copies = 0;
  const echecs: string[] = [];
  for (const destination of destinations) {
    try {
      await functions.call("openbao/copier-secret", { source: source.instance, destination: destination.instance, chemin });
      copies += 1;
    } catch (erreur) {
      echecs.push(`${destination.nom} : ${message(erreur, "copie impossible")}`);
    }
  }
  return { copies, echecs };
}

/** Copie tous les documents d’un composant vers chaque destination ; ceux déjà présents à destination sont ignorés. */
export async function copierArborescence(source: Coffre, destinations: readonly Coffre[], produit: string, composant: string) {
  const chemin = cheminComposant(produit, composant);
  const documents = [...new Set((await listerReferences(source, chemin, "component")).map(({ emplacement }) => emplacement))];
  let copies = 0;
  let ignores = 0;
  const echecs: string[] = [];
  for (const destination of destinations) {
    try {
      const existants = new Set((await listerReferences(destination, chemin, "component")).map(({ emplacement }) => emplacement));
      for (const document of documents) {
        if (existants.has(document)) {
          ignores += 1;
          continue;
        }
        try {
          await functions.call("openbao/copier-secret", { source: source.instance, destination: destination.instance, chemin: document });
          copies += 1;
        } catch (erreur) {
          echecs.push(`${destination.nom} › ${document} : ${message(erreur, "copie impossible")}`);
        }
      }
    } catch (erreur) {
      echecs.push(`${destination.nom} : ${message(erreur, "lecture impossible")}`);
    }
  }
  return { documents: documents.length, copies, ignores, echecs };
}

// ------------------------------------------------------------------------------------------------ Inventaire
/** Fichier .env d’un composant dans un environnement : les variables de l’inventaire, écrites par Alfred. */
export async function telechargerEnv(env: EnvOpenBao, composant: string, references: readonly Reference[]) {
  if (await enDemo()) throw new Error(DEMO_LECTURE_SEULE);
  const emplacements = [...new Set(references.map(({ emplacement }) => emplacement))];
  const documents = new Map(await Promise.all(emplacements.map(async (emplacement) => [emplacement, await lireSecret(env, emplacement)] as const)));
  const entrees = new Map<string, string>();
  for (const reference of references) {
    const nom = nomVariable(reference.emplacement, reference.cle);
    if (entrees.has(nom)) continue;
    const ref = documents.get(reference.emplacement)?.valeurs[reference.cle];
    if (!ref) throw new Error(`La valeur « ${reference.cle} » est introuvable dans OpenBao.`);
    entrees.set(nom, ref);
  }
  return secrets.writeEnvFile({ name: nomFichierEnv(composant), entries: [...entrees].map(([name, ref]) => ({ name, ref })) });
}

/** « web.env » pour le composant « web », comme OneApp. */
export const nomFichierEnv = (composant: string) =>
  `${
    composant
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "composant"
  }.env`;
