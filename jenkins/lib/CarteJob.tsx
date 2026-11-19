import { FileText, Play } from "lucide-react";
import type { Action } from "@alfred/ui";
import { CarteSuivi } from "./CarteSuivi";
import { type Carte, duree, dossierDe, type EtatJob, etatAffiche, nomCourt, RESULTATS } from "./tableau";

interface Props {
  carte: Carte;
  etat: EtatJob | undefined;
  compte?: string;
  maintenant: number;
  onLogs: () => void;
  onRelancer: () => Promise<unknown>;
  autres: Action[];
}

/** Carte d’un job : les données Jenkins passées à la carte commune (`CarteSuivi`, la même que celle de Prefect). */
export function CarteJob({ carte, etat, compte, maintenant, onLogs, onRelancer, autres }: Props) {
  const nom = etat?.nom ?? nomCourt(carte.job);
  const dernier = etat?.dernier ?? null;
  const enCours = Boolean(dernier?.enCours);
  const precedent = etat?.dernierTermine;

  let avancement = 100;
  if (enCours && dernier?.debut) {
    const ecoule = maintenant - new Date(dernier.debut).getTime();
    avancement = dernier.dureeEstimee ? Math.min(99, Math.max(1, Math.round((ecoule / dernier.dureeEstimee) * 100))) : 50;
  }
  const fin =
    dernier?.debut && !enCours ? new Date(new Date(dernier.debut).getTime() + (dernier.duree ?? 0)).toISOString() : dernier?.debut;

  const actions: Action[] = [
    { label: "Voir les logs", icon: FileText, disabled: !dernier, onClick: onLogs },
    {
      label: "Relancer",
      icon: Play,
      disabled: !etat?.existe || etat?.desactive,
      confirm: `Relancer le job « ${nom} » ?`,
      confirmMessage: etat?.parametre
        ? "Il repartira avec les paramètres de son dernier build."
        : "Un nouveau build sera mis en file dans Jenkins.",
      success: "Build demandé",
      onClick: onRelancer,
    },
    ...autres,
  ];

  const note = etat?.erreur
    ? { texte: etat.erreur, tone: etat.existe ? ("warning" as const) : ("danger" as const) }
    : enCours && precedent
        ? { texte: `Build précédent : ${RESULTATS[precedent.resultat ?? ""]?.label.toLowerCase() ?? "inconnu"} (n° ${precedent.numero})` }
        : null;

  return (
    <CarteSuivi
      titre={nom}
      contexte={[compte, dossierDe(carte.job)].filter(Boolean).join(" · ")}
      actions={actions}
      etat={etatAffiche(etat)}
      quand={fin ? { date: fin, prefixe: enCours ? "lancé" : undefined } : null}
      note={note}
      barre={
        dernier
          ? {
              label: enCours
                ? `Build n° ${dernier.numero} · estimé à ${duree(dernier.dureeEstimee)}`
                : `Build n° ${dernier.numero} · ${duree(dernier.duree)}`,
              valeur: avancement,
              afficherValeur: enCours,
            }
          : etat
            ? { label: "Aucun build pour l’instant", valeur: 0 }
            : null
      }
    />
  );
}
