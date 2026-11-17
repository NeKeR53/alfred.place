import { useEffect, useState } from "react";
import { Bot, RefreshCw, SquarePen } from "lucide-react";
import { ai, functions, badge, db, shell, useAsync, usePeerMessage } from "@alfred/sdk";
import { badge as pastille, discret, quand, raisonIndisponible } from "../lib/affichage";
import { useJugements } from "../lib/progressif";
import {
  Avatar,
  Button,
  DataTable,
  EmptyState,
  FeedbackBanner,
  LoadingSkeleton,
  Page,
  Row,
  SearchField,
  SelectControl,
  Stack,
  Text,
  openForm,
  usePageState,
  type StatusMap,
} from "@alfred/ui";

interface Compte {
  id: string;
  label: string;
  default: boolean;
}

interface Profil {
  nom: string;
  adresse: string;
}

interface Dossier {
  id: string;
  nom: string;
  parent: string;
  profondeur: number;
  nonLus: number;
  total: number;
}

interface Message {
  id: string;
  objet: string;
  expediteur: string;
  expediteurAdresse: string;
  destinataires: string[];
  recu: string | null;
  lu: boolean;
  brouillon: boolean;
  pieces: boolean;
  extrait: string;
  important: boolean;
  url: string | null;
}

interface Ligne extends Message {
  etat: "lu" | "non_lu" | "brouillon";
}

const ETATS: StatusMap = {
  non_lu: { label: "Non lu", tone: "warning" },
  lu: { label: "Lu", tone: "neutral" },
  brouillon: { label: "Brouillon", tone: "neutral" },
};

const TAILLE = 40;

