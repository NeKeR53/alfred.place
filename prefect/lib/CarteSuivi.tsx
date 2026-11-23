/**
 * Bloc d’un élément suivi (job Jenkins, déploiement Prefect). Ce fichier est copié à l’identique dans les modules
 * jenkins et prefect : seules les données passées changent.
 *
 * Une `PageSection` de socle-ui : le titre, le contexte et les actions en tête ; puis au besoin une note (erreur,
 * build précédent…), la ligne d’état (« Réussi · il y a 2 heures ») et la barre d’avancement.
 */
import { Row, Stack, Text } from "@alfred/kit";
import { PanelRight } from "lucide-react";
import { type Action, FormattedValue, Link, PageSection, ProgressBar, StatusBadge } from "socle-ui";

export type Ton = "neutral" | "warning" | "success" | "danger";

export interface PropsCarte {
  titre: string;
  contexte?: string;
  actions: Action[];
  /** État principal, en étiquette. */
  etat: { label: string; tone: Ton };
  /** Étiquettes secondaires après l’état (« Suspendu »). */
  badges?: { label: string; tone: Ton }[];
  /** Date de la ligne d’état, relative ; `prefixe` la précède (« lancé »). */
  quand?: { date: string; prefixe?: string } | null;
  /** Note sous le titre : une erreur ou un rappel court, avec au besoin un lien. */
  note?: { texte: string; tone?: "muted" | "warning" | "danger"; onClick?: () => void; lien?: string } | null;
  /** Barre d’avancement : 100 une fois terminé. */
  barre?: { label: string; valeur: number; afficherValeur?: boolean } | null;
  /** Ouvre le détail de l’élément dans le panneau de droite. */
  onOuvrir?: () => void;
  /** L’élément est celui ouvert dans le panneau. */
  selectionnee?: boolean;
}

export function CarteSuivi({
  titre,
  contexte,
  actions,
  etat,
  badges = [],
  quand,
  note,
  barre,
  onOuvrir,
  selectionnee = false,
}: PropsCarte) {
  const ouvrir: Action[] = onOuvrir
    ? [{ id: "ouvrir", label: `Ouvrir le détail de ${titre}`, icon: <PanelRight size={16} />, onPress: onOuvrir }]
    : [];
  return (
    <PageSection title={titre} description={contexte || undefined} actions={[...ouvrir, ...actions]}>
      <Stack gap="sm">
        {note ? (
          <Row gap="xs" wrap>
            <Text as="span" size="meta" tone={note.tone ?? "muted"}>
              {note.texte}
            </Text>
            {note.onClick ? <Link onPress={note.onClick}>{note.lien ?? "Voir le détail"}</Link> : null}
          </Row>
        ) : null}
        <Row justify="between" wrap>
          <Row gap="xs" wrap>
            <StatusBadge tone={etat.tone}>{etat.label}</StatusBadge>
            {badges.map((badge) => (
              <StatusBadge key={badge.label} tone={badge.tone}>
                {badge.label}
              </StatusBadge>
            ))}
            {selectionnee ? <StatusBadge tone="info">Ouvert dans le panneau</StatusBadge> : null}
          </Row>
          {quand ? (
            <Row gap="xs">
              {quand.prefixe ? (
                <Text as="span" size="meta" tone="muted">
                  {quand.prefixe}
                </Text>
              ) : null}
              <FormattedValue value={quand.date} type="relative" />
            </Row>
          ) : null}
        </Row>
        {barre ? (
          <ProgressBar
            label={barre.label}
            value={barre.valeur}
            tone={etat.tone === "warning" || etat.tone === "danger" ? etat.tone : "accent"}
            showValue={Boolean(barre.afficherValeur)}
          />
        ) : null}
      </Stack>
    </PageSection>
  );
}
