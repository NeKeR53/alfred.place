import { Row, Stack, Text } from "@alfred/kit";
import { ai, db, functions, notifyActionError, shell, useAsync, usePageState } from "@alfred/sdk";
import { Bookmark, Bot, ChevronLeft, ChevronRight, ExternalLink, Plus, RefreshCw, Shuffle, Trash2 } from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import {
  Button,
  Code,
  DetailPage,
  Dialog,
  type FormField,
  List,
  Page,
  PageSection,
  SearchField,
  Select,
  Table,
  type TableColumn,
  useOpenForm,
} from "socle-ui";
import {
  TRIS,
  VUES,
  analyserRecherche,
  construireSuggestions,
  dateRelative,
  formaterTag,
  type Compte,
  type Referentiels,
  type Ticket,
} from "../lib/jira";
import { badge, discret, tonCategorie, tonPriorite } from "../lib/affichage";
import { ChoixEtat, FicheTicket, lireTransitions, type Transition } from "../lib/fiche-ticket";
import { useJugements } from "../lib/progressif";
import { instructionAgent, OUTILS_AGENT, type Regle } from "../lib/regles";
import { formulaireRegle } from "../lib/regles-ui";

const TAILLE = 40;

interface ReglesTicket {
  cle: string;
  regles: Array<{ id: string; nom: string; action: string; aVerifier: boolean }>;
}

interface TicketOuvert {
  compte: string;
  cle: string;
  titre: string;
  statut: string;
  categorie: string;
  contexte: string;
  url?: string | null;
}

interface LigneTicket extends Ticket {
  miseAJour: string;
}

/** Modale ouverte sur un ticket : changer son état, ou choisir la consigne d’un agent. */
type Fenetre =
  | { kind: "etat"; ticket: TicketOuvert; transitions: Transition[] }
  | { kind: "consigne"; ticket: TicketOuvert; consignes: Regle[] };

/** Sans casse ni accents. */
const plier = (texte: string) => texte.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr");

