// Accès, comme la page Accès de OneApp (ADR 0006 et 0007) : les profils (groupes Keycloak et équipes Grafana) sont
// rangés dans la base du module ; les personnes et leur profil sont lus chez Keycloak — membres des groupes gérés et
// comptes portant l’attribut « oneapp-profils » —, comparés à l’état réel de Keycloak et de Grafana, puis réalignés
// après aperçu. Les services ne sont joints que par les connecteurs keycloak et grafana (lib/source.ts).
import { shell } from "@alfred/sdk";
import type { OpenFormOptions } from "socle-ui";
import { type Environnement, lireEnvironnements } from "./environnements";
import { db, functions } from "./source";

// ------------------------------------------------------------------------------------------------ Profils (base)
export type Profil = { id: string; nom: string; description: string; groupes: string[]; equipes: string[] };

const liste = (texte: string) =>
  texte
    .split(/\n|,/)
    .map((valeur) => valeur.trim())
    .filter(Boolean);
const json = (texte: string): string[] => {
  try {
    const valeur = JSON.parse(texte);
    return Array.isArray(valeur) ? valeur.map(String) : [];
  } catch {
    return [];
  }
};
const cheminGroupe = (chemin: string) => `/${chemin.split("/").map((partie) => partie.trim()).filter(Boolean).join("/")}`;

export async function lireProfils(): Promise<Profil[]> {
  const lignes = await db.query<{ id: string; nom: string; description: string; groupes: string; equipes: string }>(
    "SELECT id, nom, description, groupes, equipes FROM atom_profils ORDER BY nom",
  );
  return lignes.map((ligne) => ({ ...ligne, groupes: json(ligne.groupes), equipes: json(ligne.equipes) }));
}

export function formulaireProfil(profil?: Profil): OpenFormOptions {
  return {
    title: profil ? `Modifier le profil ${profil.nom}` : "Nouveau profil d’accès",
    description: "Ce qu’une personne de ce profil doit avoir dans chaque environnement.",
    fields: [
      { name: "nom", label: "Nom", placeholder: "Développeur ATOM", isRequired: true },
      { name: "description", label: "Description" },
      { name: "groupes", label: "Groupes Keycloak", type: "textarea", description: "Un chemin complet par ligne : /ATOM/Développeurs" },
      { name: "equipes", label: "Équipes Grafana", type: "textarea", description: "Un nom d’équipe par ligne : ATOM" },
    ],
    initialValues: profil ? { ...profil, groupes: profil.groupes.join("\n"), equipes: profil.equipes.join("\n") } : undefined,
    submitLabel: profil ? "Enregistrer" : "Créer",
    onSubmit: async (valeurs) => {
      const texte = (nom: string) => String(valeurs[nom] ?? "");
      const champs = [
        texte("nom").trim(),
        texte("description").trim(),
        JSON.stringify(liste(texte("groupes")).map(cheminGroupe)),
        JSON.stringify(liste(texte("equipes"))),
      ];
      await (profil
        ? db.execute(
            "UPDATE atom_profils SET nom = ?, description = ?, groupes = ?, equipes = ?, modifie_le = datetime('now') WHERE id = ?",
            [...champs, profil.id],
          )
        : db.execute("INSERT INTO atom_profils (id, nom, description, groupes, equipes) VALUES (?, ?, ?, ?, ?)", [
            crypto.randomUUID(),
            ...champs,
          ]));
      void shell.notify({ title: profil ? "Profil modifié" : "Profil créé", tone: "success" });
    },
  };
}

/** Attribut multivalué du compte Keycloak listant les noms de ses profils (ADR 0007 de OneApp, même nom). */
export const ATTRIBUT_PROFILS = "oneapp-profils";
const replie = (valeur: string) => valeur.trim().toLocaleLowerCase("fr");
const unique = (valeurs: readonly string[]) => [...new Set(valeurs)];
const joindre = (valeurs: readonly string[]) => unique(valeurs).sort((a, b) => a.localeCompare(b, "fr")).join(", ");
const groupesGeres = (profils: readonly Profil[]) => unique(profils.flatMap(({ groupes }) => groupes));
const equipesGerees = (profils: readonly Profil[]) => unique(profils.flatMap(({ equipes }) => equipes));

/** Une valeur de l’attribut désigne ce profil : son nom, ou son identifiant interne. */
const designe = (profil: Pick<Profil, "id" | "nom">, valeur: string) => valeur.trim() === profil.id || replie(valeur) === replie(profil.nom);

// ------------------------------------------------------------------------------------------------ État lu
export type CompteKc = {
  id: string;
  identifiant: string;
  prenom: string;
  nom: string;
  email: string;
  actif: boolean;
  attributs?: Record<string, string[]>;
};
type GroupeLu = { id: string; attributs?: Record<string, string[]>; membres: CompteKc[] };
type EquipeLue = { id: number; membres: ReadonlySet<number>; dossier?: "accorde" | "refuse" | "absent" };

/** État réel d’un environnement, limité aux groupes Keycloak et aux équipes Grafana gérés par les profils. */
export type Instantane = {
  /** Groupe par chemin ; `undefined` lorsqu’il n’existe pas dans l’environnement. */
  groupes: ReadonlyMap<string, GroupeLu | undefined>;
  /** Équipe par nom ; `undefined` lorsqu’elle n’existe pas. */
  equipes: ReadonlyMap<string, EquipeLue | undefined>;
  /** Compte Grafana par identifiant Keycloak ; `undefined` tant que la personne ne s’est jamais connectée. */
  comptesGrafana: ReadonlyMap<string, number | undefined>;
  /** Comptes portant l’attribut des profils, même hors de tout groupe géré. */
  porteurs: readonly CompteKc[];
};

