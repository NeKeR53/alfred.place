import { functions, shell, useAsync, usePeerMessage, useSelection } from "@alfred/sdk";
import { Drawer } from "socle-ui";
import { tonCategorie } from "../lib/affichage";
import { useLignesChamps } from "../lib/champ-ligne";
import type { FicheComplete } from "../lib/fiche-ticket";

function separer(identifiant: string): { instance: string; cle: string } {
  const texte = String(identifiant ?? "");
  const separateur = texte.indexOf("|");
  if (separateur < 0) return { instance: "", cle: texte };
  return { instance: texte.slice(0, separateur), cle: texte.slice(separateur + 1) };
}

/** Colonne de droite du ticket ouvert : tous ses champs, chacun modifiable par l’action de sa ligne. */
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
  const lignes = useLignesChamps({
    instance: instance || undefined,
    cle,
    projet: ticket?.projet ?? "",
    champs: ticket?.champs ?? [],
    // Jira relit le ticket (texte des valeurs), et la fiche du centre est prévenue.
    apresEnregistrement: () => {
      fiche.reload();
      void shell.send({ type: "ticket-modifie", cle });
    },
  });

  const remplis = (ticket?.champs ?? []).filter((c) => c.affichage);
  const vides = (ticket?.champs ?? []).filter((c) => !c.affichage && c.modifiable);
  const lecture = remplis.filter((c) => !c.modifiable);
  const modifiables = remplis.filter((c) => c.modifiable);

  return (
    <Drawer
      header={
        ticket
          ? {
              title: `${ticket.cle} · ${ticket.titre}`,
              subtitle: [ticket.type, ticket.projetNom || ticket.projet].filter(Boolean).join(" · ") || undefined,
              status: ticket.statut ? { label: ticket.statut, tone: tonCategorie(ticket.statutCategorie) } : undefined,
            }
          : undefined
      }
      sections={
        ticket
          ? [
              { id: "champs", title: "Champs", fields: lignes(modifiables), empty: "Aucun champ modifiable" },
              ...(vides.length > 0
                ? [{ id: "vides", title: "Champs vides", defaultCollapsed: true, fields: lignes(vides) }]
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
