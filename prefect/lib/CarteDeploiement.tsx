import { FileText, History, Play } from "lucide-react";
import { type Action, FormattedValue, ProgressBar, Row, Section, Stack, StatusBadge, Surface, Text } from "@alfred/ui";
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

const court = (texte: string, max = 160) => (texte.length > max ? `${texte.slice(0, max - 1)}…` : texte);

/** Carte d’un déploiement, sur le modèle de la carte d’un job Jenkins : état, contexte, barre d’avancement en bas. */
export function CarteDeploiement({ deploiement: d, etat, compte, maintenant, onLogs, onLancer, onHistorique, autres }: Props) {
  const dernier = etat?.dernier ?? null;
  const affiche = etat ? etatAffiche(dernier?.etat, dernier?.etatNom) : { label: "Chargement…", tone: "neutral" as const };
  const enCours = Boolean(dernier && ACTIFS.has(dernier.etat));
  const quand = dernier ? (enCours ? (dernier.debut ?? dernier.debutPrevu) : (dernier.fin ?? dernier.debut ?? dernier.debutPrevu)) : null;
  const contexte = [compte, planification(d)].filter(Boolean).join(" · ");

  let avancement = 100;
  if (enCours) {
    avancement = 50;
    if (dernier?.debut && etat?.dureeHabituelle) {
      const ecoule = (maintenant - new Date(dernier.debut).getTime()) / 1000;
      avancement = Math.min(99, Math.max(1, Math.round((ecoule / etat.dureeHabituelle) * 100)));
    }
  }
  const echec = dernier && ["FAILED", "CRASHED"].includes(dernier.etat) ? dernier.message : null;
  const anciennes = (etat?.recentes ?? []).slice(1);

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

  // La barre d’avancement est collée au bas de la carte, quelle que soit la hauteur du contenu.
  const barre = dernier ? (
    <ProgressBar
      label={
        enCours
          ? `${dernier.nom} · ${etat?.dureeHabituelle ? `estimée à ${duree(etat.dureeHabituelle)}` : "durée inconnue"}`
          : `${dernier.nom}${dernier.duree ? ` · ${duree(dernier.duree)}` : ""}`
      }
      value={avancement}
      tone={affiche.tone === "neutral" ? undefined : affiche.tone}
      showValue={enCours && Boolean(etat?.dureeHabituelle)}
    />
  ) : null;

  return (
    <Surface footer={barre}>
      <Section title={nomComplet(d)} description={contexte || undefined} actions={actions}>
        <Stack gap="sm">
          <Row justify="between">
            <Row gap="xs">
              <StatusBadge tone={affiche.tone}>{affiche.label}</StatusBadge>
              {d.enPause ? (
                <StatusBadge size="compact" tone="neutral">
                  Suspendu
                </StatusBadge>
              ) : null}
              {d.statut === "NOT_READY" ? (
                <StatusBadge size="compact" tone="warning">
                  Aucun worker
                </StatusBadge>
              ) : null}
            </Row>
            {quand ? (
              <Text as="span" size="meta" tone="muted">
                {enCours ? "lancée " : ""}
                <FormattedValue value={quand} options={{ type: "relative" }} />
              </Text>
            ) : null}
          </Row>
          {etat?.erreur ? (
            <Text size="meta" tone="warning">
              {etat.erreur}
            </Text>
          ) : !dernier && etat ? (
            <Text size="meta" tone="muted">
              Aucune exécution pour l’instant.
            </Text>
          ) : echec ? (
            <Text size="meta" tone="danger">
              {court(echec)}
            </Text>
          ) : null}
          {anciennes.length > 0 || etat?.prochaine?.debutPrevu ? (
            <Text size="meta" tone="muted">
              {anciennes.length > 0 ? `Avant : ${resume(anciennes)}` : ""}
              {anciennes.length > 0 && etat?.prochaine?.debutPrevu ? " · " : ""}
              {etat?.prochaine?.debutPrevu ? (
                <>
                  {anciennes.length > 0 ? "prochaine" : "Prochaine"} <FormattedValue value={etat.prochaine.debutPrevu} options={{ type: "relative" }} />
                </>
              ) : null}
            </Text>
          ) : null}
        </Stack>
      </Section>
    </Surface>
  );
}