/** Contrat partagé avec atom.jenkins : ce groupe gère des destinataires d’alertes, pas des profils d’accès. */
export const groupeAlerte = (groupe: Pick<GroupeLu, "attributs"> | undefined) => groupe?.attributs?.["atom.group-purpose"]?.includes("alert") ?? false;

export function libellePersonne(compte: Pick<CompteKc, "prenom" | "nom" | "email" | "identifiant">) {
  const nom = [compte.prenom, compte.nom].filter(Boolean).join(" ").trim();
  return nom || compte.email || compte.identifiant;
}

/** Environnement relié : Keycloak et Grafana y sont tous deux rattachés. */
export const relie = (env: Environnement) => Boolean(env.instances.keycloak && env.instances.grafana);

export async function lireEnvironnementsAcces() {
  return lireEnvironnements();
}

type CompteGrafana = { id: number; login: string; email: string };
const memeTitre = (a: string, b: string) => a.trim().localeCompare(b.trim(), undefined, { sensitivity: "accent" }) === 0;

/** Comptes Grafana de personnes Keycloak, retrouvés par e-mail puis par identifiant de connexion. */
async function comptesGrafana(gf: string, comptes: readonly CompteKc[], deja?: CompteGrafana[]) {
  if (!comptes.length) return new Map<string, number | undefined>();
  const tous = deja ?? (await functions.call<{ utilisateurs: CompteGrafana[] }>("grafana/lister-utilisateurs", { instance: gf })).utilisateurs;
  return new Map(
    comptes.map((compte) => {
      const trouve =
        (compte.email && tous.find((u) => u.email && replie(u.email) === replie(compte.email))) ||
        tous.find((u) => replie(u.login) === replie(compte.identifiant));
      return [compte.id, trouve ? trouve.id : undefined] as const;
    }),
  );
}

/**
 * Lit l’état réel d’un environnement pour les groupes et équipes gérés : membres des groupes Keycloak, porteurs de
 * l’attribut, membres des équipes Grafana, droit de chaque équipe sur le dossier de même nom, compte Grafana de chacun.
 */
export async function lireInstantane(profils: readonly Profil[], env: Environnement): Promise<Instantane> {
  const kc = env.instances.keycloak as string;
  const gf = env.instances.grafana as string;
  const chemins = groupesGeres(profils);
  const noms = equipesGerees(profils);
  const lireKeycloak = async () => {
    const lus = chemins.length
      ? (
          await functions.call<{ groupes: { chemin: string; groupe: { id: string; attributs?: Record<string, string[]> } | null; membres: CompteKc[] }[] }>(
            "keycloak/lire-groupes-par-chemins",
            { instance: kc, chemins },
          )
        ).groupes
      : [];
    return new Map<string, GroupeLu | undefined>(
      chemins.map((chemin) => {
        const lu = lus.find((item) => item.chemin === chemin);
        if (!lu?.groupe) return [chemin, undefined];
        const groupe = { id: lu.groupe.id, attributs: lu.groupe.attributs, membres: [] as CompteKc[] };
        return [chemin, { ...groupe, membres: groupeAlerte(groupe) ? [] : lu.membres }];
      }),
    );
  };
  const lireGrafana = async () => {
    const equipes = new Map<string, EquipeLue | undefined>(noms.map((nom) => [nom, undefined]));
    if (!noms.length) return equipes;
    const toutes = (await functions.call<{ equipes: { id: number; nom: string }[] }>("grafana/lister-equipes", { instance: gf })).equipes;
    const existantes = noms.flatMap((nom) => {
      const equipe = toutes.find((item) => item.nom === nom);
      return equipe ? [{ nom, id: equipe.id }] : [];
    });
    const dossiers = existantes.length ? (await functions.call<{ dossiers: { uid: string; titre: string }[] }>("grafana/lister-dossiers", { instance: gf })).dossiers : [];
    await Promise.all(
      existantes.map(async ({ nom, id }) => {
        const droitSurDossier = async (): Promise<EquipeLue["dossier"]> => {
          const candidats = dossiers.filter(({ titre }) => memeTitre(titre, nom));
          if (!candidats.length) return "absent";
          for (const dossier of candidats) {
            const { droits } = await functions.call<{ droits: { equipe: { id: number } | null; droit: number }[] }>("grafana/lister-droits-dossier", {
              instance: gf,
              dossier: dossier.uid,
            });
            if (droits.some((d) => d.equipe?.id === id && d.droit > 0)) return "accorde";
          }
          return "refuse";
        };
        const [membres, dossier] = await Promise.all([
          functions.call<{ membres: { id: number }[] }>("grafana/lister-membres-equipe", { instance: gf, equipe: id }).then((r) => r.membres.map((m) => m.id)),
          droitSurDossier(),
        ]);
        equipes.set(nom, { id, membres: new Set(membres), dossier });
      }),
    );
    return equipes;
  };
  // Une recherche par attribut refusée (ancien Keycloak) ne bloque pas la lecture des groupes.
  const lirePorteurs = async () => {
    const trouves = await Promise.all(
      unique(profils.map(({ nom }) => nom.trim()).filter(Boolean)).map((valeur) =>
        functions
          .call<{ utilisateurs: CompteKc[] }>("keycloak/chercher-par-attribut", { instance: kc, attribut: ATTRIBUT_PROFILS, valeur })
          .then((r) => r.utilisateurs)
          .catch(() => [] as CompteKc[]),
      ),
    );
    return [...new Map(trouves.flat().map((compte) => [compte.id, compte])).values()];
  };
  const [groupes, equipes, porteurs] = await Promise.all([lireKeycloak(), lireGrafana(), lirePorteurs()]);
  const personnes = new Map<string, CompteKc>();
  for (const groupe of groupes.values()) for (const compte of groupe?.membres ?? []) personnes.set(compte.id, compte);
  for (const compte of porteurs) if (!personnes.has(compte.id)) personnes.set(compte.id, compte);
  return { groupes, equipes, porteurs, comptesGrafana: await comptesGrafana(gf, [...personnes.values()]) };
}

