import { Text } from "@alfred/kit";
import { Badge, type StatusMap } from "socle-ui";
import { type Lecture, useEtat } from "./etat";

export interface DelaiCourt {
  nom: string;
  restant: string;
  restantMs: number;
  depasse: boolean;
  enPause: boolean;
}

export interface DemandeListe {
  cle: string;
  id: string;
  instance: string | null;
  titre: string;
  client: string;
  clientEmail: string | null;
  typeDemande: string | null;
  statut: string;
  statutCategorie: string;
  assigne: string;
  priorite: string;
  creee: string | null;
  misAJour: string | null;
  sla: DelaiCourt | null;
  url: string | null;
}

export interface Delai {
  nom: string;
  restant: string;
  restantMs: number | null;
  objectif: string | null;
  depasse: boolean;
  enPause: boolean;
  termine: boolean;
}

export interface Echange {
  id: string;
  auteur: string;
  texte: string;
  public: boolean;
  date: string | null;
}

export interface Demande {
  cle: string;
  instance: string | null;
  titre: string;
  client: string;
  clientEmail: string | null;
  typeDemande: string | null;
  statut: string;
  statutCategorie: string;
  statutDepuis: string | null;
  assigne: string;
  assigneId: string | null;
  priorite: string;
  projet: string;
  creee: string | null;
  description: string;
  champs: { libelle: string; valeur: string }[];
  participants: string[];
  sla: Delai[];
  commentaires: Echange[];
  url: string | null;
  urlPortail: string | null;
}

/** La demande ouverte (« compte|clé »), reçue de l’état partagé « demande » puis à chaque changement. */
export function useDemande(id: string): Lecture<Demande | null> {
  const separateur = id.indexOf("|");
  const instance = separateur < 0 ? "" : id.slice(0, separateur);
  const cle = id.slice(separateur + 1);
  const lecture = useEtat<{ demande: Demande | null }>("demande", cle ? { instance, cle } : null);
  return { ...lecture, data: lecture.data ? lecture.data.demande : undefined };
}

/** Catégories d’état d’une demande, comme les range Jira. */
export const ETATS_DEMANDE: StatusMap = {
  new: { label: "À traiter", tone: "neutral" },
  indeterminate: { label: "En cours", tone: "warning" },
  done: { label: "Résolue", tone: "success" },
};

const UNE_HEURE = 3600 * 1000;

/** Ton et libellé d’un délai : dépassé, bientôt dû, en pause, atteint ou dans les temps. */
export function etatDelai(delai: { depasse: boolean; enPause: boolean; restantMs: number | null; termine?: boolean; restant: string }) {
  if (delai.depasse) return { ton: "danger" as const, libelle: delai.termine ? "Dépassé" : `Dépassé · ${delai.restant.replace(/^-/, "")}` };
  if (delai.termine) return { ton: "success" as const, libelle: "Atteint" };
  if (delai.enPause) return { ton: "neutral" as const, libelle: `En pause · ${delai.restant}` };
  if (delai.restantMs !== null && delai.restantMs < UNE_HEURE) return { ton: "warning" as const, libelle: delai.restant };
  return { ton: "neutral" as const, libelle: delai.restant };
}

/** Badge du délai le plus pressant d’une demande, pour une cellule de tableau. */
export function badgeDelai(delai: DelaiCourt | null) {
  if (!delai) {
    return (
      <Text as="span" tone="muted">
        —
      </Text>
    );
  }
  const { ton, libelle } = etatDelai(delai);
  return <Badge tone={ton}>{libelle}</Badge>;
}

/** Date et heure courtes, en français. */
export function dateHeure(valeur: string | null): string {
  if (!valeur) return "";
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}
