import { BookOpen, ExternalLink, GitBranch, GitPullRequest } from "lucide-react";
import { functions, shell, useAsync, usePageContext } from "@alfred/sdk";
import {
  Button,
  Code,
  Divider,
  EmptyState,
  FeedbackBanner,
  Link,
  LoadingSkeleton,
  Page,
  Row,
  Section,
  Stack,
  StatusBadge,
  Text,
} from "@alfred/ui";

interface Depot {
  slug: string;
  nom: string;
  description: string;
  projet: string;
  projetNom: string;
  archive: boolean;
  public?: boolean;
  brancheDefaut: string | null;
  url: string | null;
  clones?: Array<{ nom: string; url: string }>;
}

/** Colonne « À propos » d’un dépôt, comme sur GitHub. La page publie « compte|PROJET/dépôt ». */
export default function AProposDepot() {
  const contexte = usePageContext();
  const selection = (contexte?.selection ?? null) as { id?: string } | null;
  const brut = selection?.id ?? "";
  const separateur = brut.indexOf("|");
  const instance = separateur >= 0 ? brut.slice(0, separateur) : "";
  const cle = separateur >= 0 ? brut.slice(separateur + 1) : brut;
  const [projet, ...reste] = cle.split("/");
  const depot = reste.join("/");

  const info = useAsync(
    () =>
      projet && depot
        ? functions.call<{ depot: Depot | null; branches: Array<{ nom: string }> }>("lire-depot", {
            instance: instance || undefined,
            projet,
            depot,
          })
        : Promise.resolve({ depot: null, branches: [] }),
    [instance, projet, depot],
  );
  const prs = useAsync(
    () =>
      projet && depot
        ? functions.call<{ prs: unknown[] }>("lister-prs", {
            instance: instance || undefined,
            projet,
            depot,
            etat: "OPEN",
            role: "ALL",
            limite: 50,
          })
        : Promise.resolve({ prs: [] }),
    [instance, projet, depot],
  );

  if (!projet || !depot) {
    return (
      <Page>
        <EmptyState size="compact" title="Aucun dépôt ouvert" description="Ouvrez un dépôt pour voir sa fiche ici." />
      </Page>
    );
  }

  const fiche = info.data?.depot ?? null;
  const nbBranches = info.data?.branches.length ?? 0;
  const nbPrs = prs.data?.prs.length ?? 0;

  return (
    <Page>
      {info.error ? (
        <FeedbackBanner tone="danger" action={<Button onClick={() => info.reload()}>Réessayer</Button>}>
          {info.error.message}
        </FeedbackBanner>
      ) : !fiche ? (
        info.loading ? <LoadingSkeleton /> : <EmptyState size="compact" title="Dépôt introuvable" />
      ) : (
        <Stack gap="lg">
          <Section title="À propos">
            <Stack gap="md">
              <Text>{fiche.description || "Aucune description."}</Text>
              <Row gap="xs" wrap>
                <StatusBadge tone="neutral" size="compact">
                  {fiche.projetNom || fiche.projet}
                </StatusBadge>
                <StatusBadge tone={fiche.archive ? "warning" : "neutral"} size="compact">
                  {fiche.archive ? "Archivé" : fiche.public ? "Public" : "Privé"}
                </StatusBadge>
              </Row>
              <Stack gap="xs">
                <Row gap="sm">
                  <GitBranch size={16} aria-hidden="true" />
                  <Text as="span">{`${nbBranches} branche${nbBranches > 1 ? "s" : ""}`}</Text>
                </Row>
                <Row gap="sm">
                  <GitPullRequest size={16} aria-hidden="true" />
                  <Text as="span">{`${nbPrs} pull request${nbPrs > 1 ? "s" : ""} ouverte${nbPrs > 1 ? "s" : ""}`}</Text>
                </Row>
                {fiche.brancheDefaut && (
                  <Row gap="sm">
                    <BookOpen size={16} aria-hidden="true" />
                    <Text as="span">Branche par défaut</Text>
                    <Code>{fiche.brancheDefaut}</Code>
                  </Row>
                )}
                {fiche.url && (
                  <Row gap="sm">
                    <ExternalLink size={16} aria-hidden="true" />
                    <Link href={fiche.url} onNavigate={(href) => void shell.openExternal(href)}>
                      Ouvrir dans Bitbucket
                    </Link>
                  </Row>
                )}
              </Stack>
            </Stack>
          </Section>
          {(fiche.clones?.length ?? 0) > 0 && (
            <>
              <Divider />
              <Section title="Cloner">
                <Stack gap="sm">
                  {(fiche.clones ?? []).map((lien) => (
                    <Stack key={lien.nom} gap="xs">
                      <Text size="meta" tone="muted">
                        {lien.nom}
                      </Text>
                      <Code block label={`Adresse ${lien.nom}`}>
                        {lien.url}
                      </Code>
                    </Stack>
                  ))}
                </Stack>
              </Section>
            </>
          )}
        </Stack>
      )}
    </Page>
  );
}
