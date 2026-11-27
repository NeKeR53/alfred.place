// Environnements d’Atom : lecture, écriture et formulaires, partagés par la page et son panneau.
import { Trash2 } from "lucide-react";
import { shell } from "@alfred/sdk";
import { createElement } from "react";
import type { Action, FormValues, OpenFormOptions, StatusMap } from "socle-ui";
import { db, functions } from "./source";

export const OUTILS = [
  { id: "keycloak", label: "Keycloak" },
  { id: "grafana", label: "Grafana" },
  { id: "openbao", label: "OpenBao" },
  { id: "portainer", label: "Portainer" },
] as const;
export type Outil = (typeof OUTILS)[number]["id"];

export const NATURES: StatusMap = {
  developpement: { label: "Développement", tone: "neutral" },
  integration: { label: "Intégration", tone: "pending" },
  recette: { label: "Recette", tone: "pending" },
  validation: { label: "Validation", tone: "success" },
  preproduction: { label: "Préproduction", tone: "warning" },
  production: { label: "Production", tone: "danger" },
};
export const OPTIONS_NATURE = Object.entries(NATURES).map(([id, nature]) => ({ id, label: nature.label }));

export const COULEURS = [
  { value: "steel", label: "Acier" },
  { value: "blue", label: "Bleu" },
  { value: "violet", label: "Violet" },
  { value: "pink", label: "Rose" },
  { value: "red", label: "Rouge" },
  { value: "orange", label: "Orange" },
  { value: "green", label: "Vert" },
  { value: "teal", label: "Sarcelle" },
];
const NOMS_COULEURS = Object.fromEntries(COULEURS.map((couleur) => [couleur.value, couleur.label]));

export interface Environnement {
  id: string;
  nom: string;
  code: string;
  nature: string;
  couleur: string;
  couleurNom: string;
  ordre: number;
  /** Instance rattachée à chaque outil, par identifiant. */
  instances: Partial<Record<Outil, string>>;
  /** Nom du compte rattaché à chaque outil (son identifiant si le compte n’existe plus). */
  comptes: Partial<Record<Outil, string>>;
  rattachements: string;
  outils: string[];
}

export type Compte = { id: string; label: string; default: boolean };
export type Comptes = Record<Outil, { comptes: Compte[]; probleme?: string }>;

/** Comptes de chaque outil, lus par le connecteur de l’outil ; un outil injoignable rend une liste vide. */
export async function lireComptes(): Promise<Comptes> {
  const lus = await Promise.all(
    OUTILS.map(async ({ id }) => {
      try {
        return await functions.call<{ comptes: Compte[]; probleme?: string }>(`${id}/lister-comptes`, {});
      } catch (erreur) {
        return { comptes: [], probleme: (erreur as Error).message };
      }
    }),
  );
  return Object.fromEntries(OUTILS.map(({ id }, index) => [id, lus[index]])) as Comptes;
}

type Ligne = { id: string; nom: string; code: string; nature: string; couleur: string; ordre: number };

export async function lireEnvironnements(comptes?: Comptes): Promise<Environnement[]> {
  const [lignes, liens] = await Promise.all([
    db.query<Ligne>("SELECT id, nom, code, nature, couleur, ordre FROM atom_environnements ORDER BY ordre, nom"),
    db.query<{ environnement: string; outil: Outil; instance: string }>(
      "SELECT environnement, outil, instance FROM atom_rattachements",
    ),
  ]);
  return lignes.map((ligne) => {
    const instances: Partial<Record<Outil, string>> = {};
    for (const lien of liens) if (lien.environnement === ligne.id) instances[lien.outil] = lien.instance;
    const nomsComptes: Partial<Record<Outil, string>> = {};
    for (const { id } of OUTILS) {
      const instance = instances[id];
      if (instance) nomsComptes[id] = comptes?.[id].comptes.find((compte) => compte.id === instance)?.label ?? instance;
    }
    const outils = OUTILS.filter(({ id }) => instances[id]).map(({ label }) => label);
    return {
      ...ligne,
      couleurNom: NOMS_COULEURS[ligne.couleur] ?? ligne.couleur,
      instances,
      comptes: nomsComptes,
      outils,
      rattachements: `${outils.length} sur ${OUTILS.length}`,
    };
  });
}

export async function lireEnvironnement(id: string, comptes?: Comptes) {
  return (await lireEnvironnements(comptes)).find((environnement) => environnement.id === id) ?? null;
}

const nettoyerCode = (code: string) => code.trim().toUpperCase();

async function enregistrer(valeurs: FormValues, existants: Environnement[], environnement?: Environnement) {
  const champs = [String(valeurs.nom ?? "").trim(), nettoyerCode(String(valeurs.code ?? "")), String(valeurs.nature ?? ""), String(valeurs.couleur ?? "")];
  const id = environnement?.id ?? crypto.randomUUID();
  if (environnement)
    await db.execute(
      "UPDATE atom_environnements SET nom = ?, code = ?, nature = ?, couleur = ?, modifie_le = datetime('now') WHERE id = ?",
      [...champs, id],
    );
  else
    await db.execute("INSERT INTO atom_environnements (id, nom, code, nature, couleur, ordre) VALUES (?, ?, ?, ?, ?, ?)", [
      id,
      ...champs,
      existants.length + 1,
    ]);
  // Position voulue : les autres environnements se renumérotent autour.
  const voulue = Math.min(Math.max(Math.trunc(Number(valeurs.ordre) || existants.length + 1), 1), existants.length + 1);
  const ordre = existants.map((item) => item.id).filter((autre) => autre !== id);
  ordre.splice(voulue - 1, 0, id);
  for (const [position, cle] of ordre.entries())
    await db.execute("UPDATE atom_environnements SET ordre = ? WHERE id = ?", [position + 1, cle]);
}

