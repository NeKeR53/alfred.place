import { Row, Stack, Text } from "@alfred/kit";
import { functions, shell, useAsync, usePeerMessage } from "@alfred/sdk";
import { Clock, ExternalLink, Eye, EyeOff, Link2, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type Action,
  Button,
  Modal,
  HtmlContent,
  InlineEdit,
  List,
  type ListItemData,
  PageSection,
  PropertyRow,
  Badge,
  TabPanel,
  Tabs,
  useConfirm,
  useOpenForm,
} from "socle-ui";
import { dateRelative, tailleLisible } from "./jira";
import type { ChampTicket } from "./jira-champs";
import { tonCategorie, tonPriorite } from "./affichage";

/** Prévient la fiche ouverte qu’un changement fait ailleurs dans la page (l’état, depuis l’en-tête) doit être relu. */
const abonnes = new Set<(cle: string) => void>();
export function signalerModification(cle: string) {
  for (const abonne of abonnes) abonne(cle);
  void shell.send({ type: "ticket-modifie", cle });
}

export interface Transition {
  id: string;
  nom: string;
  vers: string;
  categorie: string;
}

/** Transitions proposées par Jira pour un ticket ; aucune : la page le dit, rien ne s’ouvre. */
export async function lireTransitions(instance: string | undefined, cle: string): Promise<Transition[] | null> {
  const { transitions } = await functions.call<{ transitions: Transition[] }>("transitionner-ticket", { instance, cle });
  if (!Array.isArray(transitions) || transitions.length === 0) {
    void shell.notify({ title: "Aucun changement d’état n’est proposé pour ce ticket", tone: "info" });
    return null;
  }
  return transitions;
}

/** Modale « Changer l’état » : les transitions du ticket, en liste ; en choisir une l’applique. */
export function ChoixEtat({
  instance,
  cle,
  transitions,
  onClose,
}: {
  instance: string | undefined;
  cle: string;
  transitions: Transition[];
  onClose: () => void;
}) {
  return (
    <Modal
      isOpen
      title="Changer l’état"
      description={`Ticket ${cle}`}
      onOpenChange={(ouverte) => {
        if (!ouverte) onClose();
      }}
      footer={<Button onPress={onClose}>Annuler</Button>}
    >
      <List
        label="Transitions disponibles"
        selectionMode="none"
        items={transitions.map((transition) => ({
          id: transition.id,
          title: transition.nom,
          status: { label: transition.vers, tone: tonCategorie(transition.categorie) },
        }))}
        onAction={async (id) => {
          try {
            await functions.call("transitionner-ticket", { instance, cle, transition: id });
            signalerModification(cle);
            onClose();
          } catch (erreur) {
            void shell.notify({ title: "Le changement d’état a échoué", description: (erreur as Error).message, tone: "error" });
          }
        }}
      />
    </Modal>
  );
}

interface Resume {
  cle: string;
  titre: string;
  statut: string;
  categorie: string;
  type: string;
}

export interface FicheComplete {
  cle: string;
  instance: string | null;
  titre: string;
  description: string;
  descriptionHtml: string;
  statut: string;
  statutCategorie: string;
  assigne: string;
  rapporteur: string;
  priorite: string;
  type: string;
  projet: string;
  projetNom: string;
  cree: string | null;
  misAJour: string | null;
  url: string | null;
  parent: Resume | null;
  champs: ChampTicket[];
  pieces: Array<{ id: string; nom: string; taille: number; type: string; url: string | null; cree: string | null; auteur?: string }>;
  commentaires: Array<{ id: string; auteur: string; cree: string | null; modifie?: string | null; corps: string; html: string }>;
  liens: Array<Resume & { id: string; relation: string }>;
  sousTaches: Resume[];
  temps: {
    estimation: string;
    restant: string;
    passe: string;
    entrees: Array<{ id: string; auteur: string; duree: string; quand: string | null; commentaire: string }>;
  };
  observateurs: number;
  jeSuis: boolean;
  votes: number;
  historique: Array<{ id: string; auteur: string; quand: string | null; changements: Array<{ champ: string; de: string; vers: string }> }>;
  transitions: Array<{ id: string; nom: string; vers: string; categorie: string }>;
}