// ------------------------------------------------------------------------------------------------ Écarts
export type Changement =
  | { systeme: "keycloak"; type: "creerCompte"; email?: string; identifiant?: string }
  | { systeme: "keycloak"; type: "ajouter" | "retirer"; groupe: string }
  | { systeme: "keycloak"; type: "profils"; ids: string[]; noms: string[] }
  | { systeme: "grafana"; type: "ajouter" | "retirer" | "premiereConnexion"; equipe: string };

export type EtatPersonne = {
  compte: CompteKc;
  /** Profils détenus au complet : enregistrés sur le compte et pourvus de tous leurs groupes. */
  profils: Profil[];
  /** Profils détenus auxquels manquent des groupes Keycloak. */
  incomplets: { profil: Profil; manquants: string[] }[];
  /** Vrai lorsque le compte porte l’attribut des profils ; faux pour une personne sans profil. */
  declare: boolean;
  groupesEnTrop: string[];
  grafana: Changement[];
};

export type Probleme =
  | { type: "groupeAbsent"; groupe: string }
  | { type: "groupeAlerte"; groupe: string }
  | { type: "equipeAbsente"; equipe: string }
  | { type: "dossierAbsent"; equipe: string }
  | { type: "dossierSansDroit"; equipe: string };

export function texteProbleme(probleme: Probleme) {
  switch (probleme.type) {
    case "groupeAbsent":
      return `Groupe Keycloak ${probleme.groupe} introuvable`;
    case "groupeAlerte":
      return `Groupe Keycloak ${probleme.groupe} réservé aux alertes`;
    case "equipeAbsente":
      return `Équipe Grafana ${probleme.equipe} introuvable`;
    case "dossierAbsent":
      return `Aucun dossier Grafana ne porte le nom de l’équipe ${probleme.equipe}`;
    case "dossierSansDroit":
      return `Équipe Grafana ${probleme.equipe} sans droit sur son dossier`;
  }
}

/** Groupes et équipes absents de l’environnement, équipes sans droit sur leur dossier : signalés, jamais corrigés. */
export function problemes(profils: readonly Profil[], inst: Instantane): Probleme[] {
  const equipes = equipesGerees(profils).map((equipe) => ({ equipe, etat: inst.equipes.get(equipe) }));
  return [
    ...groupesGeres(profils).filter((g) => !inst.groupes.get(g)).map((groupe) => ({ type: "groupeAbsent" as const, groupe })),
    ...groupesGeres(profils).filter((g) => groupeAlerte(inst.groupes.get(g))).map((groupe) => ({ type: "groupeAlerte" as const, groupe })),
    ...equipes.filter(({ etat }) => !etat).map(({ equipe }) => ({ type: "equipeAbsente" as const, equipe })),
    ...equipes.filter(({ etat }) => etat?.dossier === "absent").map(({ equipe }) => ({ type: "dossierAbsent" as const, equipe })),
    ...equipes.filter(({ etat }) => etat?.dossier === "refuse").map(({ equipe }) => ({ type: "dossierSansDroit" as const, equipe })),
  ];
}

/** Valeurs de l’attribut des profils ; `undefined` tant qu’il n’a jamais été écrit. */
function valeursDeclarees(compte: CompteKc) {
  const valeurs = compte.attributs?.[ATTRIBUT_PROFILS];
  return valeurs ? unique(valeurs.map((v) => v.trim()).filter(Boolean)) : undefined;
}

/** Profils enregistrés sur le compte, ou `undefined` sans attribut (un nom périmé vaut « sans profil »). */
function profilsDeclares(profils: readonly Profil[], compte: CompteKc) {
  const valeurs = valeursDeclarees(compte);
  if (!valeurs) return undefined;
  const trouves = profils.filter((profil) => valeurs.some((valeur) => designe(profil, valeur)));
  return valeurs.length && !trouves.length ? undefined : trouves;
}

function groupesDe(id: string, profils: readonly Profil[], inst: Instantane) {
  return new Set(
    groupesGeres(profils).filter((g) => !groupeAlerte(inst.groupes.get(g)) && inst.groupes.get(g)?.membres.some((m) => m.id === id)),
  );
}

function changementsGrafana(compte: CompteKc, attendues: ReadonlySet<string>, profils: readonly Profil[], inst: Instantane): Changement[] {
  const grafana = inst.comptesGrafana.get(compte.id);
  const changements: Changement[] = [];
  // Équipes gérées, plus toute autre équipe lue pour la personne : hors de ses profils, elle en est retirée.
  for (const equipe of new Set([...equipesGerees(profils), ...inst.equipes.keys()])) {
    const etat = inst.equipes.get(equipe);
    if (!etat) continue;
    const membre = grafana !== undefined && etat.membres.has(grafana);
    if (attendues.has(equipe) && !membre)
      changements.push({ systeme: "grafana", type: grafana !== undefined ? "ajouter" : "premiereConnexion", equipe });
    if (!attendues.has(equipe) && membre) changements.push({ systeme: "grafana", type: "retirer", equipe });
  }
  return changements;
}

export const aUnEcart = (p: EtatPersonne) =>
  p.grafana.some(({ type }) => type === "ajouter" || type === "retirer") || p.incomplets.length > 0 || p.groupesEnTrop.length > 0;

const profilsARetablir = (p: EtatPersonne) => [...p.profils, ...p.incomplets.map(({ profil }) => profil)];

