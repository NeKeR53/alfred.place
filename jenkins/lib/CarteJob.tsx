import { FileText, Play } from "lucide-react";
import { type Action, FormattedValue, ProgressBar, Row, Section, Stack, StatusBadge, Surface, Text } from "@alfred/ui";
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

export function CarteJob({ carte, etat, compte, maintenant, onLogs, onRelancer, autres }: Props) {
  const affiche = etatAffiche(etat);
  const dernier = etat?.dernier ?? null;
  const enCours = Boolean(dernier?.enCours);
  const precedent = etat?.dernierTermine;
  const contexte = [compte, dossierDe(carte.job)].filter(Boolean).join(" · ");

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
      confirm: `Relancer le job « ${etat?.nom ?? nomCourt(carte.job)} » ?`,
      confirmMessage: etat?.parametre
        ? "Il repartira avec les paramètres de son dernier build."
        : "Un nouveau build sera mis en file dans Jenkins.",
      success: "Build demandé",
      onClick: onRelancer,
    },
    ...autres,
  ];

  // La barre d’avancement est collée au bas de la carte, quelle que soit la hauteur du contenu.
  const barre = dernier ? (
    <ProgressBar
      label={
        enCours
          ? `Build n° ${dernier.numero} · estimé à ${duree(dernier.dureeEstimee)}`
          : `Build n° ${dernier.numero} · ${duree(dernier.duree)}`
      }
      value={avancement}
      tone={affiche.tone === "neutral" ? undefined : affiche.tone}
      showValue={enCours}
    />
  ) : null;

  return (
    <Surface footer={barre}>
      <Section title={etat?.nom ?? nomCourt(carte.job)} description={contexte || undefined} actions={actions}>
        <Stack gap="sm">
          <Row justify="between">
            <StatusBadge tone={affiche.tone}>{affiche.label}</StatusBadge>
            {fin ? (
              <Text as="span" size="meta" tone="muted">
                {enCours ? "lancé " : ""}
                <FormattedValue value={fin} options={{ type: "relative" }} />
              </Text>
            ) : null}
          </Row>
          {etat?.erreur ? (
            <Text size="meta" tone={etat.existe ? "warning" : "danger"}>
              {etat.erreur}
            </Text>
          ) : !dernier && etat ? (
            <Text size="meta" tone="muted">
              Aucun build pour l’instant.
            </Text>
          ) : enCours && precedent ? (
            <Text size="meta" tone="muted">
              Build précédent : {RESULTATS[precedent.resultat ?? ""]?.label.toLowerCase() ?? "inconnu"} (n° {precedent.numero})
            </Text>
          ) : null}
        </Stack>
      </Section>
    </Surface>
  );
}