type Onglet = "commentaires" | "liens" | "temps" | "historique" | "pieces";

/** Un ticket lié, en élément de liste. */
const resumeTicket = (ticket: Resume, relation?: string): ListItemData => ({
  id: ticket.cle,
  title: `${ticket.cle} · ${ticket.titre}`,
  subtitle: [relation, ticket.type].filter(Boolean).join(" · ") || undefined,
  status: ticket.statut ? { label: ticket.statut, tone: tonCategorie(ticket.categorie) } : undefined,
});

function TicketLieModale({ instance, resume, onClose }: { instance?: string; resume: Resume; onClose: () => void }) {
  const fiche = useAsync(
    () => functions.call<{ ticket: FicheComplete | null }>("lire-ticket", { instance, cle: resume.cle }),
    [instance, resume.cle],
  );
  const ticket = fiche.data?.ticket;
  return (
    <Modal
      isOpen
      size="lg"
      title={`${resume.cle} · ${ticket?.titre ?? resume.titre}`}
      description={[ticket?.type ?? resume.type, ticket?.statut ?? resume.statut].filter(Boolean).join(" · ")}
      onOpenChange={(ouverte) => { if (!ouverte) onClose(); }}
      footer={<Button onPress={onClose}>Fermer</Button>}
    >
      <PageSection
        title="Description"
        state={fiche.error ? "error" : fiche.loading ? "loading" : "ready"}
        onRetry={fiche.reload}
        empty={!fiche.loading && !fiche.error && !ticket ? { title: "Ticket introuvable" } : undefined}
      >
        {ticket?.descriptionHtml ? (
          <HtmlContent html={ticket.descriptionHtml} label="Description du ticket lié" onLink={(url) => void shell.openExternal(url)} />
        ) : ticket ? (
          <Text>{ticket.description || "Aucune description."}</Text>
        ) : null}
      </PageSection>
    </Modal>
  );
}

/**
 * Fiche complète d’un ticket Jira : résumé, choix modifiables, description et activité.
 */
