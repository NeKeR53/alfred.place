import { useState } from "react";
import {
  ArrowRightLeft,
  Bot,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Link2,
  MessageSquare,
  PenLine,
  Pencil,
  Trash2,
} from "lucide-react";
import { ai, functions, shell, useAsync, usePeerMessage } from "@alfred/sdk";
import {
  type Action,
  Avatar,
  Button,
  Code,
  confirmAction,
  EmptyState,
  FeedbackBanner,
  HtmlContent,
  InlineEdit,
  IconButton,
  KeyValueList,
  List,
  ListItem,
  LoadingSkeleton,
  Markdown,
  openForm,
  openModal,
  Row,
  Section,
  Stack,
  StatusBadge,
  Tabs,
  Text,
  TextArea,
  TextInput,
} from "@alfred/ui";
import { dateRelative, tailleLisible } from "./jira";
import type { ChampTicket } from "./jira-champs";
import { tonCategorie, tonPriorite } from "./affichage";
import { type ContexteTicket, proposerSousTaches, redigerCommentaire, resumerTicket, suggererTriage } from "./assistant";

const NIVEAUX: Record<string, { label: string; tone: "danger" | "warning" | "neutral" }> = {
  critique: { label: "Critique", tone: "danger" },
  important: { label: "Important", tone: "warning" },
  normal: { label: "Normal", tone: "neutral" },
  faible: { label: "Faible", tone: "neutral" },
};

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

function ResumeTicket({ ticket, relation }: { ticket: Resume; relation?: string }) {
  return (
    <ListItem
      title={
        <Row gap="sm">
          <Code>{ticket.cle}</Code>
          <Text as="span">{ticket.titre}</Text>
        </Row>
      }
      description={[relation, ticket.type].filter(Boolean).join(" · ") || undefined}
      trailing={
        ticket.statut ? (
          <StatusBadge tone={tonCategorie(ticket.categorie)} size="compact">
            {ticket.statut}
          </StatusBadge>
        ) : undefined
      }
    />
  );
}

/**
 * Fiche complète d’un ticket Jira, comme dans Jira : description et activité à gauche,
 * tous les champs à droite, chacun modifiable sur place.
 */
