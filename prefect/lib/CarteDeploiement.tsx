import { FileText, History, Play } from "lucide-react";
import type { Action } from "socle-ui";
import { CarteSuivi } from "./CarteSuivi";
import type { Rapport } from "./rapport";
import { ACTIFS, type Deploiement, duree, type EtatDeploiement, etatAffiche, nomComplet } from "./prefect";

interface Props {
  deploiement: Deploiement;
  etat: EtatDeploiement | undefined;
  compte?: string;
  maintenant: number;
  onLogs: () => unknown;
  onLancer: () => Promise<unknown>;
  onHistorique: () => unknown;
  /** Carte ouverte dans le panneau Historique. */
  selectionnee?: boolean;
  /** Rapport d’échec de la dernière exécution, et analyse lancée depuis la carte. */
  rapport?: Rapport;
  enAnalyse?: boolean;
  onRapport: (rapport: Rapport) => void;
  onAnalyser: () => Promise<unknown>;
  autres: Action[];
}

/** Carte d’un déploiement : les données Prefect passées à la carte commune (`CarteSuivi`, la même que celle de
 * Jenkins). Aucun extrait de log dans la carte : les logs s’ouvrent seulement dans la modale. */
export function CarteDeploiement({ deploiement: d, etat, compte, maintenant, onLogs, onLancer, onHistorique, selectionnee = false, rapport, enAnalyse, onRapport, onAnalyser, autres }: Props) {
  const dernier = etat?.dernier ?? null;
  const enCours = Boolean(dernier && ACTIFS.has(dernier.etat));
  const quand = dernier ? (enCours ? (dernier.debut ?? dernier.debutPrevu) : (dernier.fin ?? dernier.debut ?? dernier.debutPrevu)) : null;

  let avancement = 100;
  if (enCours) {
    avancement = 50;
    if (dernier?.debut && etat?.dureeHabituelle) {
      const ecoule = (maintenant - new Date(dernier.debut).getTime()) / 1000;
      avancement = Math.min(99, Math.max(1, Math.round((ecoule / etat.dureeHabituelle) * 100)));
    }
  }

  // Dernière exécution en échec : son rapport, s’il existe.
  const echec = Boolean(dernier && ["FAILED", "CRASHED"].includes(dernier.etat));
  const rapportPret = echec && rapport?.statut === "prete" ? rapport : undefined;

  const actions: Action[] = [
    { id: "logs", label: "Voir les logs", icon: <FileText size={16} />, isDisabled: !dernier, onPress: onLogs },
    {
      id: "lancer",
      label: "Lancer",
      icon: <Play size={16} />,
      confirm: {
        title: `Lancer « ${nomComplet(d)} » ?`,
        message: "Une exécution démarre avec les paramètres par défaut du déploiement.",
        confirmLabel: "Lancer",
      },
      onPress: onLancer,
    },
    { id: "historique", label: "Voir l’historique", icon: <History size={16} />, onPress: onHistorique },
    {
      id: "rapport",
      label: "Voir le rapport d’échec",
      isHidden: !rapportPret,
      onPress: () => rapportPret && onRapport(rapportPret),
    },
    {
      id: "analyser",
      label: "Analyser l’échec",
      isHidden: !echec || enAnalyse || rapport?.statut === "en_cours",
      onPress: onAnalyser,
    },
    ...autres,
  ];

  // La carte reste courte : planification, exécutions précédentes et prochaine exécution sont dans le panneau Historique.
  const note = etat?.erreur
    ? { texte: etat.erreur, tone: "warning" as const }
    : !echec
      ? null
      : enAnalyse || rapport?.statut === "en_cours"
        ? { texte: "J’analyse les logs de cet échec…" }
        : rapportPret
          ? { texte: rapportPret.titre ?? rapportPret.cause ?? "", tone: "danger" as const, onClick: () => onRapport(rapportPret), lien: "Voir le rapport" }
          : rapport?.statut === "erreur"
            ? { texte: "L’analyse des logs n’a pas abouti.", tone: "warning" as const, onClick: () => void onAnalyser(), lien: "Réessayer" }
            : { texte: "Cet échec n’a pas encore été analysé.", onClick: () => void onAnalyser(), lien: "Analyser l’échec" };

  const badges = [
    ...(d.enPause ? [{ label: "Suspendu", tone: "neutral" as const }] : []),
    ...(d.statut === "NOT_READY" ? [{ label: "Aucun worker", tone: "warning" as const }] : []),
  ];

  return (
    <CarteSuivi
      titre={nomComplet(d)}
      contexte={compte}
      actions={actions}
      etat={etat ? etatAffiche(dernier?.etat, dernier?.etatNom) : { label: "Chargement…", tone: "neutral" }}
      badges={badges}
      quand={quand ? { date: quand, prefixe: enCours ? "lancée" : undefined } : null}
      note={note}
      selectionnee={selectionnee}
      barre={
        dernier
          ? {
              label: enCours
                ? `${dernier.nom} · ${etat?.dureeHabituelle ? `estimée à ${duree(etat.dureeHabituelle)}` : "durée inconnue"}`
                : `${dernier.nom}${dernier.duree ? ` · ${duree(dernier.duree)}` : ""}`,
              valeur: avancement,
              afficherValeur: enCours && Boolean(etat?.dureeHabituelle),
            }
          : etat
            ? { label: "Aucune exécution pour l’instant", valeur: 0 }
            : null
      }
    />
  );
}