/** Personnes présentes dans au moins un groupe géré ou portant un profil enregistré, avec leurs écarts. */
export function personnesAcces(profils: readonly Profil[], inst: Instantane): EtatPersonne[] {
  const comptes = new Map<string, CompteKc>();
  for (const g of groupesGeres(profils).filter((chemin) => !groupeAlerte(inst.groupes.get(chemin))))
    for (const compte of inst.groupes.get(g)?.membres ?? []) comptes.set(compte.id, compte);
  for (const compte of inst.porteurs) if (!comptes.has(compte.id) && profilsDeclares(profils, compte)?.length) comptes.set(compte.id, compte);
  return [...comptes.values()]
    .map((compte): EtatPersonne => {
      const groupes = groupesDe(compte.id, profils, inst);
      const declares = profilsDeclares(profils, compte);
      if (!declares) return { compte, profils: [], incomplets: [], declare: false, groupesEnTrop: [], grafana: [] };
      // Un groupe absent de l’environnement est déjà signalé comme problème de configuration.
      const manquants = (profil: Profil) =>
        profil.groupes.filter((g) => inst.groupes.get(g) && !groupeAlerte(inst.groupes.get(g)) && !groupes.has(g));
      const voulus = new Set(declares.flatMap(({ groupes: g }) => g));
      return {
        compte,
        profils: declares.filter((profil) => !manquants(profil).length),
        incomplets: declares.filter((profil) => manquants(profil).length).map((profil) => ({ profil, manquants: manquants(profil) })),
        declare: true,
        groupesEnTrop: [...groupes].filter((g) => !voulus.has(g)),
        grafana: changementsGrafana(compte, new Set(declares.flatMap(({ equipes }) => equipes)), profils, inst),
      };
    })
    .sort((a, b) => libellePersonne(a.compte).localeCompare(libellePersonne(b.compte), "fr"));
}

/** État complété des autres appartenances d’une personne, gérées ou non, pour qu’un réalignement l’en retire. */
function avecAppartenances(
  inst: Instantane,
  compte: CompteKc,
  autres: { groupes?: { id: string; chemin: string; attributs?: Record<string, string[]> }[]; equipes?: { id: number; nom: string }[] },
): Instantane {
  const groupes = new Map(inst.groupes);
  for (const { id, chemin, attributs } of autres.groupes ?? []) {
    const actuel = groupes.get(chemin);
    if (groupeAlerte({ attributs }) || groupeAlerte(actuel)) {
      groupes.set(chemin, { id, attributs: groupeAlerte({ attributs }) ? attributs : actuel?.attributs, membres: [] });
      continue;
    }
    if (actuel?.membres.some((m) => m.id === compte.id)) continue;
    groupes.set(chemin, { id: actuel?.id ?? id, attributs, membres: [...(actuel?.membres ?? []), compte] });
  }
  const grafana = inst.comptesGrafana.get(compte.id);
  const equipes = new Map(inst.equipes);
  if (grafana !== undefined)
    for (const { id, nom } of autres.equipes ?? []) {
      const actuelle = equipes.get(nom);
      if (actuelle?.membres.has(grafana)) continue;
      equipes.set(nom, { ...actuelle, id: actuelle?.id ?? id, membres: new Set([...(actuelle?.membres ?? []), grafana]) });
    }
  return { ...inst, groupes, equipes };
}

/**
 * Changements pour donner exactement `cibles` à une personne (ou à une adresse jamais vue) : ajoutée aux groupes et
 * équipes de ses profils, retirée de tous les autres que l’état lu lui connaît. Un groupe ou une équipe absent de
 * l’environnement n’est ni ajouté ni retiré.
 */
export function planifier(
  profils: readonly Profil[],
  inst: Instantane,
  cible: { compte?: CompteKc; email?: string; nouveau?: { identifiant: string; email?: string } },
  cibles: readonly Profil[],
): Changement[] {
  const alerte = cibles.flatMap(({ groupes }) => groupes).find((g) => groupeAlerte(inst.groupes.get(g)));
  if (alerte) throw new Error(`Le groupe ${alerte} est réservé aux alertes. Retirez-le de la définition du profil avant de l’appliquer.`);
  const id = cible.compte?.id;
  const actuels = new Set(
    id ? [...inst.groupes].flatMap(([chemin, g]) => (!groupeAlerte(g) && g?.membres.some((m) => m.id === id) ? [chemin] : [])) : [],
  );
  const voulus = new Set(cibles.flatMap(({ groupes }) => groupes));
  const changements: Changement[] = [];
  if (!cible.compte && cible.nouveau) changements.push({ systeme: "keycloak", type: "creerCompte", ...cible.nouveau });
  else if (!cible.compte && cible.email) changements.push({ systeme: "keycloak", type: "creerCompte", email: cible.email });
  for (const groupe of new Set([...profils.flatMap(({ groupes }) => groupes), ...actuels])) {
    if (!inst.groupes.get(groupe) || groupeAlerte(inst.groupes.get(groupe))) continue;
    if (voulus.has(groupe) && !actuels.has(groupe)) changements.push({ systeme: "keycloak", type: "ajouter", groupe });
    if (!voulus.has(groupe) && actuels.has(groupe)) changements.push({ systeme: "keycloak", type: "retirer", groupe });
  }
  // L’attribut porte les noms des profils ; un ancien identifiant ou un nom périmé est réécrit.
  const unicite = [...new Map(cibles.map((p) => [p.id, p])).values()].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  const noms = unicite.map(({ nom }) => nom.trim());
  const valeurs = cible.compte ? valeursDeclarees(cible.compte)?.slice().sort() : undefined;
  if (!valeurs || valeurs.join("\u0000") !== noms.slice().sort().join("\u0000"))
    changements.push({ systeme: "keycloak", type: "profils", ids: unicite.map(({ id: pid }) => pid), noms });
  const attendues = new Set(cibles.flatMap(({ equipes }) => equipes));
  if (cible.compte) changements.push(...changementsGrafana(cible.compte, attendues, profils, inst));
  else for (const equipe of attendues) if (inst.equipes.get(equipe)) changements.push({ systeme: "grafana", type: "premiereConnexion", equipe });
  return changements;
}

