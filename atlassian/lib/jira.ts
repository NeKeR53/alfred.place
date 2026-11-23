import type { StatusMap } from "socle-ui";

export interface Compte {
  id: string;
  label: string;
  default: boolean;
}

export interface Ticket {
  cle: string;
  id: string;
  instance: string | null;
  titre: string;
  description?: string;
  projet: string;
  projetNom: string;
  type: string;
  statut: string;
  statutCategorie: string;
  assigne: string;
  assigneId: string | null;
  rapporteur: string;
  priorite: string;
  echeance: string | null;
  etiquettes: string[];
  misAJour: string | null;
  url: string | null;
}

export interface Commentaire {
  id: string;
  auteur: string;
  cree: string | null;
  corps: string;
}

export interface Piece {
  id: string;
  nom: string;
  taille: number;
  type: string;
  url: string | null;
  cree: string | null;
}

export interface Transition {
  id: string;
  nom: string;
  vers: string;
  categorie: string;
}

export interface TicketDetail extends Ticket {
  description: string;
  cree: string | null;
  commentaires: Commentaire[];
  transitions: Transition[];
  pieces: Piece[];
}

export interface Referentiels {
  projets: Array<{ cle: string; nom: string }>;
  statuts: string[];
  priorites: string[];
  types: string[];
  moi: { id: string; nom: string } | null;
}

/** Catégories d’état Jira, seules valeurs stables d’une instance à l’autre. */
export const CATEGORIES: StatusMap = {
  new: { label: "À faire", tone: "neutral" },
  indeterminate: { label: "En cours", tone: "warning" },
  done: { label: "Terminé", tone: "success" },
  undefined: { label: "Sans catégorie", tone: "neutral" },
};

export const VUES = [
  { value: "ouverts", label: "Ouverts" },
  { value: "mes", label: "Mes tickets" },
  { value: "tous", label: "Tous" },
];

export const TRIS = [
  { value: "maj", label: "Dernière mise à jour" },
  { value: "priorite", label: "Priorité" },
  { value: "echeance", label: "Échéance" },
  { value: "creation", label: "Création" },
];

export interface Criteres {
  texte?: string;
  projet?: string;
  statuts: string[];
  assignes: string[];
  priorites: string[];
  types: string[];
  etiquettes: string[];
}

const CLES: Record<string, keyof Criteres> = {
  etat: "statuts",
  statut: "statuts",
  statuts: "statuts",
  assigne: "assignes",
  responsable: "assignes",
  personne: "assignes",
  assignes: "assignes",
  priorite: "priorites",
  priorites: "priorites",
  type: "types",
  types: "types",
  projet: "projet",
  etiquette: "etiquettes",
  label: "etiquettes",
  etiquettes: "etiquettes",
  texte: "texte",
  mot: "texte",
};

const LIBELLES: Record<string, string> = {
  statuts: "État",
  assignes: "Assigné",
  priorites: "Priorité",
  types: "Type",
  projet: "Projet",
  etiquettes: "Étiquette",
  texte: "Texte",
};

function sansAccents(texte: string): string {
  return texte.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr");
}

/** Traduit les étiquettes de la recherche (« etat:Ouvert », « assigne:moi ») en critères JQL. */
export function analyserRecherche(tags: string[]): Criteres {
  const criteres: Criteres = { statuts: [], assignes: [], priorites: [], types: [], etiquettes: [] };
  const textes: string[] = [];
  for (const brut of tags) {
    const tag = brut.trim();
    if (!tag) continue;
    const separateur = tag.indexOf(":");
    const cle = separateur > 0 ? CLES[sansAccents(tag.slice(0, separateur))] : undefined;
    const valeur = separateur > 0 ? tag.slice(separateur + 1).trim() : "";
    if (cle && valeur) {
      if (cle === "projet" || cle === "texte") criteres[cle] = valeur;
      else (criteres[cle] as string[]).push(valeur);
      continue;
    }
    textes.push(tag);
  }
  if (textes.length > 0) criteres.texte = textes.join(" ");
  return criteres;
}

/** Libellé lisible d’une étiquette de recherche. */
export function formaterTag(tag: string): string {
  const separateur = tag.indexOf(":");
  if (separateur <= 0) return tag;
  const cle = CLES[sansAccents(tag.slice(0, separateur))];
  if (!cle) return tag;
  return `${LIBELLES[cle] ?? "Filtre"} : ${tag.slice(separateur + 1).trim()}`;
}

/** Suggestions offertes pendant la frappe : valeurs de l’instance et des tickets chargés. */
export function construireSuggestions(referentiels: Referentiels | undefined, tickets: Ticket[]): string[] {
  const valeurs = new Set<string>();
  for (const projet of referentiels?.projets ?? []) valeurs.add(`projet:${projet.cle}`);
  for (const statut of referentiels?.statuts ?? []) valeurs.add(`etat:${statut}`);
  for (const priorite of referentiels?.priorites ?? []) valeurs.add(`priorite:${priorite}`);
  for (const type of referentiels?.types ?? []) valeurs.add(`type:${type}`);
  valeurs.add("assigne:moi");
  for (const ticket of tickets) {
    if (ticket.assigne && ticket.assigne !== "Non assigné") valeurs.add(`assigne:${ticket.assigne}`);
    for (const etiquette of ticket.etiquettes) valeurs.add(`etiquette:${etiquette}`);
  }
  return [...valeurs].slice(0, 80);
}

/** Une durée relative courte, en français, sans dépendre du navigateur. */
export function dateRelative(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const secondes = Math.round((date.getTime() - Date.now()) / 1000);
  const absolu = Math.abs(secondes);
  if (absolu < 60) return "à l’instant";
  if (absolu < 3600) return `il y a ${Math.round(absolu / 60)} min`;
  if (absolu < 86400) return `il y a ${Math.round(absolu / 3600)} h`;
  if (absolu < 86400 * 30) return `il y a ${Math.round(absolu / 86400)} j`;
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function tailleLisible(octets: number): string {
  if (!octets) return "—";
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} ko`;
  return `${(octets / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}
