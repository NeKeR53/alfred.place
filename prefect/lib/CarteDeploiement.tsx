import { FileText, History, Play } from "lucide-react";
import type { Action } from "@alfred/ui";
import { CarteSuivi } from "./CarteSuivi";
import { ACTIFS, type Deploiement, duree, type EtatDeploiement, etatAffiche, nomComplet, planification, resume } from "./prefect";

interface Props {
  deploiement: Deploiement;
  etat: EtatDeploiement | undefined;
  compte?: string;
  maintenant: number;
  onLogs: () => unknown;
  onLancer: () => Promise<unknown>;
  onHistorique: () => unknown;
  autres: Action[];
}

/** Carte d’un déploiement : les données Prefect passées à la carte commune (`CarteSuivi`, la même que celle de
 * Jenkins). Aucun extrait de log dans la carte : les logs s’ouvrent seulement dans la modale. */
export function CarteDeploiement({ deploiement: d, etat, compte, maintenant, onLogs, onLancer, onHistorique, autres }: Props) {
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

  const actions: Action[] = [
    { label: "Voir les logs", icon: FileText, disabled: !dernier, onClick: onLogs },
    {
      label: "Lancer",
      icon: Play,
      confirm: `Lancer « ${nomComplet(d)} » ?`,
      confirmMessage: "Une exécution démarre avec les paramètres par défaut du déploiement.",
      success: "Exécution lancée",
      onClick: onLancer,
    },
    { label: "Voir l’historique", icon: History, onClick: onHistorique },
    ...autres,
  ];

  const anciennes = (etat?.recentes ?? []).slice(1);
  const prochaine = etat?.prochaine?.debutPrevu ? "prochaine prévue" : "";
  const note = etat?.erreur
    ? { texte: etat.erreur, tone: "warning" as const }
    : !dernier && etat
      ? { texte: "Aucune exécution pour l’instant." }
      : anciennes.length > 0
        ? { texte: `Avant : ${resume(anciennes)}${prochaine ? ` · ${prochaine}` : ""}` }
        : prochaine
          ? { texte: "Prochaine exécution prévue." }
          : null;

  const badges = [
    ...(d.enPause ? [{ label: "Suspendu", tone: "neutral" as const }] : []),
    ...(d.statut === "NOT_READY" ? [{ label: "Aucun worker", tone: "warning" as const }] : []),
  ];

  return (
    <CarteSuivi
      titre={nomComplet(d)}
      contexte={[compte, planification(d)].filter(Boolean).join(" · ")}
      actions={actions}
      etat={etat ? etatAffiche(dernier?.etat, dernier?.etatNom) : { label: "Chargement…", tone: "neutral" }}
      badges={badges}
      quand={quand ? { date: quand, prefixe: enCours ? "lancée" : undefined } : null}
      note={note}
      barre={
        dernier
          ? {
              label: enCours
                ? `${dernier.nom} · ${etat?.dureeHabituelle ? `estimée à ${duree(etat.dureeHabituelle)}` : "durée inconnue"}`
                : `${dernier.nom}${dernier.duree ? ` · ${duree(dernier.duree)}` : ""}`,
              valeur: avancement,
              afficherValeur: enCours && Boolean(etat?.dureeHabituelle),
            }
          : null
      }
    />
  );
}
