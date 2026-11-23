import { announceChange, db, functions, loadPdf, notifyActionError, shell, useAsync, useSelection } from "@alfred/sdk";
import { ExternalLink, FileText, FolderInput, Forward, Mail, MailOpen, PenLine, Reply, ReplyAll, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button, DetailPanel, Dialog, DocumentViewer, HtmlContent, List, type StatusMap, useOpenForm } from "socle-ui";
import { Markdown } from "socle-ui/markdown";
import { redigerReponse, resumerMessage } from "../lib/assistant";

interface Piece {
  id: string;
  nom: string;
  type: string;
  taille: number;
  inline: boolean;
  contentId: string;
}

interface MessageDetail {
  id: string;
  objet: string;
  expediteur: string;
  expediteurAdresse: string;
  destinataires: string[];
  copies: string[];
  recu: string | null;
  lu: boolean;
  brouillon: boolean;
  important: boolean;
  extrait: string;
  corps: string;
  url: string | null;
  pieces: Piece[];
}

interface Dossier {
  id: string;
  nom: string;
  profondeur: number;
}

const ETATS: StatusMap = {
  non_lu: { label: "Non lu", tone: "warning" },
  lu: { label: "Lu", tone: "neutral" },
};

function taille(octets: number): string {
  if (!octets) return "";
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} ko`;
  return `${(octets / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

/** Une modale ouverte depuis le panneau : l’aperçu d’une pièce, ou le résumé du message. */
interface Fenetre {
  titre: string;
  contenu: ReactNode;
}

export default function MessagePanel() {
  const id = useSelection<string>();
  const openForm = useOpenForm();
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const dossiers = useAsync(
    () => functions.call<{ boite: string; dossiers: Dossier[] }>("lister-dossiers", {}),
    [],
  );
  const listeDossiers = dossiers.data?.dossiers ?? [];
  const reglages = useAsync(
    () => db.query<{ valeur: string }>("SELECT valeur FROM outlook_reglages WHERE cle = 'signature'"),
    [],
  );
  const signature = reglages.data?.[0]?.valeur ?? "";
  const lecture = useAsync(
    async () => (id ? (await functions.call<{ message: MessageDetail | null }>("lire-message", { id })).message : null),
    [id],
  );
  const message = lecture.data;

  /** Après une écriture : la boîte de réception se relit, et le message aussi. */
  const prevenir = async (title?: string) => {
    if (title) shell.notify({ title, tone: "success" });
    void announceChange();
  };

  function repondre(cible: MessageDetail, mode: "repondre" | "tous") {
    return openForm({
      title: mode === "tous" ? "Répondre à tous" : "Répondre",
      description: `À ${cible.expediteur}`,
      fields: [{ name: "texte", label: "Votre réponse", type: "textarea", isRequired: true, placeholder: "Bonjour," }],
      submitLabel: "Envoyer",
      onSubmit: async (valeurs) => {
        await functions.call("repondre-message", { id: cible.id, mode, texte: valeurs.texte, signature });
        await prevenir("Réponse envoyée");
      },
    });
  }

  function transferer(cible: MessageDetail) {
    return openForm({
      title: "Transférer le message",
      fields: [
        {
          name: "destinataires",
          label: "À",
          isRequired: true,
          placeholder: "prenom@exemple.fr",
          description: "Séparez plusieurs adresses par des virgules.",
        },
        { name: "texte", label: "Mot d’accompagnement", type: "textarea" },
      ],
      submitLabel: "Transférer",
      onSubmit: async (valeurs) => {
        await functions.call("transferer-message", {
          id: cible.id,
          destinataires: valeurs.destinataires,
          texte: valeurs.texte,
          signature,
        });
        await prevenir("Message transféré");
      },
    });
  }

  function deplacer(cible: MessageDetail) {
    return openForm({
      title: "Déplacer le message",
      fields: [
        {
          name: "dossier",
          label: "Dossier",
          type: "select",
          isRequired: true,
          options: listeDossiers.map((element) => ({
            id: element.id,
            label: `${"— ".repeat(element.profondeur)}${element.nom}`,
          })),
        },
      ],
      submitLabel: "Déplacer",
      onSubmit: async (valeurs) => {
        await functions.call("deplacer-message", { id: cible.id, dossier: valeurs.dossier });
        await prevenir("Message déplacé");
      },
    });
  }

  async function apercu(cible: MessageDetail, piece: Piece) {
    const reponse = await functions.call<{ piece: { dataUrl: string | null } | null }>("lire-piece-jointe", {
      message: cible.id,
      piece: piece.id,
    });
    const source = reponse.piece?.dataUrl;
    if (!source) {
      shell.notify({ title: "Aperçu indisponible", description: "Cette pièce ne peut pas être affichée ici.", tone: "info" });
      return;
    }
    setFenetre({
      titre: piece.nom,
      contenu: <DocumentViewer label={piece.nom} src={source} name={piece.nom} type={piece.type} loadPdf={loadPdf} />,
    });
  }

  const resoudreImage = (cible: MessageDetail) => async (source: string) => {
    if (!source.startsWith("cid:")) return null;
    const cid = source.slice(4);
    const piece = cible.pieces.find(
      (element) => element.contentId === cid || element.contentId === `<${cid}>` || element.contentId === source,
    );
    if (!piece) return null;
    const reponse = await functions.call<{ piece: { dataUrl: string | null } | null }>("lire-piece-jointe", {
      message: cible.id,
      piece: piece.id,
    });
    return reponse.piece?.dataUrl ?? null;
  };

  const modale = fenetre ? (
    <Dialog
      isOpen
      size="xl"
      title={fenetre.titre}
      onOpenChange={(ouverte) => {
        if (!ouverte) setFenetre(null);
      }}
      footer={<Button onPress={() => setFenetre(null)}>Fermer</Button>}
    >
      {fenetre.contenu}
    </Dialog>
  ) : null;

  return (
    <DetailPanel
      header={
        message
          ? {
              title: message.objet || "(sans objet)",
              subtitle: [message.expediteur, message.expediteurAdresse].filter(Boolean).join(" · "),
              status: ETATS[message.lu ? "lu" : "non_lu"],
              actions: [
                {
                  id: "rediger",
                  label: "Rédiger une réponse avec l’assistant",
                  icon: <PenLine size={16} />,
                  onPress: async () => {
                    let propose = "";
                    const rempli = await openForm({
                      title: "Rédiger une réponse",
                      description:
                        "Dites en quelques mots ce que vous voulez répondre, ou laissez vide : je propose un texte que vous relirez.",
                      fields: [
                        {
                          name: "intention",
                          label: "Ce que vous voulez dire",
                          type: "textarea",
                          placeholder: "D’accord pour jeudi, mais pas avant 14 h.",
                        },
                      ],
                      submitLabel: "Rédiger",
                      onSubmit: async (v) => {
                        propose = (await redigerReponse(message, String(v.intention ?? ""))).reponse;
                      },
                    });
                    if (!rempli) return;
                    await openForm({
                      title: `Réponse à ${message.expediteur}`,
                      description: "Relisez et ajustez avant d’envoyer.",
                      fields: [{ name: "texte", label: "Votre réponse", type: "textarea", isRequired: true }],
                      initialValues: { texte: propose },
                      submitLabel: "Envoyer",
                      onSubmit: async (val) => {
                        await functions.call("repondre-message", {
                          id: message.id,
                          mode: "repondre",
                          texte: val.texte,
                          signature,
                        });
                        await prevenir("Réponse envoyée");
                      },
                    });
                  },
                },
                {
                  id: "resumer",
                  label: "Résumer le message",
                  icon: <FileText size={16} />,
                  onPress: async () => {
                    const { resume, actions } = await resumerMessage(message);
                    setFenetre({
                      titre: `Résumé : ${message.objet}`,
                      contenu: (
                        <Markdown>
                          {[
                            resume,
                            ...(actions.length > 0
                              ? ["", "**Ce qui est attendu de vous**", ...actions.map((a) => `- ${a}`)]
                              : []),
                          ].join("\n")}
                        </Markdown>
                      ),
                    });
                  },
                },
                { id: "repondre", label: "Répondre", icon: <Reply size={16} />, onPress: () => repondre(message, "repondre") },
                {
                  id: "repondre-tous",
                  label: "Répondre à tous",
                  icon: <ReplyAll size={16} />,
                  onPress: () => repondre(message, "tous"),
                },
                { id: "transferer", label: "Transférer", icon: <Forward size={16} />, onPress: () => transferer(message) },
                {
                  id: "lu",
                  label: message.lu ? "Marquer comme non lu" : "Marquer comme lu",
                  icon: message.lu ? <Mail size={16} /> : <MailOpen size={16} />,
                  onPress: async () => {
                    await functions.call("marquer-message", { id: message.id, lu: !message.lu });
                    await prevenir();
                  },
                },
                {
                  id: "deplacer",
                  label: "Déplacer",
                  icon: <FolderInput size={16} />,
                  isDisabled: listeDossiers.length === 0,
                  onPress: () => deplacer(message),
                },
                {
                  id: "outlook",
                  label: "Ouvrir dans Outlook",
                  icon: <ExternalLink size={16} />,
                  isHidden: !message.url,
                  onPress: () => shell.openExternal(message.url ?? ""),
                },
                {
                  id: "supprimer",
                  label: "Supprimer",
                  icon: <Trash2 size={16} />,
                  danger: true,
                  confirm: {
                    title: `Supprimer « ${message.objet} » ?`,
                    message: "Le message ira dans la corbeille.",
                    confirmLabel: "Supprimer",
                  },
                  onPress: async () => {
                    await functions.call("supprimer-message", { id: message.id });
                    await prevenir("Message supprimé");
                  },
                },
              ],
            }
          : undefined
      }
      sections={
        message
          ? [
              {
                id: "fiche",
                title: "Fiche",
                fields: [
                  { label: "De", value: message.expediteur },
                  { label: "Adresse", value: message.expediteurAdresse, type: "email" },
                  { label: "À", value: message.destinataires.join(", ") },
                  { label: "Copie", value: message.copies.join(", "), hideEmpty: true },
                  { label: "Reçu", value: message.recu, type: "datetime" },
                ],
              },
              {
                id: "message",
                title: "Message",
                content: (
                  <>
                    <HtmlContent
                      html={message.corps}
                      label={`Message de ${message.expediteur}`}
                      onLink={(url) => void shell.openExternal(url)}
                      resolveImage={resoudreImage(message)}
                    />
                    {modale}
                  </>
                ),
              },
              ...(message.pieces.length > 0
                ? [
                    {
                      id: "pieces",
                      title: "Pièces jointes",
                      content: (
                        <List
                          label="Pièces jointes du message"
                          selectionMode="none"
                          items={message.pieces.map((piece) => ({
                            id: piece.id,
                            title: piece.nom,
                            subtitle: [taille(piece.taille), piece.type, piece.type.startsWith("image/") ? "aperçu" : ""]
                              .filter(Boolean)
                              .join(" · "),
                          }))}
                          onAction={(cle) => {
                            const piece = message.pieces.find((element) => element.id === cle);
                            if (piece?.type.startsWith("image/")) void apercu(message, piece);
                          }}
                        />
                      ),
                    },
                  ]
                : []),
            ]
          : undefined
      }
      isLoading={lecture.loading}
      hasError={Boolean(lecture.error)}
      onRetry={lecture.reload}
      isNotFound={Boolean(id) && !lecture.loading && !lecture.error && message === null}
      emptyMessage="Sélectionnez un message pour le lire ici."
      onActionError={notifyActionError}
      onActionDone={() => lecture.reload()}
    />
  );
}