export function libelleChangement(c: Changement) {
  if (c.systeme === "keycloak") {
    if (c.type === "creerCompte") return `Créer le compte ${c.identifiant ?? c.email}`;
    if (c.type === "profils")
      return c.noms.length ? `Enregistrer le profil ${c.noms.join(", ")} sur le compte` : "Retirer le profil enregistré sur le compte";
    return c.type === "ajouter" ? `Ajouter au groupe ${c.groupe}` : `Retirer du groupe ${c.groupe}`;
  }
  if (c.type === "premiereConnexion") return `Équipe ${c.equipe} : ajoutée à sa première connexion`;
  return c.type === "ajouter" ? `Ajouter à l’équipe ${c.equipe}` : `Retirer de l’équipe ${c.equipe}`;
}

/** Nombre de changements réellement exécutés par l’application d’un plan. */
export const executables = (changements: readonly Changement[]) => changements.filter((c) => c.type !== "premiereConnexion").length;

// ------------------------------------------------------------------------------------------------ Audit et vue d’ensemble
export type LigneAudit = {
  environnement: string;
  personne: string;
  identifiant: string;
  email: string;
  actif: string;
  compteGrafana: string;
  profils: string;
  origine: string;
  groupes: string;
  groupesManquants: string;
  groupesEnTrop: string;
  equipes: string;
  equipesManquantes: string;
  equipesEnTrop: string;
  equipesPremiereConnexion: string;
  etat: string;
};

const COLONNES_AUDIT: { cle: keyof LigneAudit; libelle: string }[] = [
  { cle: "environnement", libelle: "Environnement" },
  { cle: "personne", libelle: "Personne" },
  { cle: "identifiant", libelle: "Identifiant" },
  { cle: "email", libelle: "E-mail" },
  { cle: "actif", libelle: "Compte actif" },
  { cle: "compteGrafana", libelle: "Compte Grafana" },
  { cle: "profils", libelle: "Profils" },
  { cle: "origine", libelle: "Origine des profils" },
  { cle: "groupes", libelle: "Groupes Keycloak" },
  { cle: "groupesManquants", libelle: "Groupes manquants" },
  { cle: "groupesEnTrop", libelle: "Groupes en trop" },
  { cle: "equipes", libelle: "Équipes Grafana" },
  { cle: "equipesManquantes", libelle: "Équipes manquantes" },
  { cle: "equipesEnTrop", libelle: "Équipes en trop" },
  { cle: "equipesPremiereConnexion", libelle: "Équipes à la 1re connexion" },
  { cle: "etat", libelle: "État" },
];

/** Lignes d’audit d’un environnement ; `tousGroupes` donne, quand il a été lu, chaque groupe de chaque personne. */
export function lignesAudit(profils: readonly Profil[], env: Pick<Environnement, "nom">, inst: Instantane, tousGroupes = new Map<string, string[]>()): LigneAudit[] {
  return personnesAcces(profils, inst).map((p) => {
    const { compte } = p;
    const grafana = inst.comptesGrafana.get(compte.id);
    const geres = [...inst.groupes].flatMap(([chemin, g]) => (!groupeAlerte(g) && g?.membres.some((m) => m.id === compte.id) ? [chemin] : []));
    const equipes = equipesGerees(profils).filter((e) => grafana !== undefined && inst.equipes.get(e)?.membres.has(grafana));
    const equipesDe = (type: string) => p.grafana.flatMap((c) => (c.systeme === "grafana" && c.type === type ? [c.equipe] : []));
    const manquants = p.incomplets.flatMap(({ manquants: m }) => m);
    const ecart = manquants.length > 0 || p.groupesEnTrop.length > 0 || equipesDe("ajouter").length > 0 || equipesDe("retirer").length > 0;
    return {
      environnement: env.nom,
      personne: libellePersonne(compte),
      identifiant: compte.identifiant,
      email: compte.email ?? "",
      actif: compte.actif === false ? "Non" : "Oui",
      compteGrafana: grafana !== undefined ? "Oui" : "Jamais connecté(e)",
      profils: joindre([...p.profils, ...p.incomplets.map(({ profil }) => profil)].map(({ nom }) => nom)),
      origine: p.declare ? "Attribut Keycloak" : "Aucun profil attribué",
      groupes: joindre((tousGroupes.get(compte.id) ?? geres).filter((chemin) => !groupeAlerte(inst.groupes.get(chemin)))),
      groupesManquants: joindre(manquants),
      groupesEnTrop: joindre(p.groupesEnTrop),
      equipes: joindre(equipes),
      equipesManquantes: joindre(equipesDe("ajouter")),
      equipesEnTrop: joindre(equipesDe("retirer")),
      equipesPremiereConnexion: joindre(equipesDe("premiereConnexion")),
      etat: !p.declare ? "Sans profil" : ecart ? "Écart" : "Conforme",
    };
  });
}