export default function JiraPage() {
  // En ouvrant la page, la pastille du menu se remet à jour (sans notification : vous avez la liste sous les yeux).
  useEffect(() => {
    functions.call("relever-jira", { notifier: false }).catch(() => undefined);
  }, []);

  const [compteChoisi, setCompteChoisi] = usePageState<string>("jira.compte", "");
  const [tags, setTags] = usePageState<string[]>("jira.tags", []);
  const [vue, setVue] = usePageState<string>("jira.vue", "ouverts");
  const [tri, setTri] = usePageState<string>("jira.tri", "maj");
  const [page, setPage] = usePageState<number>("jira.page", 1);
  const [selection, setSelection] = usePageState<string | null>("jira.selection", null);
  const [filtreId, setFiltreId] = usePageState<string>("jira.filtre", "");

  const openForm = useOpenForm();
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const comptes = useAsync(() => functions.call<{ comptes: Compte[] }>("comptes-jira"), []);
  const listeComptes = comptes.data?.comptes ?? [];
  const compte = listeComptes.find((element) => element.id === compteChoisi)?.id ?? listeComptes[0]?.id ?? "";
  const criteres = analyserRecherche(tags);

  const referentiels = useAsync(
    () =>
      compte
        ? functions.call<Referentiels>("lister-referentiels", { instance: compte })
        : Promise.resolve({ projets: [], statuts: [], priorites: [], types: [], moi: null } as Referentiels),
    [compte],
  );

  const tickets = useAsync(
    () =>
      compte
        ? functions.call<{ tickets: Ticket[]; total: number }>("lister-tickets", {
            instance: compte,
            ...criteres,
            vue,
            tri: tri === "criticite" ? "maj" : tri,
            debut: (page - 1) * TAILLE,
            limite: TAILLE,
          })
        : Promise.resolve({ tickets: [], total: 0 }),
    [compte, JSON.stringify(criteres), vue, tri, page],
  );

  const filtres = useAsync(
    () =>
      compte
        ? db.query<{ id: string; nom: string; requete: string }>(
            "SELECT id, nom, requete FROM atlassian_filtres WHERE service = 'jira' AND instance = ? ORDER BY nom",
            [compte],
          )
        : Promise.resolve([]),
    [compte],
  );

  const suggestions = construireSuggestions(referentiels.data, tickets.data?.tickets ?? []);
  // Les règles : leur version change à chaque création ou modification, et la colonne est rejugée.
  const versionRegles = useAsync(
    () => db.query<{ n: number; maj: string | null }>("SELECT COUNT(*) AS n, MAX(maj_le) AS maj FROM atlassian_regles WHERE active = 1"),
    [],
  );
  const nbRegles = versionRegles.data?.[0]?.n ?? 0;
  const reglesTickets = useJugements<ReglesTicket>(
    "evaluer-regles",
    { instance: compte, moi: referentiels.data?.moi?.id ?? null, version: `${nbRegles}|${versionRegles.data?.[0]?.maj ?? ""}` },
    "tickets",
    nbRegles === 0 ? [] : (tickets.data?.tickets ?? []).map((t) => ({ ...t, misAJour: t.misAJour })),
    10,
  );
  const lignes: LigneTicket[] = (tickets.data?.tickets ?? []).map((ticket) => ({
    ...ticket,
    miseAJour: dateRelative(ticket.misAJour),
  }));
  const total = tickets.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / TAILLE));
  const filtreActuel = filtres.data?.find((filtre) => filtre.id === filtreId);
  const projets = referentiels.data?.projets ?? [];
  const types = referentiels.data?.types ?? [];
  const priorites = referentiels.data?.priorites ?? [];

  function changerTags(suivants: string[]) {
    setTags(suivants);
    setFiltreId("");
    setPage(1);
  }

  function changerVue(nouvelle: string) {
    setVue(nouvelle);
    setFiltreId("");
    setPage(1);
  }

  function changerTri(nouveau: string) {
    setTri(nouveau);
    setFiltreId("");
    setPage(1);
  }

  function changerCompte(nouveau: string) {
    setCompteChoisi(nouveau);
    setSelection(null);
    setPage(1);
  }

  function appliquerFiltre(id: string) {
    setFiltreId(id);
    setPage(1);
    if (!id) return;
    const filtre = filtres.data?.find((element) => element.id === id);
    if (!filtre) return;
    try {
      const contenu = JSON.parse(filtre.requete) as { tags?: string[]; vue?: string; tri?: string };
      if (Array.isArray(contenu.tags)) setTags(contenu.tags);
      if (contenu.vue) setVue(contenu.vue);
      if (contenu.tri) setTri(contenu.tri);
    } catch {
      // Un filtre enregistré illisible est simplement ignoré.
    }
  }

  // Le ticket ouvert est retenu avec le reste de la page : en y revenant, on le retrouve tel quel.
  const [ouvert, setOuvert] = usePageState<TicketOuvert | null>("jira.ouvert", null);

  const lancer = (ticket: TicketOuvert, consigne: string, titre: string) =>
    ai.startAgent({
      title: `${titre} · ${ticket.cle}`,
      instruction: instructionAgent(consigne, ticket.cle, ticket.compte),
      context: { cle: ticket.cle, titre: ticket.titre, statut: ticket.statut, contexte: ticket.contexte },
      functions: OUTILS_AGENT,
    });

  /** Une consigne écrite pour l’occasion. */
  const ecrireConsigne = (ticket: TicketOuvert) =>
    openForm({
      title: "Lancer une consigne",
      description: `Je lis ${ticket.cle} et je vous demande votre accord avant chaque changement.`,
      fields: [
        {
          name: "consigne",
          label: "Consigne",
          type: "textarea",
          isRequired: true,
          placeholder: "Fais le point sur ce ticket, retrouve la pull request liée et passe-la en revue.",
        },
      ],
      submitLabel: "Lancer",
      onSubmit: async (v) => {
        await lancer(ticket, String(v.consigne), "Consigne");
      },
    });

  /** Lance un agent sur le ticket : une consigne des règles, ou une consigne écrite pour l’occasion. */
  async function lancerConsigne(ticket: TicketOuvert) {
    const consignes = await db.query<Regle>(
      "SELECT * FROM atlassian_regles WHERE action = 'agent' AND consigne <> '' ORDER BY nom",
    );
    if (consignes.length === 0) {
      await ecrireConsigne(ticket);
      return;
    }
    setFenetre({ kind: "consigne", ticket, consignes });
  }

  /** Le ticket s’ouvre à la place de la liste, « Retour » en haut ; ses champs sont dans la colonne Détails. */
  function afficher(ticket: TicketOuvert) {
    void shell.publish({ id: `${ticket.compte}|${ticket.cle}` });
    void shell.setPanelVisible(true);
  }

  function fermer() {
    // De retour à la liste, la colonne des détails n’a plus de ticket à montrer.
    setOuvert(null);
    void shell.setPanelVisible(false);
    tickets.reload();
  }

  function ouvrir(ticket: Ticket) {
    const suivant: TicketOuvert = {
      compte,
      cle: ticket.cle,
      titre: ticket.titre,
      statut: ticket.statut,
      categorie: ticket.statutCategorie,
      contexte: [ticket.type, ticket.projetNom || ticket.projet].filter(Boolean).join(" · "),
      url: ticket.url,
    };
    setSelection(`${compte}|${ticket.cle}`);
    setOuvert(suivant);
    afficher(suivant);
  }

  // Au retour sur la page, le ticket qui était ouvert se rouvre.
  useEffect(() => {
    if (ouvert && compte) afficher(ouvert);
  }, [compte]);

  function formulaireTicket() {
    const champs: FormField[] = [
      {
        name: "projet",
        label: "Projet",
        type: "select",
        isRequired: true,
        options: projets.map((projet) => ({ id: projet.cle, label: `${projet.cle} — ${projet.nom}` })),
      },
      { name: "resume", label: "Résumé", isRequired: true, placeholder: "Rétablir l’export des factures" },
      { name: "description", label: "Description", type: "textarea", placeholder: "Ce qui se passe, ce qui est attendu" },
    ];
    if (types.length > 0) {
      champs.push({ name: "type", label: "Type", type: "select", options: types.map((type) => ({ id: type, label: type })) });
    }
    if (priorites.length > 0) {
      champs.push({
        name: "priorite",
        label: "Priorité",
        type: "select",
        options: priorites.map((priorite) => ({ id: priorite, label: priorite })),
      });
    }
    return openForm({
      title: "Nouveau ticket",
      description: "Le ticket est créé dans Jira, dans le projet choisi.",
      fields: champs,
      submitLabel: "Créer",
      onSubmit: async (valeurs) => {
        await functions.call("creer-ticket", {
          instance: compte,
          projet: valeurs.projet,
          resume: valeurs.resume,
          description: valeurs.description,
          type: valeurs.type ?? undefined,
          priorite: valeurs.priorite ?? undefined,
        });
        shell.notify({ title: "Ticket créé", tone: "success" });
        tickets.reload();
      },
    });
  }

  function formulaireFiltre() {
    return openForm({
      title: "Enregistrer le filtre",
      description: "Il sera proposé à côté de la recherche, pour le retrouver d’un clic.",
      fields: [{ name: "nom", label: "Nom du filtre", isRequired: true, placeholder: "Mes tickets urgents" }],
      submitLabel: "Enregistrer",
      onSubmit: async (valeurs) => {
        await db.execute(
          `INSERT INTO atlassian_filtres (id, service, instance, nom, requete)
           VALUES (?, 'jira', ?, ?, ?)
           ON CONFLICT(service, instance, nom) DO UPDATE SET requete = excluded.requete, maj_le = datetime('now')`,
          [crypto.randomUUID(), compte, String(valeurs.nom).trim(), JSON.stringify({ tags, vue, tri })],
        );
        shell.notify({ title: "Filtre enregistré", tone: "success" });
      },
    });
  }

  const modale =
    fenetre?.kind === "etat" ? (
      <ChoixEtat
        instance={fenetre.ticket.compte || undefined}
        cle={fenetre.ticket.cle}
        transitions={fenetre.transitions}
        onClose={() => setFenetre(null)}
      />
    ) : fenetre?.kind === "consigne" ? (
      <Dialog
        isOpen
        title="Lancer une consigne"
        description={`Choisissez une consigne de vos règles, ou écrivez-en une pour ${fenetre.ticket.cle}.`}
        onOpenChange={(ouverte) => {
          if (!ouverte) setFenetre(null);
        }}
        footer={
          <>
            <Button onPress={() => setFenetre(null)}>Annuler</Button>
            <Button
              icon={<Plus size={16} />}
              onPress={() => {
                const ticket = fenetre.ticket;
                setFenetre(null);
                void ecrireConsigne(ticket);
              }}
            >
              Écrire une consigne
            </Button>
          </>
        }
      >
        <List
          label="Consignes"
          selectionMode="none"
          items={fenetre.consignes.map((regle) => ({ id: regle.id, title: regle.nom, subtitle: regle.consigne }))}
          onAction={(id) => {
            const regle = fenetre.consignes.find((element) => element.id === id);
            const ticket = fenetre.ticket;
            setFenetre(null);
            if (regle) void lancer(ticket, regle.consigne, regle.nom);
          }}
        />
      </Dialog>
    ) : null;

  if (ouvert) {
    return (
      <DetailPage
        title={`${ouvert.cle} · ${ouvert.titre}`}
        back={{ label: "Tickets", onPress: fermer }}
        meta={ouvert.contexte ? [ouvert.contexte] : undefined}
        width="full"
        actions={[
          {
            id: "etat",
            label: "Changer l’état",
            icon: <Shuffle size={16} />,
            primary: true,
            onPress: async () => {
              const transitions = await lireTransitions(ouvert.compte || undefined, ouvert.cle);
              if (transitions) setFenetre({ kind: "etat", ticket: ouvert, transitions });
            },
          },
          { id: "consigne", label: "Lancer une consigne", icon: <Bot size={16} />, onPress: () => lancerConsigne(ouvert) },
          {
            id: "jira",
            label: "Ouvrir dans Jira",
            icon: <ExternalLink size={16} />,
            isHidden: !ouvert.url,
            onPress: () => shell.openExternal(ouvert.url ?? ""),
          },
        ]}
        onActionError={notifyActionError}
      >
        <FicheTicket instance={ouvert.compte || undefined} cle={ouvert.cle} />
        {modale}
      </DetailPage>
    );
  }

  if (comptes.loading && !comptes.data) return <Page state="loading">{null}</Page>;

  if (comptes.error || listeComptes.length === 0) {
    return (
      <Page width="text" state={comptes.error ? "error" : "ready"} onRetry={comptes.reload}>
        <PageSection
          title="Jira"
          empty={{
            title: "Aucun compte Jira relié",
            description:
              "Ouvrez Réglages, Modules, puis la fiche Atlassian pour ajouter l’adresse de votre Jira et votre jeton personnel. Cette page affichera ensuite vos tickets, avec la recherche par mots et par critères, les filtres enregistrés et la fiche complète de chaque ticket.",
          }}
        >
          {null}
        </PageSection>
      </Page>
    );
  }

  const colonnes: TableColumn[] = [
    { id: "cle", label: "Clé", width: 110, sortable: true },
    { id: "titre", label: "Titre", sortable: true },
    { id: "statut", label: "État", width: 140, sortable: true },
    { id: "assigne", label: "Assigné", width: 140, sortable: true },
    { id: "priorite", label: "Priorité", width: 110, sortable: true },
    { id: "regles", label: "Règles", width: 170 },
    { id: "miseAJour", label: "Mis à jour", width: 110, align: "end" },
  ];
  const cellule = (ligne: LigneTicket, colonne: string) => {
    switch (colonne) {
      case "cle":
        return <Code>{ligne.cle}</Code>;
      case "titre":
        return ligne.titre;
      case "statut":
        return badge(ligne.statut, tonCategorie(ligne.statutCategorie));
      case "assigne":
        return discret(ligne.assigne);
      case "priorite":
        return badge(ligne.priorite, tonPriorite(ligne.priorite));
      case "regles": {
        const trouvees = reglesTickets.resultats.get(ligne.cle)?.regles;
        if (!trouvees) return discret(nbRegles > 0 && reglesTickets.enCours ? "…" : "");
        if (trouvees.length === 0) return discret("");
        return (
          <Row gap="xs">
            {trouvees.slice(0, 2).map((r) => (
              <Fragment key={r.id}>{badge(`${r.nom}${r.aVerifier ? " ?" : ""}`, r.action === "notifier" ? "warning" : "neutral")}</Fragment>
            ))}
            {trouvees.length > 2 ? discret(`+${trouvees.length - 2}`) : null}
          </Row>
        );
      }
      case "miseAJour":
        return discret(ligne.miseAJour);
      default:
        return null;
    }
  };

  const toutesSuggestions = construireSuggestions(referentiels.data, tickets.data?.tickets ?? []);
  const barre = (
    <Row gap="sm">
      <SearchField
        label="les tickets"
        tagMode
        tags={tags.map((tag) => ({ id: tag, label: formaterTag(tag) }))}
        onTagsChange={(suivants) => changerTags(suivants.map((tag) => tag.id))}
        onChange={() => undefined}
        suggestions={(texte) => {
          const cherche = plier(texte);
          return toutesSuggestions
            .filter((valeur) => plier(valeur).includes(cherche) || plier(formaterTag(valeur)).includes(cherche))
            .slice(0, 5)
            .map((valeur) => ({ id: valeur, label: formaterTag(valeur) }));
        }}
      />
      <Select
        label="Vue"
        hideLabel
        width="sm"
        value={vue}
        options={VUES.map((element) => ({ id: element.value, label: element.label }))}
        onChange={(id) => id && changerVue(id)}
      />
      <Select
        label="Tri"
        hideLabel
        width="sm"
        value={tri}
        options={TRIS.map((element) => ({ id: element.value, label: element.label }))}
        onChange={(id) => id && changerTri(id)}
      />
      {listeComptes.length > 1 ? (
        <Select
          label="Compte Jira"
          hideLabel
          width="sm"
          value={compte}
          options={listeComptes.map((element) => ({ id: element.id, label: element.label }))}
          onChange={(id) => id && changerCompte(id)}
        />
      ) : null}
      {(filtres.data?.length ?? 0) > 0 ? (
        <Select
          label="Filtre enregistré"
          hideLabel
          width="sm"
          value={filtreId}
          options={[
            { id: "", label: "Aucun filtre" },
            ...(filtres.data ?? []).map((filtre) => ({ id: filtre.id, label: filtre.nom })),
          ]}
          onChange={(id) => appliquerFiltre(id ?? "")}
        />
      ) : null}
    </Row>
  );

  return (
    <Page
      toolbar={barre}
      actions={[
        {
          id: "nouveau",
          label: "Nouveau ticket",
          icon: <Plus size={16} />,
          primary: true,
          isDisabled: !compte || projets.length === 0,
          onPress: formulaireTicket,
        },
        {
          id: "actualiser",
          label: "Actualiser",
          icon: <RefreshCw size={16} />,
          onPress: () => {
            tickets.reload();
            referentiels.reload();
          },
        },
        {
          id: "precedente",
          label: "Page précédente",
          icon: <ChevronLeft size={16} />,
          isHidden: pages <= 1,
          isDisabled: page <= 1,
          onPress: () => setPage(Math.max(1, page - 1)),
        },
        {
          id: "suivante",
          label: "Page suivante",
          icon: <ChevronRight size={16} />,
          isHidden: pages <= 1,
          isDisabled: page >= pages,
          onPress: () => setPage(Math.min(pages, page + 1)),
        },
        {
          id: "regle",
          label: "Créer une règle avec cette recherche",
          onPress: async () => {
            const criteresRegle = vue === "ouverts" ? tags : [...tags, `vue:${vue}`];
            const cree = await formulaireRegle(openForm, { criteres: JSON.stringify(criteresRegle) });
            if (cree) versionRegles.reload();
          },
        },
        {
          id: "filtre",
          label: "Enregistrer ce filtre",
          icon: <Bookmark size={16} />,
          isDisabled: !compte,
          onPress: async () => {
            const enregistre = await formulaireFiltre();
            if (enregistre) filtres.reload();
          },
        },
        {
          id: "supprimer-filtre",
          label: "Supprimer le filtre",
          icon: <Trash2 size={16} />,
          danger: true,
          isHidden: !filtreActuel,
          confirm: { title: `Supprimer le filtre « ${filtreActuel?.nom ?? ""} » ?`, confirmLabel: "Supprimer" },
          onPress: async () => {
            await db.execute("DELETE FROM atlassian_filtres WHERE id = ?", [filtreActuel?.id ?? ""]);
            shell.notify({ title: "Filtre supprimé", tone: "success" });
            setFiltreId("");
            filtres.reload();
          },
        },
      ]}
      onActionError={notifyActionError}
      footer={
        <Text size="meta">
          {`${total === 0 ? "Aucun ticket" : `${total} ticket${total > 1 ? "s" : ""}`}${pages > 1 ? ` · page ${page} sur ${pages}` : ""}`}
        </Text>
      }
    >
      <PageSection
        title="Tickets"
        state={tickets.error ? "error" : "ready"}
        onRetry={tickets.reload}
        empty={
          tickets.data && lignes.length === 0
            ? { title: tags.length > 0 || vue !== "tous" ? "Aucun résultat" : "Aucun ticket" }
            : undefined
        }
      >
        <Stack gap="sm">
          {referentiels.error ? (
            <Text size="meta" tone="warning">
              {`Les projets et les valeurs proposées n’ont pas pu être lus : ${referentiels.error.message}`}
            </Text>
          ) : null}
          {reglesTickets.erreur ? (
            <Text size="meta" tone="warning">
              {`Les règles n’ont pas pu être appliquées à la liste : ${reglesTickets.erreur.message}`}
            </Text>
          ) : null}
          <Table<LigneTicket & { id: string }>
            label="Tickets"
            columns={colonnes}
            rows={lignes.map((ligne) => ({ ...ligne, id: `${compte}|${ligne.cle}` }))}
            renderCell={cellule}
            selectionMode="single"
            selectedKeys={selection ? [selection] : []}
            onSelectionChange={(cles) => {
              const id = String([...cles][0] ?? "");
              const ligne = lignes.find((element) => `${compte}|${element.cle}` === id);
              if (ligne) ouvrir(ligne);
            }}
            isLoading={tickets.loading}
          />
        </Stack>
      </PageSection>
    </Page>
  );
}
