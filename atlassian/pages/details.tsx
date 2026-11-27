import { functions, shell, usePageContext, usePeerMessage } from "@alfred/sdk";
import { Drawer, PropertyRow } from "socle-ui";
import { LigneChamp, useListesDuPanneau } from "../lib/champ-ligne";
import { useEtat } from "../lib/etat";
import type { FicheComplete } from "../lib/fiche-ticket";

function separer(identifiant: string): { instance: string; cle: string } {
  const texte = String(identifiant ?? "");
  const separateur = texte.indexOf("|");
  if (separateur < 0) return { instance: "", cle: texte };
  return { instance: texte.slice(0, separateur), cle: texte.slice(separateur + 1) };
}

/** Colonne de droite du ticket ouvert : chaque champ se modifie sur place, sans fenêtre. */
export default function DetailsTicket() {
  const { instance, cle } = separer(usePageContext()?.view?.id ?? "");

  const fiche = useEtat<{ ticket: FicheComplete | null }>("ticket", cle ? { instance, cle } : null);
  // La fiche du centre prévient quand elle change le ticket (état, temps passé…).
  usePeerMessage((message) => {
    if ((message as { type?: string })?.type === "ticket-modifie") fiche.reload();
  });

  const ticket = fiche.data?.ticket ?? null;
  const champs = ticket?.champs ?? [];
  const listes = useListesDuPanneau(instance || undefined, ticket?.projet ?? "", champs);

  if (!ticket) {
    return (
      <Drawer
        isLoading={fiche.loading}
        hasError={Boolean(fiche.error)}
        onRetry={fiche.reload}
        isNotFound={Boolean(cle) && !fiche.loading && !fiche.error}
        emptyMessage="Ouvrez un ticket pour voir et modifier ses champs ici."
      />
    );
  }

  async function enregistrer(champ: string, valeur: string | string[]) {
    await functions.call("modifier-champ", { instance: instance || undefined, cle, champ, valeur });
    // Jira relit le ticket (texte des valeurs), et la fiche du centre est prévenue.
    fiche.reload();
    void shell.send({ type: "ticket-modifie", cle });
  }

  const remplis = champs.filter((c) => c.affichage);
  const modifiables = remplis.filter((c) => c.modifiable && c.editeur !== "lecture");
  const vides = champs.filter((c) => !c.affichage && c.modifiable && c.editeur !== "lecture");
  const lecture = remplis.filter((c) => !c.modifiable || c.editeur === "lecture");
  const ligne = (champ: (typeof champs)[number]) => (
    <LigneChamp key={champ.id} champ={champ} listes={listes} instance={instance || undefined} projet={ticket.projet} enregistrer={enregistrer} />
  );

  return (
    <Drawer emptyMessage="Ouvrez un ticket pour voir et modifier ses champs ici.">
      <Drawer.Section id="ticket" title={ticket.cle} summary={ticket.statut || undefined}>
        <PropertyRow id="titre" label="Résumé" value={ticket.titre} />
        <PropertyRow id="type" label="Type" value={ticket.type || undefined} />
        <PropertyRow id="projet" label="Projet" value={ticket.projetNom || ticket.projet || undefined} />
      </Drawer.Section>
      <Drawer.Section id="champs" title="Champs">
        {modifiables.length > 0 ? modifiables.map(ligne) : <PropertyRow label="Champs" value="Aucun champ modifiable" />}
      </Drawer.Section>
      {vides.length > 0 ? (
        <Drawer.Section id="vides" title="Champs vides" summary={String(vides.length)} defaultCollapsed>
          {vides.map(ligne)}
        </Drawer.Section>
      ) : null}
      {lecture.length > 0 ? (
        <Drawer.Section id="lecture" title="En lecture seule" defaultCollapsed>
          {lecture.map(ligne)}
        </Drawer.Section>
      ) : null}
    </Drawer>
  );
}
