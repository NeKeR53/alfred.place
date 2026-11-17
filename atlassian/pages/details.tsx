import { functions, shell, useAsync, usePageContext, usePeerMessage } from "@alfred/sdk";
import { Button, Divider, EmptyState, FeedbackBanner, LoadingSkeleton, Page, Stack, Text } from "@alfred/ui";
import { ChampDirect } from "../lib/champ-direct";
import type { FicheComplete } from "../lib/fiche-ticket";

function separer(identifiant: string): { instance: string; cle: string } {
  const texte = String(identifiant ?? "");
  const separateur = texte.indexOf("|");
  if (separateur < 0) return { instance: "", cle: texte };
  return { instance: texte.slice(0, separateur), cle: texte.slice(separateur + 1) };
}

/** Colonne de droite du ticket ouvert : tous ses champs, chacun modifiable directement. */
export default function DetailsTicket() {
  const contexte = usePageContext();
  const selection = (contexte?.selection ?? null) as { id?: string } | null;
  const { instance, cle } = separer(selection?.id ?? "");

  const fiche = useAsync(
    () =>
      cle
        ? functions.call<{ ticket: FicheComplete | null }>("lire-ticket", { instance: instance || undefined, cle })
        : Promise.resolve({ ticket: null }),
    [instance, cle],
  );
  // La fiche du centre prévient quand elle change le ticket (état, temps passé…).
  usePeerMessage((message) => {
    if ((message as { type?: string })?.type === "ticket-modifie") fiche.reload();
  });

  const ticket = fiche.data?.ticket ?? null;
  const prevenir = () => void shell.send({ type: "ticket-modifie", cle });

  if (!cle) {
    return (
      <Page>
        <EmptyState size="compact" title="Aucun ticket ouvert" description="Ouvrez un ticket pour voir et modifier ses champs ici." />
      </Page>
    );
  }

  const remplis = (ticket?.champs ?? []).filter((c) => c.affichage || c.modifiable).filter((c) => c.affichage);
  const vides = (ticket?.champs ?? []).filter((c) => !c.affichage && c.modifiable);
  const lecture = remplis.filter((c) => !c.modifiable);
  const modifiables = remplis.filter((c) => c.modifiable);

  return (
    <Page header={ticket ? { title: `Détails · ${ticket.cle}`, subtitle: "Chaque changement est enregistré aussitôt." } : undefined}>
      {fiche.error ? (
        <FeedbackBanner tone="danger" action={<Button onClick={() => fiche.reload()}>Réessayer</Button>}>
          {fiche.error.message}
        </FeedbackBanner>
      ) : !ticket ? (
        fiche.loading ? <LoadingSkeleton /> : <EmptyState size="compact" title="Ticket introuvable" />
      ) : (
        <Stack gap="md">
          {modifiables.map((champ) => (
            <ChampDirect
              key={champ.id}
              champ={champ}
              instance={instance || undefined}
              cle={ticket.cle}
              projet={ticket.projet}
              apresEnregistrement={prevenir}
            />
          ))}
          {vides.length > 0 && (
            <>
              <Divider />
              <Text size="meta" tone="muted">
                Champs vides
              </Text>
              {vides.map((champ) => (
                <ChampDirect
                  key={champ.id}
                  champ={champ}
                  instance={instance || undefined}
                  cle={ticket.cle}
                  projet={ticket.projet}
                  apresEnregistrement={prevenir}
                />
              ))}
            </>
          )}
          {lecture.length > 0 && (
            <>
              <Divider />
              {lecture.map((champ) => (
                <ChampDirect
                  key={champ.id}
                  champ={champ}
                  instance={instance || undefined}
                  cle={ticket.cle}
                  projet={ticket.projet}
                  apresEnregistrement={prevenir}
                />
              ))}
            </>
          )}
        </Stack>
      )}
    </Page>
  );
}
