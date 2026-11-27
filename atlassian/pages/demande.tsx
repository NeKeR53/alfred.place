import { announceChange, functions, notifyActionError, shell, usePageContext } from "@alfred/sdk";
import { ArrowRightLeft, ExternalLink, Send, StickyNote, UserCheck } from "lucide-react";
import { Drawer, List, type OpenFormFunction, useOpenForm } from "socle-ui";
import { useEtat } from "../lib/etat";
import { ETATS_DEMANDE, dateHeure, etatDelai, type Demande, useDemande } from "../lib/support";

function ecrire(openForm: OpenFormFunction, demande: Demande, interne: boolean) {
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
        isRequired: true,
        placeholder: interne ? "Piste à vérifier avec l’équipe infra" : "Bonjour, je reviens vers vous au sujet de votre demande…",
      },
    ],
    submitLabel: interne ? "Ajouter" : "Envoyer",
    onSubmit: async (valeurs) => {
      await functions.call("repondre-demande", {
        instance: demande.instance ?? undefined,
        cle: demande.cle,
        texte: valeurs.texte,
        interne,
      });
      shell.notify({ title: interne ? "Note interne ajoutée" : "Réponse envoyée au client", tone: "success" });
      void announceChange();
    },
  });
}

async function changerEtat(openForm: OpenFormFunction, demande: Demande) {
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
        isRequired: true,
        options: transitions.map((t) => ({ id: t.id, label: t.vers && t.vers !== t.nom ? `${t.nom} → ${t.vers}` : t.nom })),
      },
    ],
    submitLabel: "Appliquer",
    onSubmit: async (valeurs) => {
      await functions.call("transitionner-ticket", { instance, cle: demande.cle, transition: valeurs.transition });
      shell.notify({ title: "État de la demande changé", tone: "success" });
      void announceChange();
    },
  });
}

async function mAssigner(demande: Demande, moi: { id: string; nom: string } | null | undefined) {
  if (moi === undefined) throw new Error("Votre compte Jira est encore en lecture : réessayez dans un instant.");
  if (!moi) throw new Error("Votre compte Jira n’a pas pu être identifié.");
  return functions.call("modifier-ticket", { instance: demande.instance ?? undefined, cle: demande.cle, assigne: moi.id });
}

/** Panneau de la demande ouverte : client, délais, échanges, réponse et note interne. */
export default function DemandePanneau() {
  const id = usePageContext()?.view?.id ?? "";
  const openForm = useOpenForm();
  const lecture = useDemande(id);
  const demande = lecture.data;
  // Votre compte Jira (pour « M’assigner la demande »), lu dans les référentiels du compte de la demande.
  const referentiels = useEtat<{ moi: { id: string; nom: string } | null }>(
    "referentiels-jira",
    demande ? { instance: demande.instance ?? undefined } : null,
  );
  return (
    <Drawer
      header={
        demande
          ? {
              title: demande.titre,
              subtitle: [demande.cle, demande.typeDemande].filter(Boolean).join(" · "),
              status: ETATS_DEMANDE[demande.statutCategorie],
              actions: [
                { id: "repondre", label: "Répondre au client", icon: <Send size={16} />, onPress: () => ecrire(openForm, demande, false) },
                {
                  id: "note",
                  label: "Ajouter une note interne",
                  icon: <StickyNote size={16} />,
                  onPress: () => ecrire(openForm, demande, true),
                },
                {
                  id: "etat",
                  label: "Changer l’état",
                  icon: <ArrowRightLeft size={16} />,
                  onPress: () => changerEtat(openForm, demande),
                },
                {
                  id: "assigner",
                  label: "M’assigner la demande",
                  icon: <UserCheck size={16} />,
                  onPress: async () => {
                    if (referentiels.error) throw referentiels.error;
                    await mAssigner(demande, referentiels.data ? referentiels.data.moi : undefined);
                    lecture.reload();
                    shell.notify({ title: "Demande assignée à vous", tone: "success" });
                  },
                },
                {
                  id: "jira",
                  label: "Ouvrir dans Jira",
                  icon: <ExternalLink size={16} />,
                  isHidden: !demande.url,
                  onPress: () => shell.openExternal(demande.url ?? ""),
                },
                {
                  id: "portail",
                  label: "Ouvrir sur le portail client",
                  isHidden: !demande.urlPortail,
                  onPress: () => shell.openExternal(demande.urlPortail ?? ""),
                },
              ],
            }
          : undefined
      }
      sections={
        demande
          ? [
              {
                id: "fiche",
                title: "Demande",
                fields: [
                  { label: "Client", value: demande.clientEmail ? `${demande.client} (${demande.clientEmail})` : demande.client },
                  { label: "État", value: demande.statut },
                  { label: "Assigné", value: demande.assigne },
                  { label: "Priorité", value: demande.priorite, hideEmpty: true },
                  { label: "Créée", value: demande.creee, type: "datetime" },
                  { label: "Participants", value: demande.participants, type: "tags", hideEmpty: true },
                ],
              },
              {
                id: "delais",
                title: "Délais",
                empty: "Aucun délai suivi pour cette demande",
                content:
                  demande.sla.length > 0 ? (
                    <List
                      label="Délais de la demande"
                      selectionMode="none"
                      items={demande.sla.map((delai) => {
                        const { ton, libelle } = etatDelai(delai);
                        return {
                          id: delai.nom,
                          title: delai.nom,
                          subtitle: delai.objectif ? `Objectif : ${delai.objectif}` : undefined,
                          status: { label: libelle, tone: ton },
                        };
                      })}
                    />
                  ) : undefined,
              },
              {
                id: "informations",
                title: "Informations saisies",
                empty: "Aucune autre information",
                fields: demande.champs.map((champ, rang) => ({ id: String(rang), label: champ.libelle, value: champ.valeur })),
              },
              {
                id: "echanges",
                title: "Échanges",
                empty: "Aucun échange pour l’instant",
                actions: [
                  { id: "repondre", label: "Répondre au client", icon: <Send size={16} />, onPress: () => ecrire(openForm, demande, false) },
                ],
                content:
                  demande.commentaires.length > 0 ? (
                    <List
                      label="Échanges de la demande"
                      selectionMode="none"
                      items={demande.commentaires.map((echange) => ({
                        id: echange.id,
                        title: echange.auteur,
                        subtitle: echange.texte,
                        meta: dateHeure(echange.date),
                        status: echange.public ? undefined : { label: "Note interne", tone: "warning" as const },
                      }))}
                    />
                  ) : undefined,
              },
            ]
          : undefined
      }
      isLoading={lecture.loading}
      hasError={Boolean(lecture.error)}
      onRetry={lecture.reload}
      isNotFound={Boolean(id) && !lecture.loading && !lecture.error && !demande}
      emptyMessage="Ouvrez une demande pour la voir ici."
      onActionError={notifyActionError}
      onActionDone={() => {
        lecture.reload();
        void announceChange();
      }}
    />
  );
}
