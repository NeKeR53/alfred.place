import { ExternalLink, FileText, Forward, FolderInput, Mail, MailOpen, PenLine, Reply, ReplyAll, Trash2 } from "lucide-react";
import { functions, db, shell, useAsync } from "@alfred/sdk";
import {
  DetailPanel,
  HtmlContent,
  Image,
  List,
  ListItem,
  Markdown,
  openForm,
  openModal,
  type StatusMap,
} from "@alfred/ui";
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

export default function MessagePanel() {
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

  async function charger(id: string): Promise<MessageDetail | null> {
    const reponse = await functions.call<{ message: MessageDetail | null }>("lire-message", { id });
    return reponse.message;
  }

  function repondre(message: MessageDetail, mode: "repondre" | "tous") {
    return openForm({
      title: mode === "tous" ? "Répondre à tous" : "Répondre",
      description: `À ${message.expediteur}`,
      fields: [{ name: "texte", label: "Votre réponse", type: "textarea", placeholder: "Bonjour," }],
      submitLabel: "Envoyer",
      success: "Réponse envoyée",
      onSubmit: async (valeurs) => {
        await functions.call("repondre-message", {
          id: message.id,
          mode,
          texte: valeurs.texte,
          signature,
        });
        await shell.send({ type: "refresh" });
      },
    });
  }

  function transferer(message: MessageDetail) {
    return openForm({
      title: "Transférer le message",
      fields: [
        {
          name: "destinataires",
          label: "À",
          placeholder: "prenom@exemple.fr",
          hint: "Séparez plusieurs adresses par des virgules.",
        },
        { name: "texte", label: "Mot d’accompagnement", type: "textarea", optional: true },
      ],
      submitLabel: "Transférer",
      success: "Message transféré",
      onSubmit: async (valeurs) => {
        await functions.call("transferer-message", {
          id: message.id,
          destinataires: valeurs.destinataires,
          texte: valeurs.texte,
          signature,
        });
        await shell.send({ type: "refresh" });
      },
    });
  }

  function deplacer(message: MessageDetail) {
    return openForm({
      title: "Déplacer le message",
      fields: [
        {
          name: "dossier",
          label: "Dossier",
          type: "select",
          options: listeDossiers.map((element) => ({
            value: element.id,
            label: `${"— ".repeat(element.profondeur)}${element.nom}`,
          })),
        },
      ],
      submitLabel: "Déplacer",
      success: "Message déplacé",
      onSubmit: async (valeurs) => {
        await functions.call("deplacer-message", { id: message.id, dossier: valeurs.dossier });
        await shell.send({ type: "refresh" });
      },
    });
  }

  async function apercu(message: MessageDetail, piece: Piece) {
    const reponse = await functions.call<{ piece: { dataUrl: string | null } | null }>("lire-piece-jointe", {
      message: message.id,
      piece: piece.id,
    });
    if (!reponse.piece?.dataUrl) {
      await shell.notify({
        title: "Aperçu indisponible",
        description: "Cette pièce ne peut pas être affichée ici.",
        tone: "info",
      });
      return;
    }
    await openModal({
      title: piece.nom,
      size: "wide",
      content: <Image src={reponse.piece.dataUrl} alt={piece.nom} size="full" />,
    });
  }

  return (
    <DetailPanel<MessageDetail>
      emptyTitle="Aucun message sélectionné"
      notFoundTitle="Message introuvable"
      load={charger}
      title={(message) => message.objet}
      subtitle={(message) =>
        [message.expediteur, message.expediteurAdresse].filter(Boolean).join(" · ")
      }
      status={{ value: (message) => (message.lu ? "lu" : "non_lu"), statuses: ETATS }}
      fields={(message) => [
        { label: "De", value: message.expediteur },
        { label: "Adresse", value: message.expediteurAdresse },
        { label: "À", value: message.destinataires.join(", ") },
        { label: "Copie", value: message.copies.join(", "), hideEmpty: true },
        { label: "Reçu", value: message.recu ?? "", type: "datetime" },
      ]}
      sections={(message) => [
        {
          title: "Message",
          content: (
            <HtmlContent
              html={message.corps}
              label={`Message de ${message.expediteur}`}
              onLink={(url) => void shell.openExternal(url)}
              resolveImage={async (source) => {
                if (!source.startsWith("cid:")) return null;
                const cid = source.slice(4);
                const piece = message.pieces.find(
                  (element) =>
                    element.contentId === cid ||
                    element.contentId === `<${cid}>` ||
                    element.contentId === source,
                );
                if (!piece) return null;
                const reponse = await functions.call<{ piece: { dataUrl: string | null } | null }>(
                  "lire-piece-jointe",
                  { message: message.id, piece: piece.id },
                );
                return reponse.piece?.dataUrl ?? null;
              }}
            />
          ),
        },
        ...(message.pieces.length > 0
          ? [
              {
                title: "Pièces jointes",
                content: (
                  <List label="Pièces jointes du message">
                    {message.pieces.map((piece) => (
                      <ListItem
                        key={piece.id}
                        title={piece.nom}
                        description={[taille(piece.taille), piece.type].filter(Boolean).join(" · ")}
                        onClick={piece.type.startsWith("image/") ? () => void apercu(message, piece) : undefined}
                      />
                    ))}
                  </List>
                ),
              },
            ]
          : []),
      ]}
      actions={(message) => [
        {
          label: "Rédiger une réponse avec l’assistant",
          icon: PenLine,
          onClick: () =>
            openForm({
              title: "Rédiger une réponse",
              description: "Dites en quelques mots ce que vous voulez répondre, ou laissez vide : je propose un texte que vous relirez.",
              fields: [{ name: "intention", label: "Ce que vous voulez dire", type: "textarea", optional: true, placeholder: "D’accord pour jeudi, mais pas avant 14 h." }],
              submitLabel: "Rédiger",
              onSubmit: async (v) => {
                const { reponse } = await redigerReponse(message, v.intention);
                void openForm({
                  title: `Réponse à ${message.expediteur}`,
                  description: "Relisez et ajustez avant d’envoyer.",
                  fields: [{ name: "texte", label: "Votre réponse", type: "textarea" }],
                  initial: { texte: reponse },
                  submitLabel: "Envoyer",
                  success: "Réponse envoyée",
                  onSubmit: async (val) => {
                    await functions.call("repondre-message", { id: message.id, mode: "repondre", texte: val.texte, signature });
                    await shell.send({ type: "refresh" });
                  },
                });
              },
            }),
        },
        {
          label: "Résumer le message",
          icon: FileText,
          onClick: async () => {
            const { resume, actions } = await resumerMessage(message);
            return openModal({
              title: `Résumé : ${message.objet}`,
              size: "wide",
              content: (
                <Markdown>
                  {[resume, ...(actions.length > 0 ? ["", "**Ce qui est attendu de vous**", ...actions.map((a) => `- ${a}`)] : [])].join("\n")}
                </Markdown>
              ),
            });
          },
        },
        {
          label: "Répondre",
          icon: Reply,
          onClick: () => repondre(message, "repondre"),
        },
        {
          label: "Répondre à tous",
          icon: ReplyAll,
          onClick: () => repondre(message, "tous"),
        },
        {
          label: "Transférer",
          icon: Forward,
          onClick: () => transferer(message),
        },
        {
          label: message.lu ? "Marquer comme non lu" : "Marquer comme lu",
          icon: message.lu ? Mail : MailOpen,
          onClick: async () => {
            await functions.call("marquer-message", { id: message.id, lu: !message.lu });
            await shell.send({ type: "refresh" });
          },
        },
        {
          label: "Déplacer",
          icon: FolderInput,
          disabled: listeDossiers.length === 0,
          onClick: () => deplacer(message),
        },
        {
          label: "Ouvrir dans Outlook",
          icon: ExternalLink,
          hidden: !message.url,
          onClick: () => shell.openExternal(message.url ?? ""),
        },
        {
          label: "Supprimer",
          icon: Trash2,
          danger: true,
          confirm: `Supprimer « ${message.objet} » ?`,
          confirmMessage: "Le message ira dans la corbeille.",
          success: "Message supprimé",
          onClick: async () => {
            await functions.call("supprimer-message", { id: message.id });
            await shell.send({ type: "refresh" });
          },
        },
      ]}
    />
  );
}
