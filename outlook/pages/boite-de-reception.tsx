import { Notice, Row, Stack, Text } from "@alfred/kit";
import {
  ai,
  badge,
  db,
  functions,
  notifyActionError,
  shell,
  useAsync,
  usePageState,
  usePeerMessage,
} from "@alfred/sdk";
import { Bot, ChevronLeft, ChevronRight, RefreshCw, SquarePen } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Avatar,
  Page,
  PageSection,
  SearchField,
  Select,
  type StatusMap,
  Table,
  type TableColumn,
  useOpenForm,
} from "socle-ui";
import { badge as pastille, discret, quand, raisonIndisponible } from "../lib/affichage";
import { type Classement, lirePoints } from "../lib/points";
import { useJugements } from "../lib/progressif";

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
/** Messages parcourus, au plus, quand la vue est filtrée par point d’entrée. */
const BALAYAGE = 300;
const DOUTEUX = "__douteux";
const AUCUN = "__aucun";

function correspondAuPoint(filtre: string, classement: Classement): boolean {
  if (filtre === DOUTEUX) return classement.statut === "douteux";
  if (filtre === AUCUN) return classement.statut === "aucun";
  return classement.statut === "classe" && classement.point === filtre;
}

export default function BoitePage() {
  const [recherche, setRecherche] = usePageState<string>("outlook.boite.recherche", "");
  const openForm = useOpenForm();
  const [dossier, setDossier] = usePageState<string>("outlook.boite.dossier", "");
  const [expediteur, setExpediteur] = usePageState<string>("outlook.boite.expediteur", "");
  const [vue, setVue] = usePageState<string>("outlook.boite.vue", "tous");
  const [point, setPoint] = usePageState<string>("outlook.boite.point", "");
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

  const points = useAsync(() => lirePoints(true), []);
  const listePoints = points.data ?? [];
  const filtrePoint = point && (point === DOUTEUX || point === AUCUN || listePoints.some((p) => p.id === point)) ? point : "";

  const messages = useAsync(
    async () => {
      if (!compte || (!dossier && !boite)) return { messages: [] as Message[], suivant: false };
      const criteres = {
        instance: compte,
        dossier: dossier || boite,
        recherche: recherche || undefined,
        expediteur: expediteur || undefined,
        nonLus: vue === "nonLus",
      };
      if (!filtrePoint) {
        return functions.call<{ messages: Message[]; suivant: boolean }>("lister-messages", {
          ...criteres,
          debut: (page - 1) * TAILLE,
          limite: TAILLE,
        });
      }
      // Filtre par point d’entrée : je parcours les derniers messages et je garde ceux de ce point.
      const trouves: Message[] = [];
      let debut = 0;
      while (debut < BALAYAGE) {
        const lot = await functions.call<{ messages: Message[]; suivant: boolean }>("lister-messages", {
          ...criteres,
          debut,
          limite: 100,
        });
        for (let i = 0; i < lot.messages.length; i += 50) {
          const tranche = lot.messages.slice(i, i + 50);
          const { resultats } = await functions.call<{ resultats: Classement[] }>("classer-messages", {
            messages: tranche.map((m) => ({
              id: m.id,
              objet: m.objet,
              expediteur: m.expediteur,
              expediteurAdresse: m.expediteurAdresse,
              extrait: m.extrait,
            })),
          });
          const gardes = new Set(resultats.filter((r) => correspondAuPoint(filtrePoint, r)).map((r) => r.id));
          trouves.push(...tranche.filter((m) => gardes.has(m.id)));
        }
        if (!lot.suivant || lot.messages.length === 0) break;
        debut += lot.messages.length;
      }
      return { messages: trouves.slice((page - 1) * TAILLE, page * TAILLE), suivant: trouves.length > page * TAILLE };
    },
    [compte, dossier, boite, recherche, expediteur, vue, page, filtrePoint],
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

  // Point d’entrée de chaque message affiché (gardé en base : instantané une fois classé).
  const classement = useJugements<Classement>(
    "classer-messages",
    {},
    "messages",
    listePoints.length === 0
      ? []
      : lignes.map((m) => ({
          id: m.id,
          objet: m.objet,
          expediteur: m.expediteur,
          expediteurAdresse: m.expediteurAdresse,
          extrait: m.extrait,
          misAJour: `${m.recu ?? ""}|${listePoints.map((p) => p.id + p.nom + p.description).join(",")}`,
        })),
    5,
  );

  const expediteurs: Array<{ id: string; label: string }> = [];
  const vus = new Set<string>();
  if (expediteur) {
    vus.add(expediteur);
    expediteurs.push({ id: expediteur, label: nomChoisi || expediteur });
  }
  for (const message of lignes) {
    if (!message.expediteurAdresse || vus.has(message.expediteurAdresse)) continue;
    vus.add(message.expediteurAdresse);
    expediteurs.push({ id: message.expediteurAdresse, label: message.expediteur });
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
    void shell.publish(message.id);
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
          isRequired: true,
          placeholder: "prenom@exemple.fr",
          description: "Séparez plusieurs adresses par des virgules.",
        },
        { name: "copies", label: "Copie", placeholder: "prenom@exemple.fr" },
        { name: "objet", label: "Objet", isRequired: true, placeholder: "Votre sujet" },
        { name: "corps", label: "Message", type: "textarea", isRequired: true, placeholder: "Bonjour," },
        { name: "brouillon", label: "Garder en brouillon", type: "checkbox" },
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
        if (valeurs.brouillon === true) {
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

  const colonnes: TableColumn[] = [
    { id: "objet", label: "Objet" },
    { id: "expediteur", label: "De", sortable: true },
    { id: "etat", label: "État", width: 120 },
    ...(listePoints.length > 0 ? [{ id: "point", label: "Point d’entrée", width: 140 }] : []),
    { id: "lecture", label: "Signaux", width: 180 },
    { id: "recu", label: "Reçu", align: "end" as const, width: 110, sortable: true },
  ];

  const cellule = (message: Ligne, colonne: string) => {
    switch (colonne) {
      case "objet":
        return message.objet || "(sans objet)";
      case "expediteur":
        return message.expediteur || message.expediteurAdresse;
      case "etat":
        return message.etat === "lu"
          ? message.pieces
            ? pastille("Pièce jointe", "neutral")
            : discret("")
          : pastille(ETATS[message.etat].label, ETATS[message.etat].tone as "warning" | "neutral");
      case "point": {
        const avis = classement.resultats.get(message.id);
        if (!avis) return discret(classement.enCours ? "…" : "");
        if (avis.statut === "douteux") return pastille("À trier", "warning");
        if (avis.statut === "aucun" || !avis.nom) return discret("");
        return pastille(avis.nom, "neutral");
      }
      case "lecture": {
        const avis = lecture.resultats.get(message.id);
        if (!avis) return discret(lecture.enCours ? "…" : "");
        if (!avis.hameconnage && !avis.urgent && !avis.reponseAttendue) return discret("");
        return (
          <Row gap="xs" wrap>
            {avis.hameconnage ? pastille("Hameçonnage ?", "danger") : null}
            {avis.urgent ? pastille("Urgent", "warning") : null}
            {avis.reponseAttendue ? pastille("À répondre", "neutral") : null}
          </Row>
        );
      }
      case "recu":
        return discret(quand(message.recu));
      default:
        return null;
    }
  };

  const videTitre = filtrePoint
    ? "Aucun message pour ce point d’entrée"
    : vue === "nonLus"
      ? "Aucun message non lu"
      : recherche
        ? "Aucun message trouvé"
        : "Aucun message";
  const videTexte = filtrePoint
    ? `Je n’en ai trouvé aucun parmi les ${BALAYAGE} derniers messages de ce dossier.`
    : recherche
      ? "Essayez d’autres mots, ou choisissez un autre dossier."
      : vue === "nonLus"
        ? "Tous les messages de ce dossier ont été lus."
        : "Ce dossier est vide.";

  const outils = pret ? (
    <Row gap="sm">
      <SearchField
        label="les messages"
        onChange={({ text }) => {
          setRecherche(text.trim());
          setPage(1);
        }}
      />
      {listeDossiers.length > 0 ? (
        <Select
          label="Dossier"
          hideLabel
          width="sm"
          placeholder="Choisir un dossier"
          value={dossier || null}
          options={listeDossiers.map((element) => ({
            id: element.id,
            label: `${"— ".repeat(element.profondeur)}${element.nom}`,
          }))}
          onChange={(id) => id && choisirDossier(id)}
        />
      ) : null}
      <Select
        label="Vue"
        hideLabel
        width="sm"
        value={vue}
        options={[
          { id: "tous", label: "Tous les messages" },
          { id: "nonLus", label: "Non lus" },
        ]}
        onChange={(id) => {
          setVue(id ?? "tous");
          setPage(1);
        }}
      />
      {listePoints.length > 0 ? (
        <Select
          label="Point d’entrée"
          hideLabel
          width="sm"
          value={filtrePoint || "tous"}
          options={[
            { id: "tous", label: "Tous les points d’entrée" },
            ...listePoints.map((element) => ({ id: element.id, label: element.nom })),
            { id: DOUTEUX, label: "À trier" },
            { id: AUCUN, label: "Hors points d’entrée" },
          ]}
          onChange={(id) => {
            setPoint(!id || id === "tous" ? "" : id);
            setSelection(null);
            setPage(1);
          }}
        />
      ) : null}
      <Select
        label="Expéditeur"
        hideLabel
        width="sm"
        value={expediteur || "tous"}
        options={[{ id: "tous", label: "Tous les expéditeurs" }, ...expediteurs]}
        onChange={(id) => {
          setExpediteur(!id || id === "tous" ? "" : id);
          setPage(1);
        }}
      />
    </Row>
  ) : undefined;

  return (
    <Page
      state={comptes.loading && !comptes.data ? "loading" : "ready"}
      toolbar={outils}
      actions={[
        { id: "nouveau", label: "Nouveau message", icon: <SquarePen size={16} />, primary: true, onPress: composer },
        {
          id: "assistant",
          label: "Trier avec l’assistant",
          icon: <Bot size={16} />,
          isDisabled: !pret,
          onPress: () =>
            openForm({
              title: "Trier avec l’assistant",
              description:
                "Dites-moi ce que vous voulez ranger : je lis vos messages, je propose les déplacements et je vous demande votre accord avant chacun.",
              fields: [
                {
                  name: "demande",
                  label: "Votre demande",
                  type: "textarea",
                  isRequired: true,
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
          id: "actualiser",
          label: "Actualiser",
          icon: <RefreshCw size={16} />,
          onPress: () => {
            messages.reload();
            dossiers.reload();
          },
        },
        {
          id: "precedente",
          label: "Page précédente",
          icon: <ChevronLeft size={16} />,
          isHidden: !pret,
          isDisabled: page === 1,
          onPress: () => setPage(Math.max(1, page - 1)),
        },
        {
          id: "suivante",
          label: "Page suivante",
          icon: <ChevronRight size={16} />,
          isHidden: !pret,
          isDisabled: !messages.data?.suivant,
          onPress: () => setPage(page + 1),
        },
      ]}
      onActionError={notifyActionError}
      footer={
        pret && messages.data && (lignes.length > 0 || page > 1) ? (
          <Text size="meta">
            {`${lignes.length} message${lignes.length > 1 ? "s" : ""} · page ${page}`}
          </Text>
        ) : undefined
      }
    >
      {!pret ? (
        <PageSection
          title="Boîte de réception"
          empty={{
            title: "Votre boîte n’est pas encore affichée",
            description: comptes.error || comptes.data ? raisonIndisponible(comptes.error) : "Je cherche Outlook sur ce PC…",
            action: { id: "reessayer", label: "Réessayer", onPress: () => comptes.reload() },
          }}
        >
          {null}
        </PageSection>
      ) : (
        <PageSection
          title={listeDossiers.find((element) => element.id === (dossier || boite))?.nom ?? "Messages"}
          state={messages.error || dossiers.error ? "error" : "ready"}
          onRetry={() => {
            messages.reload();
            dossiers.reload();
          }}
          empty={messages.data && lignes.length === 0 ? { title: videTitre, description: videTexte } : undefined}
        >
          <Stack gap="sm">
            {classement.erreur && !messages.error ? <Notice tone="warning">{classement.erreur.message}</Notice> : null}
            <Table<Ligne>
              label="Messages"
              columns={colonnes}
              rows={lignes}
              renderCell={cellule}
              rowIcon={(message) => <Avatar name={message.expediteur || message.expediteurAdresse || "?"} size="sm" />}
              rowDescription={(message) =>
                message.extrait ? (message.extrait.length > 110 ? `${message.extrait.slice(0, 110)}…` : message.extrait) : undefined
              }
              selectionMode="single"
              selectedKeys={selection ? [selection] : []}
              onSelectionChange={(cles) => {
                const id = [...cles][0];
                const message = lignes.find((element) => element.id === id);
                if (message) ouvrir(message);
              }}
              isLoading={messages.loading}
            />
          </Stack>
        </PageSection>
      )}
    </Page>
  );
}
