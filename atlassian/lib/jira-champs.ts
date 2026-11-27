/** Lecture et écriture générique des champs d’un ticket Jira, d’après leur schéma (editmeta). */

export type Editeur =
  | "texte"
  | "paragraphe"
  | "nombre"
  | "date"
  | "dateheure"
  | "choix"
  | "choixMultiple"
  | "etiquettes"
  | "personne"
  | "personnes"
  | "sprint"
  | "lecture";

export interface Option {
  id: string;
  nom: string;
}

export interface ChampTicket {
  id: string;
  nom: string;
  editeur: Editeur;
  modifiable: boolean;
  requis: boolean;
  /** Valeur affichée, en texte. */
  affichage: string;
  /** Valeur de départ de l’éditeur : texte, ou liste d’identifiants. */
  valeur: string | string[];
  options: Option[];
}

export function estChoixDirect(champ: ChampTicket): boolean {
  return champ.modifiable && (
    champ.editeur === "choix" ||
    champ.editeur === "choixMultiple" ||
    champ.editeur === "personne" ||
    champ.editeur === "personnes" ||
    champ.editeur === "etiquettes" ||
    champ.editeur === "sprint"
  );
}

export interface SchemaJira {
  type?: string;
  items?: string;
  system?: string;
  custom?: string;
}

export interface MetaChamp {
  name?: string;
  required?: boolean;
  schema?: SchemaJira;
  allowedValues?: Array<Record<string, unknown>>;
  operations?: string[];
}

/** Champs déjà montrés à part dans la fiche (en-tête, description, commentaires, liens…). */
export const CHAMPS_A_PART = new Set([
  "summary",
  "description",
  "comment",
  "attachment",
  "worklog",
  "issuelinks",
  "subtasks",
  "status",
  "project",
  "watches",
  "votes",
  "lastViewed",
  "timetracking",
  "parent",
  "thumbnail",
  "aggregateprogress",
  "progress",
  "workratio",
  "aggregatetimespent",
  "aggregatetimeestimate",
  "aggregatetimeoriginalestimate",
  "timeestimate",
  "timeoriginalestimate",
  "timespent",
  "issuekey",
]);

/** Noms français des champs système les plus courants. */
const NOMS: Record<string, string> = {
  assignee: "Assigné",
  reporter: "Rapporteur",
  creator: "Créateur",
  priority: "Priorité",
  issuetype: "Type",
  labels: "Étiquettes",
  components: "Composants",
  fixVersions: "Versions corrigées",
  versions: "Versions affectées",
  duedate: "Échéance",
  created: "Créé le",
  updated: "Mis à jour le",
  resolution: "Résolution",
  resolutiondate: "Résolu le",
  environment: "Environnement",
  security: "Niveau de sécurité",
  statuscategorychangedate: "Changement d’état le",
};

export function nomChamp(id: string, nom?: string): string {
  return NOMS[id] ?? nom ?? id;
}

const DATE_SEULE = /^\d{4}-\d{2}-\d{2}$/;

function nomObjet(valeur: Record<string, unknown>): string {
  for (const cle of ["displayName", "name", "value", "key", "title"]) {
    if (typeof valeur[cle] === "string" && valeur[cle]) {
      const enfant = valeur.child as Record<string, unknown> | undefined;
      return enfant ? `${valeur[cle]} › ${nomObjet(enfant)}` : String(valeur[cle]);
    }
  }
  return "";
}

function idObjet(valeur: Record<string, unknown>): string {
  for (const cle of ["accountId", "name", "id", "key", "value"]) {
    if (valeur[cle] !== undefined && valeur[cle] !== null && valeur[cle] !== "") return String(valeur[cle]);
  }
  return "";
}

