import { analyserRecherche, formaterTag, type Criteres } from "./jira";

/** Ce que fait une règle quand un ticket lui correspond. */
export const ACTIONS_REGLE: Record<string, { label: string; tone: "neutral" | "pending" | "warning" }> = {
  agent: { label: "Lancer un agent", tone: "pending" },
  notifier: { label: "Me prévenir", tone: "warning" },
  commenter: { label: "Commenter", tone: "neutral" },
};

export interface Regle {
  id: string;
  nom: string;
  active: number;
  /** Étiquettes de recherche, au même format que la recherche de la liste (« projet:ALF », « assigne:moi », mots libres). */
  criteres: string;
  question: string;
  action: string;
  consigne: string;
  automatique: number;
  maj_le: string;
}

/** Ticket tel que la liste le charge, réduit à ce que lisent les règles. */
export interface TicketRegle {
  cle: string;
  titre: string;
  description?: string;
  projet?: string;
  projetNom?: string;
  type?: string;
  statut?: string;
  statutCategorie?: string;
  assigne?: string;
  assigneId?: string | null;
  priorite?: string;
  etiquettes?: string[];
  misAJour?: string | null;
}

export type Vue = "ouverts" | "mes" | "tous";

export function lireTags(criteres: string): string[] {
  try {
    const valeur = JSON.parse(criteres);
    return Array.isArray(valeur) ? valeur.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/** « projet:ALF, priorite:High, export » → étiquettes. La virgule sépare les critères. */
export function tagsDepuisTexte(texte: string): string[] {
  return texte
    .split(/[,\n]/)
    .map((morceau) => morceau.trim())
    .filter(Boolean);
}

/** Sépare la vue (« vue:mes », « vue:tous ») des autres critères ; sans elle, une règle ne lit que les tickets ouverts. */
export function analyserRegle(tags: string[]): { vue: Vue; criteres: Criteres } {
  let vue: Vue = "ouverts";
  const autres: string[] = [];
  for (const tag of tags) {
    const m = /^vue\s*:\s*(.+)$/i.exec(tag.trim());
    if (m) {
      const valeur = sansAccents(m[1]);
      vue = valeur.startsWith("mes") ? "mes" : valeur.startsWith("tous") ? "tous" : "ouverts";
    } else autres.push(tag);
  }
  return { vue, criteres: analyserRecherche(autres) };
}

/** Résumé lisible des critères d’une règle : « Projet : ALF · Priorité : High · « export » ». */
export function decrireCriteres(tags: string[]): string {
  if (tags.length === 0) return "Tous les tickets ouverts";
  return tags
    .map((tag) => {
      const m = /^vue\s*:\s*(.+)$/i.exec(tag.trim());
      if (m) {
        const valeur = sansAccents(m[1]);
        return valeur.startsWith("mes") ? "Mes tickets" : valeur.startsWith("tous") ? "Ouverts et fermés" : "Ouverts";
      }
      return tag.includes(":") ? formaterTag(tag) : `« ${tag} »`;
    })
    .join(" · ");
}

function sansAccents(texte: string): string {
  return texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("fr").trim();
}

function parmi(valeur: string | undefined, liste: string[]): boolean {
  if (liste.length === 0) return true;
  const v = sansAccents(valeur ?? "");
  return liste.some((element) => sansAccents(element) === v);
}

/**
 * Le ticket remplit-il les critères de la règle ? Même lecture que la recherche Jira de la liste,
 * faite sur l’ordinateur : chaque critère doit être rempli, chaque mot libre trouvé dans le titre ou la description.
 */
export function correspond(ticket: TicketRegle, tags: string[], moi: string | null): boolean {
  const { vue, criteres } = analyserRegle(tags);
  const ferme = ticket.statutCategorie === "done";
  const estMoi = (personne: string) =>
    sansAccents(personne) === "moi"
      ? Boolean(moi) && (ticket.assigneId === moi || sansAccents(ticket.assigne ?? "") === sansAccents(moi ?? ""))
      : sansAccents(ticket.assigne ?? "") === sansAccents(personne) || ticket.assigneId === personne;
  if (vue !== "tous" && ferme) return false;
  if (vue === "mes" && !estMoi("moi")) return false;
  if (criteres.projet && !parmi(ticket.projet, [criteres.projet]) && !parmi(ticket.projetNom, [criteres.projet])) return false;
  if (!parmi(ticket.statut, criteres.statuts)) return false;
  if (!parmi(ticket.priorite, criteres.priorites)) return false;
  if (!parmi(ticket.type, criteres.types)) return false;
  if (criteres.assignes.length > 0 && !criteres.assignes.some(estMoi)) return false;
  if (criteres.etiquettes.length > 0) {
    const siennes = (ticket.etiquettes ?? []).map(sansAccents);
    if (!criteres.etiquettes.some((e) => siennes.includes(sansAccents(e)))) return false;
  }
  if (criteres.texte) {
    const texte = sansAccents(`${ticket.cle} ${ticket.titre} ${ticket.description ?? ""}`);
    if (!sansAccents(criteres.texte).split(/\s+/).filter(Boolean).every((mot) => texte.includes(mot))) return false;
  }
  return true;
}

/** Consigne complète donnée à l’agent d’une règle, ou d’une consigne lancée depuis un ticket. */
export function instructionAgent(consigne: string, cle: string, instance: string): string {
  return [
    `Tu travailles sur le ticket Jira ${cle} (compte « ${instance} »).`,
    `Consigne de l’utilisateur : ${consigne}`,
    `Lis d’abord le ticket en entier (lire-ticket). Passe toujours instance = « ${instance} » et cle = « ${cle} » aux fonctions Jira.`,
    "Demande l’accord de l’utilisateur avant tout changement chez Jira, Bitbucket ou Confluence. Réponds en français.",
  ].join("\n");
}

/** Outils offerts à l’agent d’une règle. */
export const OUTILS_AGENT = [
  "lire-ticket",
  "modifier-champ",
  "commenter-ticket",
  "transitionner-ticket",
  "lier-tickets",
  "consigner-temps",
  "lister-assignables",
  "creer-ticket",
  "lister-tickets",
  "lister-prs",
  "lire-pr",
  "rechercher-pages",
  "lire-page",
];