export function FicheTicket({ instance, cle }: { instance?: string; cle: string }) {
  const [onglet, setOnglet] = useState<Onglet>("commentaires");
  const fiche = useAsync(
    () => functions.call<{ ticket: FicheComplete | null }>("lire-ticket", { instance, cle }),
    [instance, cle],
  );
  // La colonne Détails, à droite, prévient quand elle modifie un champ.
  usePeerMessage((message) => {
    if ((message as { type?: string })?.type === "ticket-modifie") fiche.reload();
  });
  const ticket = fiche.data?.ticket;
  const recharger = () => fiche.reload();
  const appeler = async (fonction: string, entree: Record<string, unknown>) => {
    await functions.call(fonction, { instance, cle, ...entree });
    recharger();
    void shell.send({ type: "ticket-modifie", cle });
  };

  // Criticité de ce ticket, jugée sur l’ordinateur.
  const jugement = useAsync(
    () =>
      ticket
        ? functions.call<{ resultats: Array<{ niveau: string; confiance: number; aVerifier: boolean; urgent?: boolean; bloquant?: boolean; frustration?: boolean }> }>(
            "evaluer-criticite",
            {
              instance: instance ?? "",
              complet: true,
              tickets: [
                {
                  cle: ticket.cle,
                  titre: ticket.titre,
                  type: ticket.type,
                  priorite: ticket.priorite,
                  misAJour: ticket.misAJour,
                  description: ticket.description,
                  dernierCommentaire: ticket.commentaires[ticket.commentaires.length - 1]?.corps ?? "",
                },
              ],
            },
          )
        : Promise.resolve({ resultats: [] }),
    [ticket?.cle, ticket?.misAJour],
  );
  const [analyse, setAnalyse] = useState<{ resume: string; pointsCles: string[]; prochaineEtape: string } | null>(null);

  if (fiche.error) {
    return (
      <FeedbackBanner tone="danger" action={<Button onClick={recharger}>Réessayer</Button>}>
        {fiche.error.message}
      </FeedbackBanner>
    );
  }
  if (!ticket) {
    return fiche.loading ? <LoadingSkeleton /> : <EmptyState title="Ticket introuvable" />;
  }

  function changerEtat() {
    return openModal({
      title: "Changer l’état",
      description: `Actuellement : ${ticket!.statut}`,
      content: (fermer) => (
        <List label="Transitions disponibles">
          {ticket!.transitions.map((transition) => (
            <ListItem
              key={transition.id}
              title={transition.nom}
              trailing={
                <StatusBadge tone={tonCategorie(transition.categorie)} size="compact">
                  {transition.vers}
                </StatusBadge>
              }
              onClick={async () => {
                try {
                  await appeler("transitionner-ticket", { transition: transition.id });
                  fermer();
                  void shell.notify({ title: `Ticket passé à « ${transition.vers} »`, tone: "success" });
                } catch (erreur) {
                  void shell.notify({ title: "Le changement d’état a échoué", description: (erreur as Error).message, tone: "error" });
                }
              }}
            />
          ))}
        </List>
      ),
    });
  }

  const commenter = () =>
    openForm({
      title: "Ajouter un commentaire",
      fields: [{ name: "texte", label: "Commentaire", type: "textarea" }],
      submitLabel: "Publier",
      success: "Commentaire ajouté",
      onSubmit: (v) => appeler("commenter-ticket", { texte: v.texte }),
    });

  const consigner = () =>
    openForm({
      title: "Consigner du temps",
      description: "Durées au format Jira : 30m, 1h 30m, 2d.",
      fields: [
        { name: "duree", label: "Temps passé", placeholder: "1h 30m" },
        { name: "jour", label: "Jour", type: "date", optional: true },
        { name: "restant", label: "Temps restant", optional: true, placeholder: "2h" },
        { name: "commentaire", label: "Ce qui a été fait", type: "textarea", optional: true },
      ],
      submitLabel: "Consigner",
      success: "Temps consigné",
      onSubmit: (v) => appeler("consigner-temps", { duree: v.duree, jour: v.jour || undefined, restant: v.restant, commentaire: v.commentaire }),
    });

  async function lier() {
    const { types } = await functions.call<{ types: Array<{ nom: string; sortant: string; entrant: string }> }>(
      "lister-types-liens",
      { instance },
    );
    const options = types.flatMap((t) => [
      { value: `${t.nom}|sortant`, label: t.sortant },
      { value: `${t.nom}|entrant`, label: t.entrant },
    ]);
    return openForm({
      title: `Lier ${ticket!.cle} à un autre ticket`,
      fields: [
        { name: "relation", label: "Ce ticket", type: "select", options },
        { name: "autre", label: "Ticket", placeholder: "ALF-12" },
      ],
      submitLabel: "Lier",
      success: "Tickets liés",
      onSubmit: (v) => {
        const [type, sens] = v.relation.split("|");
        return appeler("lier-tickets", { autre: v.autre, type, sens });
      },
    });
  }

  const actions: Action[] = [
    { label: "Changer l’état", icon: ArrowRightLeft, primary: true, hidden: ticket.transitions.length === 0, onClick: changerEtat },
    { label: "Commenter", icon: MessageSquare, onClick: commenter },
    { label: "Consigner du temps", icon: Clock, onClick: consigner },
    { label: "Lier un ticket", icon: Link2, onClick: lier },
    {
      label: ticket.jeSuis ? "Ne plus suivre" : "Suivre le ticket",
      icon: ticket.jeSuis ? EyeOff : Eye,
      success: ticket.jeSuis ? "Vous ne suivez plus ce ticket" : "Vous suivez ce ticket",
      onClick: () => appeler("suivre-ticket", { suivre: !ticket.jeSuis }),
    },
    { label: "Ouvrir dans Jira", icon: ExternalLink, hidden: !ticket.url, onClick: () => shell.openExternal(ticket.url ?? "") },
  ];


  const onglets: Array<{ id: Onglet; label: string }> = [
    { id: "commentaires", label: `Commentaires (${ticket.commentaires.length})` },
    { id: "liens", label: `Liens et sous-tâches (${ticket.liens.length + ticket.sousTaches.length})` },
    { id: "temps", label: "Temps passé" },
    { id: "historique", label: "Historique" },
    { id: "pieces", label: `Pièces jointes (${ticket.pieces.length})` },
  ];

  let activite;
  if (onglet === "commentaires") {
    activite =
      ticket.commentaires.length === 0 ? (
        <EmptyState size="compact" title="Aucun commentaire" />
      ) : (
        <Stack gap="lg">
          {[...ticket.commentaires].reverse().map((commentaire) => (
            <Stack key={commentaire.id} gap="xs">
              <Row justify="between">
                <Row gap="sm">
                  <Avatar name={commentaire.auteur} size="sm" />
                  <Text as="span" weight="strong">
                    {commentaire.auteur}
                  </Text>
                  <Text as="span" size="meta" tone="muted">
                    {dateRelative(commentaire.cree)}
                    {commentaire.modifie ? " · modifié" : ""}
                  </Text>
                </Row>
                <Row gap="xs">
                  <IconButton
                    label="Modifier le commentaire"
                    size="small"
                    onClick={() =>
                      openForm({
                        title: "Modifier le commentaire",
                        fields: [{ name: "texte", label: "Commentaire", type: "textarea" }],
                        initial: { texte: commentaire.corps },
                        submitLabel: "Enregistrer",
                        success: "Commentaire modifié",
                        onSubmit: (v) => appeler("modifier-commentaire", { commentaire: commentaire.id, texte: v.texte }),
                      })
                    }
                  >
                    <Pencil size={14} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label="Supprimer le commentaire"
                    size="small"
                    tone="danger"
                    onClick={async () => {
                      const oui = await confirmAction({
                        title: "Supprimer ce commentaire ?",
                        message: "Cette action est définitive.",
                        confirmLabel: "Supprimer",
                        tone: "danger",
                      });
                      if (oui) await appeler("supprimer-commentaire", { commentaire: commentaire.id });
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </IconButton>
                </Row>
              </Row>
              {commentaire.html ? (
                <HtmlContent html={commentaire.html} label={`Commentaire de ${commentaire.auteur}`} onLink={(url) => void shell.openExternal(url)} />
              ) : (
                <Text>{commentaire.corps}</Text>
              )}
            </Stack>
          ))}
        </Stack>
      );
  } else if (onglet === "liens") {
    activite = (
      <Stack gap="md">
        {ticket.parent && (
          <List label="Ticket parent">
            <ResumeTicket ticket={ticket.parent} relation="Parent" />
          </List>
        )}
        {ticket.sousTaches.length > 0 && (
          <List label="Sous-tâches">
            {ticket.sousTaches.map((t) => (
              <ResumeTicket key={t.cle} ticket={t} relation="Sous-tâche" />
            ))}
          </List>
        )}
        {ticket.liens.length > 0 ? (
          <List label="Tickets liés">
            {ticket.liens.map((lien) => (
              <ListItem
                key={lien.id}
                title={
                  <Row gap="sm">
                    <Code>{lien.cle}</Code>
                    <Text as="span">{lien.titre}</Text>
                  </Row>
                }
                description={lien.relation}
                trailing={
                  <Row gap="xs">
                    <StatusBadge tone={tonCategorie(lien.categorie)} size="compact">
                      {lien.statut}
                    </StatusBadge>
                    <IconButton
                      label={`Retirer le lien avec ${lien.cle}`}
                      size="small"
                      onClick={() => appeler("supprimer-lien", { lien: lien.id })}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </IconButton>
                  </Row>
                }
              />
            ))}
          </List>
        ) : (
          !ticket.parent && ticket.sousTaches.length === 0 && <EmptyState size="compact" title="Aucun lien" />
        )}
      </Stack>
    );
  } else if (onglet === "temps") {
    activite = (
      <Stack gap="md">
        <KeyValueList
          items={[
            { label: "Estimation initiale", value: ticket.temps.estimation || "—" },
            { label: "Temps passé", value: ticket.temps.passe || "—" },
            { label: "Temps restant", value: ticket.temps.restant || "—" },
          ]}
        />
        {ticket.temps.entrees.length > 0 ? (
          <List label="Temps consigné">
            {ticket.temps.entrees.map((entree) => (
              <ListItem
                key={entree.id}
                leading={<Avatar name={entree.auteur} size="sm" />}
                title={`${entree.auteur} · ${entree.duree}`}
                description={entree.commentaire || undefined}
                trailing={<Text as="span" size="meta" tone="muted">{dateRelative(entree.quand)}</Text>}
              />
            ))}
          </List>
        ) : (
          <EmptyState size="compact" title="Aucun temps consigné" />
        )}
      </Stack>
    );
  } else if (onglet === "historique") {
    activite =
      ticket.historique.length === 0 ? (
        <EmptyState size="compact" title="Aucune modification" />
      ) : (
        <List label="Historique du ticket">
          {ticket.historique.map((h) => (
            <ListItem
              key={h.id}
              leading={<Avatar name={h.auteur} size="sm" />}
              title={`${h.auteur} · ${h.changements.map((c) => c.champ).join(", ")}`}
              description={h.changements
                .map((c) => `${c.champ} : ${c.de || "—"} → ${c.vers || "—"}`)
                .join(" ; ")}
              trailing={<Text as="span" size="meta" tone="muted">{dateRelative(h.quand)}</Text>}
            />
          ))}
        </List>
      );
  } else {
    activite =
      ticket.pieces.length === 0 ? (
        <EmptyState size="compact" title="Aucune pièce jointe" />
      ) : (
        <List label="Pièces jointes">
          {ticket.pieces.map((piece) => (
            <ListItem
              key={piece.id}
              title={piece.nom}
              description={[tailleLisible(piece.taille), piece.auteur, dateRelative(piece.cree)].filter(Boolean).join(" · ")}
              onClick={piece.url ? () => void shell.openExternal(piece.url ?? "") : undefined}
            />
          ))}
        </List>
      );
  }

  const critique = jugement.data?.resultats[0];
  const contexte: ContexteTicket = {
    cle: ticket.cle,
    titre: ticket.titre,
    type: ticket.type,
    statut: ticket.statut,
    priorite: ticket.priorite,
    assigne: ticket.assigne,
    description: ticket.description,
    commentaires: ticket.commentaires.map((c) => ({ auteur: c.auteur, corps: c.corps })),
    champs: ticket.champs.filter((c) => c.affichage).map((c) => ({ nom: c.nom, affichage: c.affichage })),
  };

  async function proposerDecoupage() {
    const { sousTaches } = await proposerSousTaches(contexte);
    return openForm({
      title: `Sous-tâches proposées pour ${ticket!.cle}`,
      description: "Une sous-tâche par ligne. Modifiez, supprimez ou ajoutez des lignes avant de créer.",
      fields: [
        {
          name: "lignes",
          label: "Sous-tâches",
          type: "textarea",
        },
      ],
      initial: { lignes: sousTaches.map((t) => t.titre).join("\n") },
      submitLabel: "Créer les sous-tâches",
      success: "Sous-tâches créées",
      onSubmit: async (v) => {
        const titres = v.lignes.split("\n").map((l) => l.trim()).filter(Boolean);
        for (const titre of titres) {
          const detail = sousTaches.find((t) => t.titre === titre)?.description;
          await functions.call("creer-ticket", {
            instance,
            projet: ticket!.projet,
            resume: titre,
            description: detail,
            parent: ticket!.cle,
          });
        }
        recharger();
      },
    });
  }

  async function suggerer() {
    const champPriorite = ticket!.champs.find((c) => c.id === "priority");
    const personnes = await functions
      .call<{ utilisateurs: Array<{ id: string; nom: string }> }>("lister-assignables", { instance, projet: ticket!.projet })
      .then((r) => r.utilisateurs)
      .catch(() => []);
    const priorites = (champPriorite?.options ?? []).map((o) => o.nom);
    const avis = await suggererTriage(contexte, priorites, personnes);
    const option = champPriorite?.options.find((o) => o.nom === avis.priorite);
    const personne = personnes.find((p) => p.id === avis.assigne);
    return openModal({
      title: "Proposition de triage",
      content: (
        <Stack gap="md">
          <KeyValueList
            items={[
              { label: "Priorité", value: avis.priorite || "—" },
              { label: "Assigné", value: personne?.nom ?? "Aucune proposition" },
            ]}
          />
          <Text>{avis.justification}</Text>
        </Stack>
      ),
      actions: [
        {
          label: "Appliquer",
          primary: true,
          success: "Proposition appliquée",
          onClick: async () => {
            if (option) await appeler("modifier-champ", { champ: "priority", valeur: option.id });
            if (personne) await appeler("modifier-champ", { champ: "assignee", valeur: personne.id });
          },
        },
      ],
    });
  }

  const confierAgent = () =>
    openForm({
      title: "Confier ce ticket à l’assistant",
      description:
        "Décrivez ce que vous voulez : je lis le ticket, ses pull requests et les pages liées, et je vous demande votre accord avant chaque changement.",
      fields: [
        {
          name: "demande",
          label: "Votre demande",
          type: "textarea",
          placeholder: "Fais le point sur ce ticket, retrouve la PR associée et passe-le en revue si elle est ouverte.",
        },
      ],
      submitLabel: "Lancer",
      onSubmit: async (v) => {
        await ai.startAgent({
          title: `${ticket!.cle} · ${ticket!.titre}`,
          instruction: `Tu aides l’utilisateur sur le ticket Jira ${ticket!.cle} (compte « ${instance ?? ""} »). Sa demande : ${v.demande}\nPasse toujours instance = « ${instance ?? ""} » aux fonctions Jira. Réponds en français.`,
          context: contexte,
          functions: [
            "lire-ticket",
            "modifier-champ",
            "commenter-ticket",
            "transitionner-ticket",
            "lier-tickets",
            "consigner-temps",
            "lister-assignables",
            "creer-ticket",
            "lister-tickets",
            "evaluer-criticite",
            "lister-prs",
            "lire-pr",
            "rechercher-pages",
            "lire-page",
          ],
        });
        recharger();
      },
    });

  const actionsAssistant: Action[] = [
    {
      label: "Résumer le ticket",
      icon: FileText,
      onClick: async () => setAnalyse(await resumerTicket(contexte)),
    },
    {
      label: "Rédiger un commentaire",
      icon: PenLine,
      onClick: async () => {
        const { commentaire } = await redigerCommentaire(contexte, "");
        return openForm({
          title: "Commentaire proposé",
          description: "Relisez et ajustez avant de publier.",
          fields: [{ name: "texte", label: "Commentaire", type: "textarea" }],
          initial: { texte: commentaire },
          submitLabel: "Publier",
          success: "Commentaire publié",
          onSubmit: (val) => appeler("commenter-ticket", { texte: val.texte }),
        });
      },
    },
    { label: "Proposer des sous-tâches", onClick: proposerDecoupage },
    { label: "Suggérer priorité et assigné", onClick: suggerer },
    { label: "Confier à l’assistant", icon: Bot, primary: true, onClick: confierAgent },
  ];

  return (
    <Stack gap="lg">
      <Section
        title="En bref"
        description={[ticket.type, ticket.projetNom || ticket.projet, `créé ${dateRelative(ticket.cree)}`, `mis à jour ${dateRelative(ticket.misAJour)}`].filter(Boolean).join(" · ")}
        actions={actions}
      >
        <Row gap="sm" wrap>
          <StatusBadge tone={tonCategorie(ticket.statutCategorie)}>{ticket.statut}</StatusBadge>
          {ticket.priorite && <StatusBadge tone={tonPriorite(ticket.priorite)}>{`Priorité ${ticket.priorite}`}</StatusBadge>}
          <Text as="span" size="meta" tone="muted">
            {`${ticket.observateurs} observateur${ticket.observateurs > 1 ? "s" : ""} · ${ticket.votes} vote${ticket.votes > 1 ? "s" : ""}`}
          </Text>
        </Row>
      </Section>

      <Section
        title="Assistant"
        description="Je lis le ticket et son fil pour vous aider ; rien n’est publié sans votre accord."
        actions={actionsAssistant}
      >
        <Stack gap="sm">
          <Row gap="sm" wrap>
            {critique ? (
              <StatusBadge tone={NIVEAUX[critique.niveau]?.tone ?? "neutral"}>
                {`Criticité : ${NIVEAUX[critique.niveau]?.label ?? critique.niveau}${critique.aVerifier ? " (à vérifier)" : ""}`}
              </StatusBadge>
            ) : (
              <Text as="span" size="meta" tone="muted">
                {jugement.error ? jugement.error.message : "Criticité en cours d’évaluation…"}
              </Text>
            )}
            {critique?.urgent && <StatusBadge tone="warning">À traiter aujourd’hui</StatusBadge>}
            {critique?.bloquant && <StatusBadge tone="danger">Utilisateurs bloqués</StatusBadge>}
            {critique?.frustration && <StatusBadge tone="warning">Demandeur agacé</StatusBadge>}
          </Row>
          {analyse && (
            <Markdown>
              {[analyse.resume, "", ...analyse.pointsCles.map((p) => `- ${p}`), "", `**Prochaine étape :** ${analyse.prochaineEtape}`].join("\n")}
            </Markdown>
          )}
        </Stack>
      </Section>

      <Section title="Résumé">
        <InlineEdit<string>
          label="Résumé"
          value={ticket.titre}
          onSave={(valeur) => appeler("modifier-champ", { champ: "summary", valeur })}
          renderEditor={(editeur) => (
            <TextInput
              aria-label={editeur.label}
              value={editeur.value}
              autoFocus
              onChange={(e) => editeur.setValue(e.target.value)}
              onBlur={() => editeur.commit()}
            />
          )}
        >
          <Text weight="strong">{ticket.titre}</Text>
        </InlineEdit>
      </Section>

      <Section title="Description" description="Cliquez dans le texte pour le modifier ; Ctrl+Entrée enregistre.">
        <InlineEdit<string>
          label="Description"
          mode="multiline"
          value={ticket.description}
          onSave={(valeur) => appeler("modifier-champ", { champ: "description", valeur })}
          renderEditor={(editeur) => (
            <TextArea
              aria-label={editeur.label}
              value={editeur.value}
              rows={10}
              autoFocus
              onChange={(e) => editeur.setValue(e.target.value)}
              onBlur={() => editeur.commit()}
            />
          )}
        >
          {ticket.descriptionHtml ? (
            <HtmlContent html={ticket.descriptionHtml} label="Description du ticket" onLink={(url) => void shell.openExternal(url)} />
          ) : ticket.description ? (
            <Text>{ticket.description}</Text>
          ) : (
            <Text tone="muted">Aucune description : cliquez pour en écrire une.</Text>
          )}
        </InlineEdit>
      </Section>

      <Section title="Activité">
        <Stack gap="md">
          <Tabs<Onglet> label="Activité du ticket" items={onglets} activeId={onglet} onChange={setOnglet} />
          {activite}
        </Stack>
      </Section>
    </Stack>
  );
}
