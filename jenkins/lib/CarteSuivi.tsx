/**
 * Carte d’un élément suivi (job Jenkins, déploiement Prefect). Ce fichier est copié à l’identique dans les modules
 * jenkins et prefect : seules les données passées changent.
 *
 * En haut, le titre, le contexte et les actions, puis au besoin une note (erreur, build précédent…). En bas, le pied :
 * la ligne d’état (« Réussi · il y a 2 heures ») et la barre d’avancement. Le pied est le dernier enfant de la
 * surface, hors de la section, poussé vers le bas (`marginTop: "auto"`) : il est collé au bas de la carte et aligné sur
 * celui des cartes voisines avec n’importe quelle version d’Alfred.
 */
import { type Action, FormattedValue, ProgressBar, Row, Section, Stack, StatusBadge, Surface, Text } from "@alfred/ui";

export type Ton = "neutral" | "warning" | "success" | "danger";

export interface PropsCarte {
  titre: string;
  contexte?: string;
  actions: Action[];
  /** État principal, en badge dans le pied. */
  etat: { label: string; tone: Ton };
  /** Badges secondaires après l’état (« Suspendu »). */
  badges?: { label: string; tone: Ton }[];
  /** Date de la ligne d’état, relative ; `prefixe` la précède (« lancé »). */
  quand?: { date: string; prefixe?: string } | null;
  /** Note sous le titre : une erreur ou un rappel court. */
  note?: { texte: string; tone?: "muted" | "warning" | "danger" } | null;
  /** Barre d’avancement : 100 une fois terminé. */
  barre?: { label: string; valeur: number; afficherValeur?: boolean } | null;
}

export function CarteSuivi({ titre, contexte, actions, etat, badges = [], quand, note, barre }: PropsCarte) {
  return (
    <Surface>
      <Section title={titre} description={contexte || undefined} actions={actions}>
        {note ? (
          <Text size="meta" tone={note.tone ?? "muted"}>
            {note.texte}
          </Text>
        ) : null}
      </Section>
      {/* Exception à la règle 4, voulue : sans ce style, un Alfred d’avant dcca9aa ne colle pas le pied au bas de la carte. */}
      <div style={{ marginTop: "auto" }}>
        <Stack gap="sm">
          <Row justify="between">
            <Row gap="xs">
              <StatusBadge tone={etat.tone}>{etat.label}</StatusBadge>
              {badges.map((badge) => (
                <StatusBadge key={badge.label} size="compact" tone={badge.tone}>
                  {badge.label}
                </StatusBadge>
              ))}
            </Row>
            {quand ? (
              <Text as="span" size="meta" tone="muted">
                {quand.prefixe ? `${quand.prefixe} ` : ""}
                <FormattedValue value={quand.date} options={{ type: "relative" }} />
              </Text>
            ) : null}
          </Row>
          {barre ? (
            <ProgressBar
              label={barre.label}
              value={barre.valeur}
              tone={etat.tone === "neutral" ? undefined : etat.tone}
              showValue={Boolean(barre.afficherValeur)}
            />
          ) : null}
        </Stack>
      </div>
    </Surface>
  );
}