export default function BoitePage() {
  const [saisie, setSaisie] = usePageState<string>("outlook.boite.recherche", "");
  const [recherche, setRecherche] = useState(saisie.trim());
  const [dossier, setDossier] = usePageState<string>("outlook.boite.dossier", "");
  const [expediteur, setExpediteur] = usePageState<string>("outlook.boite.expediteur", "");
  const [vue, setVue] = usePageState<string>("outlook.boite.vue", "tous");
  const [page, setPage] = usePageState<number>("outlook.boite.page", 1);
  const [selection, setSelection] = usePageState<string | null>("outlook.boite.selection", null);

  const comptes = useAsync(
    () => functions.call<{ comptes: Compte[]; pret: boolean; profil: Profil | null }>("comptes-outlook"),
    [],
  );
  const listeComptes = comptes.data?.comptes ?? [];
  const compte = listeComptes.find((element) => element.default)?.id ?? listeComptes[0]?.id ?? "";
  const pret = comptes.data?.pret === true;

  const preferences = useAsync(
    () => db.query<{ cle: string; valeur: string }>("SELECT cle, valeur FROM outlook_reglages"),
    [],
  );
  function preference(cle: string, defaut: string): string {
    return preferences.data?.find((ligne) => ligne.cle === cle)?.valeur ?? defaut;
  }

  const dossiers = useAsync(
    () =>
      compte
        ? functions.call<{ boite: string; dossiers: Dossier[] }>("lister-dossiers", { instance: compte })
        : Promise.resolve({ boite: "", dossiers: [] as Dossier[] }),
    [compte],
  );
  const listeDossiers = dossiers.data?.dossiers ?? [];
  const boite = dossiers.data?.boite ?? "";

  useEffect(() => {
    if (dossier) return;
    const defaut = preference("dossier_actif", "") || boite;
    if (defaut) setDossier(defaut);
  }, [dossier, preferences.data, boite]);

  useEffect(() => {
    const info = listeDossiers.find((element) => element.id === boite);
    if (info) void badge.set(info.nonLus, { page: "boite-de-reception" });
  }, [listeDossiers, boite]);

  // Un correspondant choisi dans l’onglet Correspondants : filtrer ses messages.
  const [nomChoisi, setNomChoisi] = usePageState<string>("outlook.boite.expediteurNom", "");
  useEffect(() => {
    const choix = preference("expediteur_actif", "");
    if (!choix) return;
    const [adresse, nom] = choix.split("|");
    setExpediteur(adresse);
    setNomChoisi(nom || adresse);
    setPage(1);
    void db.execute("DELETE FROM outlook_reglages WHERE cle = 'expediteur_actif'").then(() => preferences.reload());
  }, [preferences.data]);

  useEffect(() => {
    const minuteur = setTimeout(() => {
      setRecherche(saisie.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(minuteur);
  }, [saisie]);

  const messages = useAsync(
    async () => {
      if (!compte || (!dossier && !boite)) return { messages: [] as Message[], suivant: false };
      return functions.call<{ messages: Message[]; suivant: boolean }>("lister-messages", {
        instance: compte,
        dossier: dossier || boite,
        recherche: recherche || undefined,
        expediteur: expediteur || undefined,
        nonLus: vue === "nonLus",
        debut: (page - 1) * TAILLE,
        limite: TAILLE,
      });
    },
    [compte, dossier, boite, recherche, expediteur, vue, page],
  );

  usePeerMessage(() => {
    messages.reload();
    dossiers.reload();
  });

  const lignes: Ligne[] = (messages.data?.messages ?? []).map((message) => ({
    ...message,
    etat: message.brouillon ? "brouillon" : message.lu ? "lu" : "non_lu",
  }));

  // Lecture locale de chaque message : hameçonnage, urgence, réponse attendue.
  const lecture = useJugements<{ id: string; hameconnage: boolean; indesirable?: boolean; urgent: boolean; reponseAttendue: boolean }>(
    "analyser-messages",
    {},
    "messages",
    lignes.map((m) => ({
      id: m.id,
      objet: m.objet,
      expediteur: m.expediteur,
      expediteurAdresse: m.expediteurAdresse,
      extrait: m.extrait,
      misAJour: m.recu,
    })),
  );

  const expediteurs: Array<{ value: string; label: string }> = [];
  const vus = new Set<string>();
  if (expediteur) {
    vus.add(expediteur);
    expediteurs.push({ value: expediteur, label: nomChoisi || expediteur });
  }
  for (const message of lignes) {
    if (!message.expediteurAdresse || vus.has(message.expediteurAdresse)) continue;
    vus.add(message.expediteurAdresse);
    expediteurs.push({ value: message.expediteurAdresse, label: message.expediteur });
  }

  function choisirDossier(nouveau: string) {
    setDossier(nouveau);
    setSelection(null);
    setPage(1);
    void db.execute(
      `INSERT INTO outlook_reglages (cle, valeur) VALUES ('dossier_actif', ?)
       ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`,
      [nouveau],
    );
  }

  function ouvrir(message: Ligne) {
    setSelection(message.id);
    void shell.publish({ id: message.id });
    void shell.setPanelVisible(true);
    if (!message.lu && preference("marquer_lu_ouverture", "1") === "1") {
      void functions
        .call("marquer-message", { instance: compte, id: message.id, lu: true })
        .then(() => {
          messages.reload();
          dossiers.reload();
        })
        .catch(() => {});
    }
  }

  function composer() {
    return openForm({
      title: "Nouveau message",
      description: "Écrivez votre message ; la signature enregistrée sera ajoutée.",
      fields: [
        {
          name: "destinataires",
          label: "À",
          placeholder: "prenom@exemple.fr",
          hint: "Séparez plusieurs adresses par des virgules.",
        },
        { name: "copies", label: "Copie", optional: true, placeholder: "prenom@exemple.fr" },
        { name: "objet", label: "Objet", placeholder: "Votre sujet" },
        { name: "corps", label: "Message", type: "textarea", placeholder: "Bonjour," },
        { name: "brouillon", label: "Garder en brouillon", type: "checkbox", optional: true },
      ],
      submitLabel: "Envoyer",
      onSubmit: async (valeurs) => {
        const entree = {
          instance: compte,
          destinataires: valeurs.destinataires,
          copies: valeurs.copies,
          objet: valeurs.objet,
          corps: valeurs.corps,
          signature: preference("signature", ""),
        };
        if (valeurs.brouillon === "1") {
          await functions.call("creer-brouillon", entree);
          await shell.notify({
            title: "Brouillon enregistré",
            description: "Vous le retrouverez dans le dossier Brouillons.",
            tone: "info",
          });
        } else {
          await functions.call("envoyer-message", entree);
          await shell.notify({ title: "Message envoyé", tone: "success" });
        }
        messages.reload();
        dossiers.reload();
      },
    });
  }

  if (comptes.loading && !comptes.data) {
    return (
      <Page>
        <LoadingSkeleton />
      </Page>
    );
  }

  return (
    <Page
      search={{ label: "Rechercher un message", value: saisie, onChange: setSaisie }}
      bar={
        pret ? (
        <Row gap="sm">
          {listeDossiers.length > 0 && (
          <SelectControl aria-label="Dossier" value={dossier} onChange={(evenement) => choisirDossier(evenement.target.value)}>
            {!dossier && <option value="">Choisir un dossier</option>}
            {listeDossiers.map((element) => (
              <option key={element.id} value={element.id}>
                {`${"— ".repeat(element.profondeur)}${element.nom}`}
              </option>
            ))}
          </SelectControl>
          )}
          <SelectControl
            aria-label="Vue"
            value={vue}
            onChange={(evenement) => {
              setVue(evenement.target.value);
              setPage(1);
            }}
          >
            <option value="tous">Tous les messages</option>
            <option value="nonLus">Non lus</option>
          </SelectControl>
          <SelectControl
            aria-label="Expéditeur"
            value={expediteur}
            onChange={(evenement) => {
              setExpediteur(evenement.target.value);
              setPage(1);
            }}
          >
            <option value="">Tous les expéditeurs</option>
            {expediteurs.map((element) => (
              <option key={element.value} value={element.value}>
                {element.label}
              </option>
            ))}
          </SelectControl>
        </Row>
        ) : undefined
      }
      actions={[
        { label: "Nouveau message", icon: SquarePen, primary: true, onClick: composer },
        {
          label: "Trier avec l’assistant",
          icon: Bot,
          disabled: !pret,
          onClick: () =>
            openForm({
              title: "Trier avec l’assistant",
              description:
                "Dites-moi ce que vous voulez ranger : je lis vos messages, je propose les déplacements et je vous demande votre accord avant chacun.",
              fields: [
                {
                  name: "demande",
                  label: "Votre demande",
                  type: "textarea",
                  placeholder: "Range les factures dans le dossier Factures et marque les newsletters comme lues.",
                },
              ],
              submitLabel: "Lancer",
              onSubmit: async (v) => {
                await ai.startAgent({
                  title: "Tri de la boîte",
                  instruction: `Aide l’utilisateur à trier sa boîte Outlook. Sa demande : ${v.demande}\nLis les messages, propose les déplacements et ne déplace ou ne marque un message qu’avec son accord. Tu peux aussi créer une règle de tri si c’est utile. Réponds en français.`,
                  functions: ["lister-dossiers", "lister-messages", "lire-message", "deplacer-message", "marquer-message", "enregistrer-regle", "analyser-messages"],
                });
                messages.reload();
              },
            }),
        },
        {
          label: "Actualiser",
          icon: RefreshCw,
          onClick: () => {
            messages.reload();
            dossiers.reload();
          },
        },
      ]}
      footer={
        pret && messages.data && (lignes.length > 0 || page > 1) ? (
          <Row gap="sm" align="center" justify="between">
            <Text size="meta">
              {lignes.length} message{lignes.length > 1 ? "s" : ""} · page {page}
            </Text>
            <Row gap="sm">
              <Button variant="secondary" onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1}>
                Précédent
              </Button>
              <Button
                variant="secondary"
                onClick={() => setPage(page + 1)}
                disabled={!messages.data.suivant}
              >
                Suivant
              </Button>
            </Row>
          </Row>
        ) : undefined
      }
    >
      <Stack gap="md">
        {(comptes.error || (comptes.data && !pret)) && (
          <FeedbackBanner tone="warning" action={<Button onClick={() => comptes.reload()}>Réessayer</Button>}>
            {raisonIndisponible(comptes.error)}
          </FeedbackBanner>
        )}
        {dossiers.error && (
          <FeedbackBanner tone="danger" action={<Button onClick={() => dossiers.reload()}>Réessayer</Button>}>
            {dossiers.error.message}
          </FeedbackBanner>
        )}
        {messages.error && (
          <FeedbackBanner tone="danger" action={<Button onClick={() => messages.reload()}>Réessayer</Button>}>
            {messages.error.message}
          </FeedbackBanner>
        )}

        {!pret ? (
          <EmptyState
            title="Votre boîte n’est pas encore affichée"
            description="Dès qu’Outlook répond sur votre PC Windows, vos messages, vos dossiers et vos correspondants apparaissent ici."
          />
        ) : (
          <DataTable
            label="Messages"
            columns={[
              {
                key: "expediteur",
                header: "De",
                sortable: true,
                render: (message) => (
                  <Row gap="sm" align="center">
                    <Avatar name={message.expediteur || message.expediteurAdresse} size="sm" />
                    <Text as="span" weight={message.lu ? "normal" : "strong"}>
                      {message.expediteur || message.expediteurAdresse}
                    </Text>
                  </Row>
                ),
              },
              {
                key: "objet",
                header: "Objet",
                render: (message) => (
                  <Stack gap="none">
                    <Text as="span" weight={message.lu ? "normal" : "strong"}>
                      {message.objet || "(sans objet)"}
                    </Text>
                    {message.extrait && (
                      <Text as="span" size="meta" tone="muted">
                        {message.extrait.length > 110 ? `${message.extrait.slice(0, 110)}…` : message.extrait}
                      </Text>
                    )}
                  </Stack>
                ),
              },
              {
                key: "etat",
                header: "État",
                render: (message) =>
                  message.etat === "lu"
                    ? message.pieces
                      ? pastille("Pièce jointe", "neutral")
                      : discret("")
                    : pastille(ETATS[message.etat].label, ETATS[message.etat].tone),
              },
              {
                key: "lecture",
                header: "Signaux",
                render: (message) => {
                  const avis = lecture.resultats.get(message.id);
                  if (!avis) return discret(lecture.enCours ? "…" : "");
                  return (
                    <Row gap="xs" wrap>
                      {avis.hameconnage && pastille("Hameçonnage ?", "danger")}
                      {avis.urgent && pastille("Urgent", "warning")}
                      {avis.reponseAttendue && pastille("À répondre", "neutral")}
                      {!avis.hameconnage && !avis.urgent && !avis.reponseAttendue && discret("")}
                    </Row>
                  );
                },
              },
              { key: "recu", header: "Reçu", align: "right", sortable: true, render: (message) => discret(quand(message.recu)) },
            ]}
            rows={lignes}
            rowKey={(element) => element.id}
            selectedKey={selection ?? undefined}
            onRowClick={ouvrir}
            loading={messages.loading}
            emptyTitle={
              vue === "nonLus" ? "Aucun message non lu" : recherche ? "Aucun message trouvé" : "Aucun message"
            }
          />
        )}
        {pret && messages.data && lignes.length === 0 && (
          <Text size="meta">
            {recherche
              ? "Essayez d’autres mots, ou choisissez un autre dossier."
              : vue === "nonLus"
                ? "Tous les messages de ce dossier ont été lus."
                : "Ce dossier est vide."}
          </Text>
        )}
      </Stack>
    </Page>
  );
}