export function FicheTicket({ instance, cle }: { instance?: string; cle: string }) {
  const [onglet, setOnglet] = useState<Onglet>("commentaires");
  const [ticketLie, setTicketLie] = useState<Resume | null>(null);
  const [pieceOuverte, setPieceOuverte] = useState<FicheComplete["pieces"][number] | null>(null);
  const openForm = useOpenForm();
  const confirm = useConfirm();
  const fiche = useAsync(
    () => functions.call<{ ticket: FicheComplete | null }>("lire-ticket", { instance, cle }),
    [instance, cle],
  );
  // La colonne Détails, à droite, prévient quand elle modifie un champ.
  usePeerMessage((message) => {
    if ((message as { type?: string })?.type === "ticket-modifie") fiche.reload();
  });
  useEffect(() => {
    const abonne = (modifie: string) => {
      if (modifie === cle) fiche.reload();
    };
    abonnes.add(abonne);
    return () => {
      abonnes.delete(abonne);
    };
  }, [cle]);
  const ticket = fiche.data?.ticket;
  const recharger = () => fiche.reload();
  const appeler = async (fonction: string, entree: Record<string, unknown>) => {
    await functions.call(fonction, { instance, cle, ...entree });
    recharger();
    void shell.send({ type: "ticket-modifie", cle });
  };
  const reussi = (title: string) => shell.notify({ title, tone: "success" });

  if (fiche.error || !ticket) {
    return (
      <PageSection
        title="Ticket"
        state={fiche.error ? "error" : fiche.loading ? "loading" : "ready"}
        onRetry={recharger}
        empty={!fiche.error && !fiche.loading ? { title: "Ticket introuvable" } : undefined}
      >
        {null}
      </PageSection>
    );
  }

  const commenter = () =>
    openForm({
      title: "Ajouter un commentaire",
      fields: [{ name: "texte", label: "Commentaire", type: "textarea", isRequired: true }],
      submitLabel: "Publier",
      onSubmit: async (v) => {
        await appeler("commenter-ticket", { texte: v.texte });
        reussi("Commentaire ajouté");
      },
    });

  const consigner = () =>
    openForm({
      title: "Consigner du temps",
      description: "Durées au format Jira : 30m, 1h 30m, 2d.",
      fields: [
        { name: "duree", label: "Temps passé", isRequired: true, placeholder: "1h 30m" },
        { name: "jour", label: "Jour", placeholder: "AAAA-MM-JJ" },
        { name: "restant", label: "Temps restant", placeholder: "2h" },
        { name: "commentaire", label: "Ce qui a été fait", type: "textarea" },
      ],
      submitLabel: "Consigner",
      onSubmit: async (v) => {
        await appeler("consigner-temps", {
          duree: v.duree,
          jour: v.jour || undefined,
          restant: v.restant ?? "",
          commentaire: v.commentaire ?? "",
        });
        reussi("Temps consigné");
      },
    });

  async function lier() {
    const { types } = await functions.call<{ types: Array<{ nom: string; sortant: string; entrant: string }> }>(
      "lister-types-liens",
      { instance },
    );
    const options = types.flatMap((t) => [
      { id: `${t.nom}|sortant`, label: t.sortant },
      { id: `${t.nom}|entrant`, label: t.entrant },
    ]);
    return openForm({
      title: `Lier ${cle} à un autre ticket`,
      fields: [
        { name: "relation", label: "Ce ticket", type: "select", isRequired: true, options },
        { name: "autre", label: "Ticket", isRequired: true, placeholder: "ALF-12" },
      ],
      submitLabel: "Lier",
      onSubmit: async (v) => {
        const [type, sens] = String(v.relation).split("|");
        await appeler("lier-tickets", { autre: v.autre, type, sens });
        reussi("Tickets liés");
      },
    });
  }

  const modifierDescription = () =>
    openForm({
      title: "Modifier la description",
      fields: [{ name: "description", label: "Description", type: "textarea", minRows: 10, maxRows: 24 }],
      initialValues: { description: ticket.description },
      submitLabel: "Enregistrer",
      onSubmit: (v) => appeler("modifier-champ", { champ: "description", valeur: v.description ?? "" }),
    });

  const onglets: Array<{ id: Onglet; label: string }> = [
    { id: "commentaires", label: `Commentaires (${ticket.commentaires.length})` },
    { id: "liens", label: `Liens et sous-tâches (${ticket.liens.length + ticket.sousTaches.length})` },
    { id: "temps", label: "Temps passé" },
    { id: "historique", label: "Historique" },
    { id: "pieces", label: `Pièces jointes (${ticket.pieces.length})` },
  ];
  const vide = (texte: string) => (
    <Text tone="muted" size="meta">
      {texte}
    </Text>
  );

  let activite;
  if (onglet === "commentaires") {
    const commentaires = [...ticket.commentaires].reverse();
    activite =
      commentaires.length === 0 ? (
        vide("Aucun commentaire")
      ) : (
        <List
          label="Commentaires"
          selectionMode="none"
          leading="avatar"
          items={commentaires.map((commentaire) => ({
            id: commentaire.id,
            title: commentaire.auteur,
            subtitle: commentaire.corps,
            meta: `${dateRelative(commentaire.cree)}${commentaire.modifie ? " · modifié" : ""}`,
          }))}
          itemActions={(item) => {
            const commentaire = commentaires.find((c) => c.id === item.id);
            if (!commentaire) return [];
            return [
              {
                icon: <Pencil size={16} />,
                label: "Modifier le commentaire",
                onPress: () =>
                  void openForm({
                    title: "Modifier le commentaire",
                    fields: [{ name: "texte", label: "Commentaire", type: "textarea", isRequired: true }],
                    initialValues: { texte: commentaire.corps },
                    submitLabel: "Enregistrer",
                    onSubmit: async (v) => {
                      await appeler("modifier-commentaire", { commentaire: commentaire.id, texte: v.texte });
                      reussi("Commentaire modifié");
                    },
                  }),
              },
              {
                icon: <Trash2 size={16} />,
                label: "Supprimer le commentaire",
                onPress: async () => {
                  const oui = await confirm({
                    title: "Supprimer ce commentaire ?",
                    message: "Cette action est définitive.",
                    confirmLabel: "Supprimer",
                  });
                  if (oui) await appeler("supprimer-commentaire", { commentaire: commentaire.id });
                },
              },
            ];
          }}
        />
      );
  } else if (onglet === "liens") {
    const liens = [
      ...(ticket.parent ? [{ resume: ticket.parent, item: resumeTicket(ticket.parent, "Parent") }] : []),
      ...ticket.sousTaches.map((t) => ({ resume: t, item: resumeTicket(t, "Sous-tâche") })),
      ...ticket.liens.map((lien) => ({
        resume: lien,
        item: { ...resumeTicket(lien, lien.relation), id: `lien:${lien.id}` },
      })),
    ];
    activite =
      liens.length === 0 ? (
        vide("Aucun lien")
      ) : (
        <List
          label="Tickets liés"
          selectionMode="none"
          items={liens.map(({ item }) => item)}
          onAction={(id) => {
            const lien = liens.find(({ item }) => item.id === id);
            if (lien) setTicketLie(lien.resume);
          }}
          itemActions={(item) =>
            item.id.startsWith("lien:")
              ? [
                  {
                    icon: <Trash2 size={16} />,
                    label: `Retirer le lien avec ${item.title.split(" · ")[0]}`,
                    onPress: () => void appeler("supprimer-lien", { lien: item.id.slice(5) }),
                  },
                ]
              : []
          }
        />
      );
  } else if (onglet === "temps") {
    activite = (
      <Stack gap="md">
        <Stack gap="none">
          <PropertyRow label="Estimation initiale" value={ticket.temps.estimation || undefined} />
          <PropertyRow label="Temps passé" value={ticket.temps.passe || undefined} />
          <PropertyRow label="Temps restant" value={ticket.temps.restant || undefined} />
        </Stack>
        {ticket.temps.entrees.length > 0 ? (
          <List
            label="Temps consigné"
            selectionMode="none"
            leading="avatar"
            items={ticket.temps.entrees.map((entree) => ({
              id: entree.id,
              title: `${entree.auteur} · ${entree.duree}`,
              subtitle: entree.commentaire || undefined,
              meta: dateRelative(entree.quand),
            }))}
          />
        ) : (
          vide("Aucun temps consigné")
        )}
      </Stack>
    );
  } else if (onglet === "historique") {
    activite =
      ticket.historique.length === 0 ? (
        vide("Aucune modification")
      ) : (
        <List
          label="Historique du ticket"
          selectionMode="none"
          leading="avatar"
          items={ticket.historique.map((h) => ({
            id: h.id,
            title: `${h.auteur} · ${h.changements.map((c) => c.champ).join(", ")}`,
            subtitle: h.changements.map((c) => `${c.champ} : ${c.de || "—"} → ${c.vers || "—"}`).join(" ; "),
            meta: dateRelative(h.quand),
          }))}
        />
      );
  } else {
    activite =
      ticket.pieces.length === 0 ? (
        vide("Aucune pièce jointe")
      ) : (
        <List
          label="Pièces jointes"
          selectionMode="none"
          items={ticket.pieces.map((piece) => ({
            id: piece.id,
            title: piece.nom,
            subtitle: [tailleLisible(piece.taille), piece.auteur, dateRelative(piece.cree)].filter(Boolean).join(" · "),
          }))}
          onAction={(id) => {
            const piece = ticket.pieces.find((p) => p.id === id);
            if (piece) setPieceOuverte(piece);
          }}
        />
      );
  }

  // Chaque onglet de l’activité a son action, à droite du titre : commenter, lier, consigner du temps.
  const actionsActivite: Action[] =
    onglet === "commentaires"
      ? [{ id: "commenter", label: "Ajouter un commentaire", icon: <MessageSquare size={16} />, primary: true, onPress: commenter }]
      : onglet === "liens"
        ? [{ id: "lier", label: "Lier un ticket", icon: <Link2 size={16} />, primary: true, onPress: lier }]
        : onglet === "temps"
          ? [{ id: "consigner", label: "Consigner du temps", icon: <Clock size={16} />, primary: true, onPress: consigner }]
          : onglet === "pieces"
            ? [
                {
                  id: "ajouter-jira",
                  label: "Ajouter dans Jira",
                  icon: <ExternalLink size={16} />,
                  primary: true,
                  isHidden: !ticket.url,
                  onPress: () => shell.openExternal(ticket.url ?? ""),
                },
              ]
            : [];

  return (
    <>
      <PageSection
        title="Résumé"
        description={[
          ticket.type,
          ticket.projetNom || ticket.projet,
          `créé ${dateRelative(ticket.cree)}`,
          `mis à jour ${dateRelative(ticket.misAJour)}`,
          `${ticket.observateurs} observateur${ticket.observateurs > 1 ? "s" : ""}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={[
          {
            id: "suivre",
            label: ticket.jeSuis ? "Ne plus suivre le ticket" : "Suivre le ticket",
            icon: ticket.jeSuis ? <EyeOff size={16} /> : <Eye size={16} />,
            onPress: async () => {
              await appeler("suivre-ticket", { suivre: !ticket.jeSuis });
              reussi(ticket.jeSuis ? "Vous ne suivez plus ce ticket" : "Vous suivez ce ticket");
            },
          },
        ]}
      >
        <Stack gap="sm">
          <Row gap="sm" wrap>
            <Badge tone={tonCategorie(ticket.statutCategorie)}>{ticket.statut}</Badge>
            {ticket.priorite ? (
              <Badge tone={tonPriorite(ticket.priorite)}>{`Priorité ${ticket.priorite}`}</Badge>
            ) : null}
          </Row>
          <InlineEdit
            label="Résumé"
            value={ticket.titre}
            isRequired
            onSave={(valeur) => appeler("modifier-champ", { champ: "summary", valeur })}
          />
        </Stack>
      </PageSection>


      <PageSection
        title="Description"
        actions={[{ id: "modifier", label: "Modifier la description", icon: <Pencil size={16} />, onPress: modifierDescription }]}
      >
        {ticket.descriptionHtml ? (
          <HtmlContent html={ticket.descriptionHtml} label="Description du ticket" onLink={(url) => void shell.openExternal(url)} />
        ) : ticket.description ? (
          <Text>{ticket.description}</Text>
        ) : (
          <Text tone="muted">Aucune description : « Modifier la description » pour en écrire une.</Text>
        )}
      </PageSection>

      <PageSection title="Activité" actions={actionsActivite}>
        <Stack gap="md">
          <Tabs
            id="activite-ticket"
            pageTitle={`Activité de ${ticket.cle}`}
            items={onglets}
            selectedId={onglet}
            onSelectionChange={(id) => setOnglet(id as Onglet)}
          />
          <TabPanel tabs="activite-ticket">{activite}</TabPanel>
        </Stack>
      </PageSection>
      {ticketLie ? <TicketLieModale instance={instance} resume={ticketLie} onClose={() => setTicketLie(null)} /> : null}
      {pieceOuverte ? (
        <Modal
          isOpen
          title={pieceOuverte.nom}
          onOpenChange={(ouverte) => { if (!ouverte) setPieceOuverte(null); }}
          footer={
            <>
              <Button onPress={() => setPieceOuverte(null)}>Fermer</Button>
              {pieceOuverte.url ? (
                <Button variant="primary" onPress={() => void shell.openExternal(pieceOuverte.url ?? "")}>Ouvrir dans le navigateur</Button>
              ) : null}
            </>
          }
        >
          <Stack gap="none">
            <PropertyRow label="Taille" value={tailleLisible(pieceOuverte.taille)} />
            {pieceOuverte.type ? <PropertyRow label="Type de fichier" value={pieceOuverte.type} /> : null}
            {pieceOuverte.auteur ? <PropertyRow label="Ajoutée par" value={pieceOuverte.auteur} /> : null}
          </Stack>
        </Modal>
      ) : null}
    </>
  );
}
