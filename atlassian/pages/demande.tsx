import { ArrowRightLeft, ExternalLink, Send, StickyNote } from "lucide-react";
import { functions, shell } from "@alfred/sdk";
import {
  DetailPanel,
  Divider,
  KeyValueList,
  List,
  ListItem,
  Row,
  Stack,
  StatusBadge,
  Text,
  openForm,
} from "@alfred/ui";
import { ETATS_DEMANDE, dateHeure, etatDelai, type Demande } from "../lib/support";

function separer(identifiant: string): { instance: string; cle: string } {
  const texte = String(identifiant ?? "");
  const separateur = texte.indexOf("|");
  if (separateur < 0) return { instance: "", cle: texte };
  return { instance: texte.slice(0, separateur), cle: texte.slice(separateur + 1) };
}

async function charger(id: string | number) {
  const { instance, cle } = separer(String(id));
  if (!cle) return null;
  const { demande } = await functions.call<{ demande: Demande | null }>("lire-demande", {
    instance: instance || undefined,
    cle,
  });
  return demande;
}

function ecrire(demande: Demande, interne: boolean) {
  return openForm({
    title: interne ? "Ajouter une note interne" : "Répondre au client",
    description: interne
      ? "La note reste réservée à l’équipe : le client ne la voit pas."
      : `${demande.client} recevra cette réponse sur le portail et par e-mail.`,
    fields: [
      {
        name: "texte",
        label: interne ? "Note" : "Réponse",
        type: "textarea",
        placeholder: interne ? "Piste à vérifier avec l’équipe infra" : "Bonjour, je reviens vers vous au sujet de votre demande…",
      },
    ],
    submitLabel: interne ? "Ajouter" : "Envoyer",
    success: interne ? "Note interne ajoutée" : "Réponse envoyée au client",
    onSubmit: (valeurs) =>
      functions.call("repondre-demande", {
        instance: demande.instance ?? undefined,
        cle: demande.cle,
        texte: valeurs.texte,
        interne,
      }),
  });
}

async function changerEtat(demande: Demande) {
  const instance = demande.instance ?? undefined;
  const { transitions } = await functions.call<{ transitions: { id: string; nom: string; vers: string }[] }>(
    "transitionner-ticket",
    { instance, cle: demande.cle },
  );
  if (transitions.length === 0) throw new Error("Aucun changement d’état n’est possible pour cette demande.");
  return openForm({
    title: "Changer l’état",
    description: `La demande est actuellement « ${demande.statut} ».`,
    fields: [
      {
        name: "transition",
        label: "Nouvel état",
        type: "select",
        options: transitions.map((t) => ({ value: t.id, label: t.vers && t.vers !== t.nom ? `${t.nom} → ${t.vers}` : t.nom })),
      },
    ],
    submitLabel: "Appliquer",
    success: "État de la demande changé",
    onSubmit: (valeurs) => functions.call("transitionner-ticket", { instance, cle: demande.cle, transition: valeurs.transition }),
  });
}

async function mAssigner(demande: Demande) {
  const instance = demande.instance ?? undefined;
  const { moi } = await functions.call<{ moi: { id: string; nom: string } | null }>("lister-referentiels", { instance });
  if (!moi) throw new Error("Votre compte Jira n’a pas pu être identifié.");
  return functions.call("modifier-ticket", { instance, cle: demande.cle, assigne: moi.id });
}

function Echanges({ demande }: { demande: Demande }) {
  return (
    <Stack gap="md">
      {demande.commentaires.map((echange, rang) => (
        <Stack key={echange.id} gap="xs">
          {rang > 0 && <Divider />}
          <Row gap="sm" align="center" wrap>
            <Text as="span" weight="strong">
              {echange.auteur}
            </Text>
            <Text as="span" size="meta" tone="muted">
              {dateHeure(echange.date)}
            </Text>
            {!echange.public && (
              <StatusBadge tone="warning" size="compact">
                Note interne
              </StatusBadge>
            )}
          </Row>
          <Text>{echange.texte}</Text>
        </Stack>
      ))}
    </Stack>
  );
}

/** Panneau de la demande ouverte : client, délais, échanges, réponse et note interne. */
export default function DemandePanneau() {
  return (
    <DetailPanel<Demande>
      load={charger}
      emptyTitle="Aucune demande sélectionnée"
      notFoundTitle="Demande introuvable"
      title={(demande) => demande.titre}
      subtitle={(demande) => [demande.cle, demande.typeDemande].filter(Boolean).join(" · ")}
      status={{ value: (demande) => demande.statutCategorie, statuses: ETATS_DEMANDE }}
      actions={(demande) => [
        { label: "Répondre au client", icon: Send, onClick: () => ecrire(demande, false) },
        { label: "Ajouter une note interne", icon: StickyNote, onClick: () => ecrire(demande, true) },
        { label: "Changer l’état", icon: ArrowRightLeft, onClick: () => changerEtat(demande) },
        {
          label: "M’assigner la demande",
          success: "Demande assignée à vous",
          onClick: () => mAssigner(demande),
        },
        {
          label: "Ouvrir dans Jira",
          icon: ExternalLink,
          hidden: !demande.url,
          onClick: () => shell.openExternal(demande.url ?? ""),
        },
        {
          label: "Ouvrir sur le portail client",
          hidden: !demande.urlPortail,
          onClick: () => shell.openExternal(demande.urlPortail ?? ""),
        },
      ]}
      fields={(demande) => [
        { label: "Client", value: demande.clientEmail ? `${demande.client} (${demande.clientEmail})` : demande.client },
        { label: "État", value: demande.statut },
        { label: "Assigné", value: demande.assigne },
        { label: "Priorité", value: demande.priorite, hideEmpty: true },
        { label: "Créée", value: demande.creee, type: "datetime" },
        { label: "Participants", value: demande.participants.join(", "), hideEmpty: true },
      ]}
      sections={(demande) => [
        {
          title: "Délais",
          empty: "Aucun délai suivi pour cette demande",
          content:
            demande.sla.length > 0 ? (
              <List>
                {demande.sla.map((delai) => {
                  const { ton, libelle } = etatDelai(delai);
                  return (
                    <ListItem
                      key={delai.nom}
                      title={delai.nom}
                      description={delai.objectif ? `Objectif : ${delai.objectif}` : undefined}
                      trailing={
                        <StatusBadge tone={ton} size="compact">
                          {libelle}
                        </StatusBadge>
                      }
                    />
                  );
                })}
              </List>
            ) : null,
        },
        { title: "Description", content: demande.description || null, empty: "Aucune description" },
        {
          title: "Informations saisies",
          empty: "Aucune autre information",
          content:
            demande.champs.length > 0 ? (
              <KeyValueList items={demande.champs.map((champ, rang) => ({ id: rang, label: champ.libelle, value: champ.valeur }))} />
            ) : null,
        },
        {
          title: "Échanges",
          empty: "Aucun échange pour l’instant",
          content: demande.commentaires.length > 0 ? <Echanges demande={demande} /> : null,
          actions: [{ label: "Répondre au client", icon: Send, onClick: () => ecrire(demande, false) }],
        },
      ]}
    />
  );
}
