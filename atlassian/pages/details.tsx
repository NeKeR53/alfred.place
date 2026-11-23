import { functions, shell, useAsync, usePeerMessage, useSelection } from "@alfred/sdk";
import { DetailPanel, type DetailField } from "socle-ui";
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
  const selection = useSelection<{ id?: string } | string>();
  const { instance, cle } = separer(typeof selection === "string" ? selection : (selection?.id ?? ""));

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

  const remplis = (ticket?.champs ?? []).filter((c) => c.affichage);
  const vides = (ticket?.champs ?? []).filter((c) => !c.affichage && c.modifiable);
  const lecture = remplis.filter((c) => !c.modifiable);
  const modifiables = remplis.filter((c) => c.modifiable);
  const champs = (liste: typeof remplis): DetailField[] =>
    ticket
      ? liste.map((champ) => ({
          id: champ.id,
          label: champ.nom,
          value: (
            <ChampDirect
              champ={champ}
              instance={instance || undefined}
              cle={ticket.cle}
              projet={ticket.projet}
              apresEnregistrement={prevenir}
            />
          ),
        }))
      : [];

  return (
    <DetailPanel
      header={ticket ? { title: `Détails · ${ticket.cle}`, subtitle: "Chaque changement est enregistré aussitôt." } : undefined}
      sections={
        ticket
          ? [
              { id: "champs", title: "Champs", fields: champs(modifiables) },
              ...(vides.length > 0
                ? [{ id: "vides", title: "Champs vides", defaultCollapsed: true, fields: champs(vides) }]
                : []),
              ...(lecture.length > 0
                ? [
                    {
                      id: "lecture",
                      title: "En lecture seule",
                      fields: lecture.map((champ) => ({ id: champ.id, label: champ.nom, value: champ.affichage })),
                    },
                  ]
                : []),
            ]
          : undefined
      }
      isLoading={fiche.loading && !ticket}
      hasError={Boolean(fiche.error)}
      onRetry={fiche.reload}
      isNotFound={Boolean(cle) && !fiche.loading && !fiche.error && !ticket}
      emptyMessage="Ouvrez un ticket pour voir et modifier ses champs ici."
    />
  );
}
