import { History, Play } from "lucide-react";
import { type Action, FormattedValue, Link, ProgressBar, Row, Section, Stack, StatusBadge, Surface, Text } from "@alfred/ui";
import { ACTIFS, type Deploiement, duree, type EtatDeploiement, etatAffiche, nomComplet, planification, resume } from "./prefect";

interface Props {
  deploiement: Deploiement;
  etat: EtatDeploiement | undefined;
  compte?: string;
  maintenant: number;
  onLancer: () => Promise<unknown>;
  onHistorique: () => unknown;
  onDernier: () => Promise<unknown>;
  autres: Action[];
}

const court = (texte: string, max = 160) => (texte.length > max ? `${texte.slice(0, max - 1)}…` : texte);

export function CarteDeploiement({ deploiement: d, etat, compte, maintenant, onLancer, onHistorique, onDernier, autres }: Props) {
  const dernier = etat?.dernier ?? null;
  const affiche = etat ? etatAffiche(dernier?.etat, dernier?.etatNom) : { label: "Chargement…", tone: "neutral" as const };
  const enCours = Boolean(dernier && ACTIFS.has(dernier.etat));
  const quand = dernier ? (enCours ? dernier.debut ?? dernier.debutPrevu : dernier.fin ?? dernier.debut ?? dernier.debutPrevu) : null;

  let avancement = 50;
  if (enCours && dernier?.debut && etat?.dureeHabituelle) {
    const ecoule = (maintenant - new Date(dernier.debut).getTime()) / 1000;
    avancement = Math.min(99, Math.max(1, Math.round((ecoule / etat.dureeHabituelle) * 100)));
  }
  const echec = dernier && ["FAILED", "CRASHED"].includes(dernier.etat) ? dernier.message : null;
  const anciennes = (etat?.recentes ?? []).slice(1);

  const actions: Action[] = [
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

  return (
    <Surface>
      <Section title={nomComplet(d)} description={[compte, planification(d)].filter(Boolean).join(" · ")} actions={actions}>
        <Stack gap="sm">
          <Row justify="between" wrap>
            <Row gap="xs" wrap>
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
          ) : dernier && enCours ? (
            <ProgressBar
              label={`${dernier.nom} · ${etat?.dureeHabituelle ? `habituellement ${duree(etat.dureeHabituelle)}` : "durée inconnue"}`}
              value={avancement}
              tone="warning"
              showValue={Boolean(etat?.dureeHabituelle)}
            />
          ) : dernier ? (
            <Text size="meta" tone="muted">
              Dernier run :{" "}
              <Link onClick={() => void onDernier()}>{dernier.nom}</Link>
              {dernier.duree ? ` · ${duree(dernier.duree)}` : ""}
            </Text>
          ) : null}

          {echec ? (
            <Text size="meta" tone="danger">
              {court(echec)}
            </Text>
          ) : null}

          {enCours && dernier ? (
            <Text size="meta" tone="muted">
              <Link onClick={() => void onDernier()}>Suivre les logs</Link>
            </Text>
          ) : null}

          {anciennes.length > 0 || etat?.prochaine ? (
            <Text size="meta" tone="muted">
              {anciennes.length > 0 ? `Avant : ${resume(anciennes)}` : ""}
              {anciennes.length > 0 && etat?.prochaine?.debutPrevu ? " · " : ""}
              {etat?.prochaine?.debutPrevu ? (
                <>
                  prochaine <FormattedValue value={etat.prochaine.debutPrevu} options={{ type: "relative" }} />
                </>
              ) : null}
            </Text>
          ) : null}
        </Stack>
      </Section>
    </Surface>
  );
}