/** Un sprint de Jira Server arrive en texte : « …[id=12,…,name=Sprint 12,…] ». */
function sprint(valeur: unknown): Option | null {
  if (valeur && typeof valeur === "object") {
    const objet = valeur as Record<string, unknown>;
    return { id: String(objet.id ?? ""), nom: String(objet.name ?? objet.id ?? "") };
  }
  if (typeof valeur === "string") {
    const id = /[[,]id=(\d+)/.exec(valeur)?.[1];
    const nom = /[[,]name=([^,\]]+)/.exec(valeur)?.[1];
    if (id || nom) return { id: id ?? "", nom: nom ?? id ?? "" };
  }
  return null;
}

export function choisirEditeur(schema: SchemaJira | undefined, meta: MetaChamp | undefined, id: string): Editeur {
  const custom = schema?.custom ?? "";
  if (custom.includes("gh-sprint")) return "sprint";
  const type = schema?.type ?? "";
  const items = schema?.items ?? "";
  const options = (meta?.allowedValues?.length ?? 0) > 0;
  if (type === "array") {
    if (items === "user") return "personnes";
    if (options) return "choixMultiple";
    if (items === "string") return "etiquettes";
    return "lecture";
  }
  if (type === "user") return "personne";
  if (options) return "choix";
  if (type === "number") return "nombre";
  if (type === "date") return "date";
  if (type === "datetime") return "dateheure";
  if (type === "string" || type === "any") {
    return custom.includes("textarea") || id === "environment" ? "paragraphe" : "texte";
  }
  return "lecture";
}

export function formaterValeur(valeur: unknown, editeur: Editeur): { affichage: string; valeur: string | string[] } {
  if (valeur === null || valeur === undefined || valeur === "") return { affichage: "", valeur: editeur.endsWith("s") || editeur === "choixMultiple" || editeur === "etiquettes" || editeur === "sprint" ? [] : "" };
  if (editeur === "sprint") {
    const liste = (Array.isArray(valeur) ? valeur : [valeur]).map(sprint).filter((s): s is Option => s !== null);
    return { affichage: liste.map((s) => s.nom).join(", "), valeur: liste.map((s) => s.id) };
  }
  if (Array.isArray(valeur)) {
    const elements = valeur.map((element) =>
      element && typeof element === "object"
        ? { id: idObjet(element as Record<string, unknown>), nom: nomObjet(element as Record<string, unknown>) }
        : { id: String(element), nom: String(element) },
    );
    return { affichage: elements.map((e) => e.nom).join(", "), valeur: elements.map((e) => e.id) };
  }
  if (typeof valeur === "object") {
    const objet = valeur as Record<string, unknown>;
    return { affichage: nomObjet(objet), valeur: idObjet(objet) };
  }
  if (typeof valeur === "number") {
    return { affichage: valeur.toLocaleString("fr-FR"), valeur: String(valeur) };
  }
  const texte = String(valeur);
  if (editeur === "date" && DATE_SEULE.test(texte)) {
    const [a, m, j] = texte.split("-").map(Number);
    const date = new Date(a, m - 1, j);
    return { affichage: new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date), valeur: texte };
  }
  if (editeur === "dateheure" || /^\d{4}-\d{2}-\d{2}T/.test(texte)) {
    const date = new Date(texte);
    if (!Number.isNaN(date.getTime())) {
      return {
        affichage: new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(date),
        valeur: texte,
      };
    }
  }
  return { affichage: texte, valeur: texte };
}

export function optionsDe(meta: MetaChamp | undefined): Option[] {
  return (meta?.allowedValues ?? [])
    .map((valeur) => ({ id: idObjet(valeur), nom: nomObjet(valeur) || idObjet(valeur) }))
    .filter((option) => option.id);
}

function personne(identifiant: string) {
  const net = identifiant.trim();
  if (!net) return null;
  const compteCloud = /^[0-9a-f]{24}$/i.test(net) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(net) || net.includes(":");
  return compteCloud ? { accountId: net } : { name: net };
}

/** Ce qu’il faut envoyer à Jira pour donner `valeur` à un champ de ce schéma. */
export function valeurPourJira(
  editeur: Editeur,
  schema: SchemaJira | undefined,
  valeur: string | string[] | null,
): unknown {
  const liste = Array.isArray(valeur) ? valeur.filter(Boolean) : valeur ? [valeur] : [];
  const texte = Array.isArray(valeur) ? (valeur[0] ?? "") : (valeur ?? "");
  const systeme = schema?.system ?? "";
  // Ces champs système se désignent par leur nom, pas par leur identifiant.
  const parNom = ["labels"].includes(systeme);
  switch (editeur) {
    case "texte":
    case "paragraphe":
      return texte === "" ? null : texte;
    case "nombre": {
      if (texte === "") return null;
      const nombre = Number(String(texte).replace(",", "."));
      if (Number.isNaN(nombre)) throw new Error("Saisissez un nombre.");
      return nombre;
    }
    case "date":
    case "dateheure":
      return texte === "" ? null : texte;
    case "choix":
      return texte === "" ? null : { id: texte };
    case "choixMultiple":
      return liste.map((id) => ({ id }));
    case "etiquettes":
      return parNom ? liste : liste;
    case "personne":
      return personne(texte);
    case "personnes":
      return liste.map(personne).filter(Boolean);
    case "sprint":
      return texte === "" ? null : Number(texte);
    default:
      throw new Error("Ce champ ne se modifie pas ici.");
  }
}