/** État d’une personne dans un environnement de la vue d’ensemble. */
export type CaseAcces = {
  /** « sans-profil » : aucun profil enregistré sur le compte, la personne garde ses droits sans écart calculé. */
  etat: "conforme" | "ecart" | "sans-profil";
  profils: string;
  /** Ce qui manque ou dépasse, en une ligne. */
  ecarts: string;
  detail: LigneAudit;
};
export type LigneVue = {
  cle: string;
  personne: string;
  identifiant: string;
  email: string;
  /** Par nom d’environnement ; absente quand la personne n’a pas d’accès géré dans cet environnement. */
  cases: Record<string, CaseAcces>;
};

/** Une ligne par personne (reconnue par son identifiant d’un environnement à l’autre), une case par environnement. */
export function vueEnsemble(lignes: readonly LigneAudit[]): LigneVue[] {
  const personnes = new Map<string, LigneVue>();
  for (const ligne of lignes) {
    const cle = (ligne.identifiant || ligne.email).toLocaleLowerCase("fr");
    const personne = personnes.get(cle) ?? { cle, personne: ligne.personne, identifiant: ligne.identifiant, email: ligne.email, cases: {} };
    const ecarts = [
      ligne.groupesManquants && `groupes manquants : ${ligne.groupesManquants}`,
      ligne.groupesEnTrop && `groupes en trop : ${ligne.groupesEnTrop}`,
      ligne.equipesManquantes && `équipes manquantes : ${ligne.equipesManquantes}`,
      ligne.equipesEnTrop && `équipes en trop : ${ligne.equipesEnTrop}`,
    ]
      .filter(Boolean)
      .join(" · ");
    personne.cases[ligne.environnement] = {
      etat: ligne.etat === "Conforme" ? "conforme" : ligne.etat === "Sans profil" ? "sans-profil" : "ecart",
      profils: ligne.profils,
      ecarts,
      detail: ligne,
    };
    personnes.set(cle, personne);
  }
  return [...personnes.values()].sort((a, b) => a.personne.localeCompare(b.personne, "fr"));
}

/** Lignes du CSV d’audit, dans l’ordre des 16 colonnes. */
export function tableauAudit(lignes: readonly LigneAudit[]) {
  return { colonnes: COLONNES_AUDIT.map(({ libelle }) => libelle), lignes: lignes.map((l) => COLONNES_AUDIT.map(({ cle }) => l[cle])) };
}