/** Nouvel ordre des environnements (liste des Réglages, poignée de glisser) : `ids` du premier au dernier. */
export async function reordonner(ids: string[]) {
  for (const [position, id] of ids.entries())
    await db.execute("UPDATE atom_environnements SET ordre = ? WHERE id = ?", [position + 1, id]);
}

/** Formulaire de création (sans environnement) ou de modification. */
export function formulaireEnvironnement(existants: Environnement[], environnement?: Environnement): OpenFormOptions {
  return {
    title: environnement ? "Modifier l’environnement" : "Nouvel environnement",
    fields: [
      { name: "nom", label: "Nom", placeholder: "Recette", isRequired: true },
      {
        name: "code",
        label: "Code",
        placeholder: "REC",
        isRequired: true,
        description: "Six lettres ou chiffres au plus : la marque courte de l’environnement.",
        validate: (valeur) => {
          const code = nettoyerCode(valeur);
          if (!/^[A-Z0-9]{1,6}$/.test(code)) return "Six lettres ou chiffres au plus, sans espace.";
          if (existants.some((autre) => autre.code === code && autre.id !== environnement?.id))
            return "Un autre environnement porte déjà ce code.";
          return undefined;
        },
      },
      { name: "nature", label: "Nature", type: "select", isRequired: true, options: OPTIONS_NATURE },
      { name: "couleur", label: "Couleur", type: "select", isRequired: true, options: COULEURS.map(({ value, label }) => ({ id: value, label })) },
      { name: "ordre", label: "Position", type: "number", min: 1, description: "1 pour le premier de la liste." },
    ],
    initialValues: environnement
      ? { ...environnement, ordre: environnement.ordre }
      : { nature: "integration", couleur: "steel", ordre: existants.length + 1 },
    submitLabel: environnement ? "Enregistrer" : "Créer",
    onSubmit: async (valeurs) => {
      await enregistrer(valeurs, existants, environnement);
      void shell.notify({ title: environnement ? "Environnement modifié" : "Environnement créé", tone: "success" });
    },
  };
}

/** Option « Aucun compte » du choix d’un compte : l’outil est détaché. */
const AUCUN = "__aucun__";

/** Formulaire des comptes d’un environnement : un compte par outil, parmi ceux de son connecteur. */
export function formulaireComptes(environnement: Environnement, comptes: Comptes): OpenFormOptions {
  return {
    title: `Comptes de ${environnement.nom}`,
    description: "Le compte de chaque outil que les pages d’Atom utilisent pour cet environnement.",
    fields: OUTILS_ORDRE.map(({ id, label }) => {
      const actuel = environnement.instances[id];
      const options = comptes[id].comptes.map((compte) => ({ id: compte.id, label: compte.label }));
      if (actuel && !options.some((option) => option.id === actuel)) options.push({ id: actuel, label: `${actuel} (introuvable)` });
      return {
        name: id,
        label,
        type: "select" as const,
        options: [{ id: AUCUN, label: "Aucun compte" }, ...options],
        description: options.length ? undefined : `Aucun compte ${label} : ajoutez-en un dans Modules, ${label}.`,
      };
    }),
    initialValues: Object.fromEntries(
      OUTILS.map(({ id }) => [id, environnement.instances[id] ?? comptes[id].comptes.find((compte) => compte.id === environnement.id)?.id ?? AUCUN]),
    ),
    submitLabel: "Enregistrer",
    onSubmit: async (valeurs) => {
      for (const { id } of OUTILS) {
        const valeur = String(valeurs[id] ?? AUCUN);
        await rattacher(environnement.id, id, valeur === AUCUN ? "" : valeur);
      }
      void shell.notify({ title: "Comptes enregistrés", tone: "success" });
    },
  };
}

/** Ordre des outils de OneApp dans la liste des environnements. */
export const OUTILS_ORDRE = [
  { id: "portainer", label: "Portainer" },
  { id: "openbao", label: "OpenBao" },
  { id: "keycloak", label: "Keycloak" },
  { id: "grafana", label: "Grafana" },
] as const;

/** Rattache le compte `instance` de l’outil à l’environnement, ou l’en détache (instance vide). */
export function rattacher(environnement: string, outil: Outil, instance: string) {
  return instance
    ? db.execute(
        "INSERT INTO atom_rattachements (environnement, outil, instance) VALUES (?, ?, ?) ON CONFLICT (environnement, outil) DO UPDATE SET instance = excluded.instance, modifie_le = datetime('now')",
        [environnement, outil, instance],
      )
    : db.execute("DELETE FROM atom_rattachements WHERE environnement = ? AND outil = ?", [environnement, outil]);
}

/** Environnements qui ont un compte pour l’outil, dans leur ordre, avec ce compte. */
export async function environnementsAvec(outil: Outil) {
  return (await lireEnvironnements())
    .filter((environnement) => environnement.instances[outil])
    .map((environnement) => ({ ...environnement, instance: environnement.instances[outil] as string }));
}

/** Suppression d’un environnement ; `apres` relit la liste. */
export function supprimer(environnement: Environnement, apres?: () => void): Action {
  return {
    id: "supprimer",
    label: "Supprimer",
    icon: createElement(Trash2, { size: 16 }),
    danger: true,
    confirm: {
      title: `Supprimer l’environnement « ${environnement.nom} » ?`,
      message: "Ses rattachements aux comptes sont retirés ; les comptes eux-mêmes et les services ne changent pas.",
      confirmLabel: "Supprimer",
    },
    onPress: async () => {
      await db.execute("DELETE FROM atom_environnements WHERE id = ?", [environnement.id]);
      void shell.notify({ title: "Environnement supprimé", tone: "success" });
      apres?.();
    },
  };
}
