/**
 * Bloc d’un élément suivi (job Jenkins, déploiement Prefect). Ce fichier vient du module prefect ; cette copie a quitté
 * la `Card` (voir plus bas).
 *
 * Une `PageSection` de socle-ui, rangée dans la `PageGrid` de la page : en tête, le titre, le contexte (compte,
 * dossier) et les actions à droite ; puis au besoin une note (erreur, build précédent…), la ligne d’état (« Réussi · il
 * y a 2 jours ») et la barre d’avancement, avec le numéro du build. Pas de `Card` : dans une carte, l’examen du thème
 * clair relevait le titre, le contexte et l’état sous le contraste minimal.
 */
import { Row, Stack, Text } from "@alfred/kit";
import { PanelRight } from "lucide-react";
import { type Action, Badge, FormattedValue, Link, PageSection, ProgressBar } from "socle-ui";

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
            <Badge tone={etat.tone}>{etat.label}</Badge>
            {badges.map((badge) => (
              <Badge key={badge.label} tone={badge.tone}>
                {badge.label}
              </Badge>
            ))}
            {selectionnee ? <Badge tone="info">Ouvert dans le panneau</Badge> : null}
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