/** Cellule CSV : neutralise une formule (=, +, -, @), entre guillemets quand il le faut. */
function cellule(valeur: string) {
  const sure = /^[=+\-@]/.test(valeur) ? `'${valeur}` : valeur;
  return /[;"\r\n]/.test(sure) ? `"${sure.replaceAll('"', '""')}"` : sure;
}

/** CSV séparé par des points-virgules avec BOM UTF-8, ouvert tel quel par Excel en français. */
export function csvAudit(lignes: readonly LigneAudit[]) {
  const { colonnes, lignes: valeurs } = tableauAudit(lignes);
  return `﻿${[colonnes, ...valeurs].map((ligne) => ligne.map(cellule).join(";")).join("\r\n")}\r\n`;
}

export const nomFichierAudit = (date: string) => `audit-acces-${date}.csv`;

// ------------------------------------------------------------------------------------------------ Préparation et application
/** Changements prévus pour une personne dans un environnement, avec l’état lu pour les calculer. */
export type Plan = {
  env: Environnement;
  inst: Instantane;
  compte?: CompteKc;
  email?: string;
  grafana?: number;
  changements: Changement[];
};

type GroupeDetaille = { id: string; chemin: string; attributs?: Record<string, string[]> };

function instances(env: Environnement) {
  const kc = env.instances.keycloak;
  const gf = env.instances.grafana;
  if (!kc || !gf) throw new Error(`Rattachez un compte Keycloak et un compte Grafana à ${env.nom} dans Réglages, Atom.`);
  return { kc, gf };
}

/** Ajoute à l’état lu les autres groupes Keycloak et équipes Grafana de la personne. */
async function avecToutesAppartenances(env: Environnement, inst: Instantane, compte: CompteKc) {
  const { kc, gf } = instances(env);
  const grafana = inst.comptesGrafana.get(compte.id);
  const [groupes, equipes] = await Promise.all([
    functions.call<{ groupes?: GroupeDetaille[] }>("keycloak/lire-utilisateur", { instance: kc, utilisateur: compte.id, groupes: true }).then((r) => r.groupes ?? []),
    grafana === undefined
      ? Promise.resolve([] as { id: number; nom: string }[])
      : functions.call<{ equipes: { id: number; nom: string }[] }>("grafana/lister-equipes-utilisateur", { instance: gf, utilisateur: grafana }).then((r) => r.equipes),
  ]);
  return avecAppartenances(inst, compte, { groupes, equipes });
}

const lireCompte = async (kc: string, cherche: { email?: string; identifiant?: string }) =>
  (await functions.call<{ utilisateur: CompteKc | null }>("keycloak/lire-utilisateur", { instance: kc, ...cherche })).utilisateur ?? undefined;

export type Demande = {
  /** Personne déjà connue ; dans chaque environnement, elle est retrouvée par son e-mail puis son identifiant. */
  compte?: CompteKc;
  email: string;
  /** Compte à créer par son seul identifiant, quand la recherche Keycloak ne l’a pas trouvé. */
  identifiant?: string;
  profils: readonly Profil[];
};

/** Plan d’une personne dans un environnement déjà lu ; rend aussi l’état complété, pour les personnes suivantes. */
async function planDans(profils: readonly Profil[], env: Environnement, initial: Instantane, demande: Demande, verifierCompte: boolean) {
  const { kc, gf } = instances(env);
  let inst = initial;
  const identifiant = replie(demande.identifiant ?? demande.compte?.identifiant ?? "");
  // Un compte choisi peut avoir été supprimé et recréé par le SSO depuis la lecture : il est retrouvé chez Keycloak.
  const compte =
    (demande.email.trim() ? await lireCompte(kc, { email: demande.email.trim() }) : undefined) ??
    (identifiant ? await lireCompte(kc, { identifiant }) : undefined);
  if (!compte && demande.compte && verifierCompte)
    throw new Error("Le compte Keycloak sélectionné n’existe plus. Actualisez les accès et recherchez la personne après sa connexion SSO.");
  if (compte && !inst.comptesGrafana.has(compte.id))
    inst = { ...inst, comptesGrafana: new Map([...inst.comptesGrafana, ...(await comptesGrafana(gf, [compte]))]) };
  // Toutes ses appartenances, gérées ou non : le profil appliqué la retire de celles qu’il ne demande pas.
  if (compte) inst = await avecToutesAppartenances(env, inst, compte);
  const email = demande.email.trim().toLocaleLowerCase();
  const nouveau = identifiant ? { identifiant, ...(email ? { email } : {}) } : undefined;
  return {
    inst,
    plan: {
      env,
      inst,
      compte,
      email: compte ? undefined : email || identifiant,
      grafana: compte ? inst.comptesGrafana.get(compte.id) : undefined,
      // Retirer l’accès d’une personne absente de l’environnement ne crée pas de compte pour rien.
      changements: !compte && !demande.profils.length ? [] : planifier(profils, inst, compte ? { compte } : { email, nouveau }, demande.profils),
    } satisfies Plan,
  };
}

/** Un plan par environnement, chacun relu ; les lectures partent ensemble, l’ordre est gardé. */
export async function preparerPlans(profils: readonly Profil[], demande: Demande, envs: readonly Environnement[], courant?: string) {
  return Promise.all(
    envs.map(async (env) => (await planDans(profils, env, await lireInstantane(profils, env), demande, env.id === courant)).plan),
  );
}

/** Même profil pour plusieurs personnes : chaque environnement lu une fois, puis un plan par personne. */
export async function preparerPlansGroupes(
  profils: readonly Profil[],
  personnes: readonly Pick<Demande, "email" | "identifiant">[],
  cibles: readonly Profil[],
  envs: readonly Environnement[],
) {
  const parEnv = await Promise.all(
    envs.map(async (env) => {
      let inst = await lireInstantane(profils, env);
      const plans: Plan[] = [];
      for (const personne of personnes) {
        const fait = await planDans(profils, env, inst, { ...personne, profils: cibles }, false);
        inst = fait.inst;
        plans.push(fait.plan);
      }
      return plans;
    }),
  );
  return parEnv.flat();
}

/** Réalignement groupé : dans chaque environnement relu, un plan par personne en écart retenue par `garder`. */
export async function preparerRealignement(profils: readonly Profil[], envs: readonly Environnement[], garder: (compte: CompteKc) => boolean) {
  const parEnv = await Promise.all(
    envs.map(async (env) => {
      const inst = await lireInstantane(profils, env);
      const plans: Plan[] = [];
      for (const personne of personnesAcces(profils, inst).filter((p) => aUnEcart(p) && garder(p.compte))) {
        const complet = await avecToutesAppartenances(env, inst, personne.compte);
        plans.push({
          env,
          inst: complet,
          compte: personne.compte,
          grafana: complet.comptesGrafana.get(personne.compte.id),
          changements: planifier(profils, complet, { compte: personne.compte }, profilsARetablir(personne)),
        });
      }
      return plans;
    }),
  );
  return parEnv.flat();
}

// Les profils sont enregistrés après les groupes : un échec de l’attribut laisse les droits appliqués.
const rang = (c: Changement) =>
  c.systeme === "keycloak" ? (c.type === "creerCompte" ? 0 : c.type === "profils" ? 2 : 1) : c.type === "premiereConnexion" ? 4 : 3;
const motif = (erreur: unknown) => (erreur instanceof Error && erreur.message ? erreur.message : "Le service a refusé la modification.");

/**
 * Exécute un plan dans l’ordre : compte, groupes, attribut des profils, équipes. Un refus n’arrête pas le plan, sauf
 * l’échec de la création du compte (les changements suivants n’auraient pas de compte sur lequel agir).
 */
async function executerPlan(plan: Plan) {
  const { kc, gf } = instances(plan.env);
  const tries = [...plan.changements].sort((a, b) => rang(a) - rang(b));
  const faits: Changement[] = [];
  const ignores = tries.filter((c) => c.type === "premiereConnexion");
  const echecs: { changement: Changement; message: string }[] = [];
  let restants: Changement[] = [];
  let id = plan.compte?.id;
  const aExecuter = tries.filter((c) => c.type !== "premiereConnexion");
  for (const [index, c] of aExecuter.entries()) {
    try {
      if (c.systeme === "keycloak") {
        if (c.type === "creerCompte") {
          const cree = await functions.call<{ id: string | null }>("keycloak/creer-utilisateur", {
            instance: kc,
            identifiant: c.identifiant ?? c.email ?? "",
            ...(c.email ? { email: c.email } : {}),
          });
          id = cree.id ?? (await lireCompte(kc, c.email ? { email: c.email } : { identifiant: c.identifiant }))?.id;
          if (!id) throw new Error("Keycloak n’a pas rendu l’identifiant du compte créé.");
        } else if (c.type === "profils") {
          if (!id) throw new Error("Le compte Keycloak de la personne est introuvable.");
          await functions.call("keycloak/modifier-attribut-utilisateur", { instance: kc, utilisateur: id, attribut: ATTRIBUT_PROFILS, valeurs: c.noms });
        } else {
          const groupe = plan.inst.groupes.get(c.groupe);
          if (!groupe) throw new Error(`Le groupe Keycloak ${c.groupe} est introuvable.`);
          if (groupeAlerte(groupe)) throw new Error(`Le groupe ${c.groupe} est réservé aux alertes ; ses membres ne sont pas gérés par les profils.`);
          if (!id) throw new Error("Le compte Keycloak de la personne est introuvable.");
          await functions.call(c.type === "ajouter" ? "keycloak/ajouter-au-groupe" : "keycloak/retirer-du-groupe", { instance: kc, utilisateur: id, groupe: groupe.id });
        }
      } else {
        const equipe = plan.inst.equipes.get(c.equipe);
        if (!equipe) throw new Error(`L’équipe Grafana ${c.equipe} est introuvable.`);
        if (plan.grafana === undefined) throw new Error("La personne n’a pas encore de compte Grafana.");
        await functions.call(c.type === "ajouter" ? "grafana/ajouter-membre-equipe" : "grafana/retirer-membre-equipe", {
          instance: gf,
          equipe: equipe.id,
          utilisateur: plan.grafana,
        });
      }
      faits.push(c);
    } catch (erreur) {
      echecs.push({ changement: c, message: motif(erreur) });
      if (c.systeme === "keycloak" && c.type === "creerCompte") {
        restants = aExecuter.slice(index + 1);
        break;
      }
    }
  }
  return { faits, ignores, echecs, restants };
}

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/**
 * Applique tous les plans, environnement par environnement, sans s’arrêter à un refus ; rend le compte rendu à
 * notifier (titre, message, ton) et vrai si tout a réussi.
 */
export async function appliquerPlans(plans: readonly Plan[]) {
  let faits = 0;
  let attente = 0;
  const echecs: string[] = [];
  for (const plan of plans) {
    const qui = plan.compte ? libellePersonne(plan.compte) : (plan.email ?? "");
    const ou = [plan.env.nom, qui].filter(Boolean).join(" · ");
    let resultat: Awaited<ReturnType<typeof executerPlan>>;
    try {
      resultat = await executerPlan(plan);
    } catch (erreur) {
      echecs.push(`${ou} : ${motif(erreur)}`);
      continue;
    }
    faits += resultat.faits.length;
    attente += resultat.ignores.length;
    for (const echec of resultat.echecs) echecs.push(`${ou} : ${libelleChangement(echec.changement)} : ${echec.message}`);
    if (resultat.restants.length) echecs.push(`${ou} : ${pluriel(resultat.restants.length, "changement")} non tenté, faute de compte`);
  }
  const bilan = `${pluriel(faits, "changement")} appliqué${faits > 1 ? "s" : ""}${attente ? ` · ${pluriel(attente, "équipe")} Grafana à la première connexion` : ""}.`;
  if (!echecs.length)
    return {
      reussi: true,
      tone: "success" as const,
      title: "Accès mis à jour",
      description: `${bilan.slice(0, -1)} dans ${unique(plans.map(({ env }) => env.nom)).join(", ")}.`,
    };
  const montres = echecs.slice(0, 6);
  const reste = echecs.length - montres.length;
  return {
    reussi: false,
    tone: faits ? ("warning" as const) : ("error" as const),
    title: faits ? "Accès mis à jour en partie" : "Aucun accès mis à jour",
    description: `${bilan} ${pluriel(echecs.length, "échec")} :\n${montres.join("\n")}${reste ? `\n… et ${reste} autre${reste > 1 ? "s" : ""}.` : ""}`,
  };
}

/** Comptes Keycloak correspondant à la saisie, pour identifier la personne à ajouter (sans comptes de service). */
export async function chercherPersonnes(env: Environnement, texte: string): Promise<CompteKc[]> {
  const { kc } = instances(env);
  const { utilisateurs } = await functions.call<{ utilisateurs: CompteKc[] }>("keycloak/chercher-utilisateurs", { instance: kc, recherche: texte });
  return utilisateurs.filter(({ identifiant }) => !identifiant.startsWith("service-account-"));
}

/**
 * Lignes d’audit de chaque environnement, lus en parallèle ; un environnement illisible est signalé sans bloquer
 * les autres. `tousGroupes` lit en plus tous les groupes de chaque personne (pour l’export).
 */
export async function chargerAudit(profils: readonly Profil[], envs: readonly Environnement[], { tousGroupes = true } = {}) {
  const resultats = await Promise.all(
    envs.map(async (env) => {
      try {
        const { kc } = instances(env);
        const inst = await lireInstantane(profils, env);
        const groupes = new Map<string, string[]>();
        const file = tousGroupes ? [...personnesAcces(profils, inst)] : [];
        await Promise.all(
          Array.from({ length: Math.min(6, file.length) }, async () => {
            for (let p = file.shift(); p; p = file.shift()) {
              const lus = await functions
                .call<{ groupes?: GroupeDetaille[] }>("keycloak/lire-utilisateur", { instance: kc, utilisateur: p.compte.id, groupes: true })
                .catch(() => undefined);
              if (lus?.groupes) groupes.set(p.compte.id, lus.groupes.filter((g) => !groupeAlerte(g)).map((g) => g.chemin));
            }
          }),
        );
        return { env, lignes: lignesAudit(profils, env, inst, groupes), trouves: problemes(profils, inst) };
      } catch {
        return { env, illisible: true as const };
      }
    }),
  );
  const lignes: LigneAudit[] = [];
  const illisibles: string[] = [];
  const configuration: { environnement: string; problemes: Probleme[] }[] = [];
  for (const r of resultats) {
    if ("illisible" in r) illisibles.push(r.env.nom);
    else {
      lignes.push(...r.lignes);
      if (r.trouves.length) configuration.push({ environnement: r.env.nom, problemes: r.trouves });
    }
  }
  return { lignes, illisibles, configuration };
}
