import { useEffect } from "react";
import { ArrowLeft, Bookmark, Plus, RefreshCw, Trash2 } from "lucide-react";
import { functions, db, shell, useAsync } from "@alfred/sdk";
import {
  Button,
  Code,
  DataTable,
  FeedbackBanner,
  LoadingSkeleton,
  Page,
  Pagination,
  Row,
  SelectControl,
  Stack,
  TagSearchField,
  Text,
  openForm,
  usePageState,
} from "@alfred/ui";
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
import { FicheTicket } from "../lib/fiche-ticket";
import { useJugements } from "../lib/progressif";

const TAILLE = 40;

interface Jugement {
  cle: string;
  niveau: string;
  confiance: number;
  aVerifier: boolean;
  urgent?: boolean;
  bloquant?: boolean;
}

/** Niveaux de criticité, du plus grave au moins grave ; « ? » signale un jugement à vérifier. */
const NIVEAUX: Record<string, { label: string; tone: "danger" | "warning" | "neutral" | "success" }> = {
  critique: { label: "Critique", tone: "danger" },
  important: { label: "Important", tone: "warning" },
  normal: { label: "Normal", tone: "neutral" },
  faible: { label: "Faible", tone: "neutral" },
};
const RANG: Record<string, number> = { critique: 0, important: 1, normal: 2, faible: 3 };

interface TicketOuvert {
  compte: string;
  cle: string;
  titre: string;
  statut: string;
  categorie: string;
  contexte: string;
}

interface LigneTicket extends Ticket {
  miseAJour: string;
}

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
  // Criticité jugée sur l’ordinateur, ticket par ticket (gardée tant que le ticket ne change pas).
  const criticite = useJugements<Jugement>(
    "evaluer-criticite",
    { instance: compte },
    "tickets",
    (tickets.data?.tickets ?? []).map((t) => ({
      cle: t.cle,
      titre: t.titre,
      type: t.type,
      priorite: t.priorite,
      misAJour: t.misAJour,
    })),
  );
  const jugements = criticite.resultats;
  const lignesBrutes: LigneTicket[] = (tickets.data?.tickets ?? []).map((ticket) => ({
    ...ticket,
    miseAJour: dateRelative(ticket.misAJour),
  }));
  const lignes =
    tri === "criticite"
      ? [...lignesBrutes].sort(
          (a, b) =>
            RANG[jugements.get(a.cle)?.niveau ?? "normal"] - RANG[jugements.get(b.cle)?.niveau ?? "normal"],
        )
      : lignesBrutes;
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

  async function ouvrir(ticket: Ticket) {
    const cle = `${compte}|${ticket.cle}`;
    setSelection(cle);
    setOuvert({
      compte,
      cle: ticket.cle,
      titre: ticket.titre,
      statut: ticket.statut,
      categorie: ticket.statutCategorie,
      contexte: [ticket.type, ticket.projetNom || ticket.projet].filter(Boolean).join(" · "),
    });
    // Comme dans Jira : description et activité au centre, champs modifiables dans la colonne de droite.
    await shell.publish({ id: cle });
    void shell.setPanelVisible(true);
  }

  function fermer() {
    setOuvert(null);
    // De retour à la liste, la colonne des détails n’a plus de ticket à montrer.
    void shell.setPanelVisible(false);
    tickets.reload();
  }

  // Au retour sur la page, la colonne de droite reprend le ticket ouvert.
  useEffect(() => {
    if (ouvert) void shell.publish({ id: `${ouvert.compte}|${ouvert.cle}` });
  }, []);

  function formulaireTicket() {
    const champs: Array<Record<string, unknown>> = [
      {
        name: "projet",
        label: "Projet",
        type: "select",
        options: projets.map((projet) => ({ value: projet.cle, label: `${projet.cle} — ${projet.nom}` })),
      },
      { name: "resume", label: "Résumé", placeholder: "Rétablir l’export des factures" },
      { name: "description", label: "Description", type: "textarea", optional: true, placeholder: "Ce qui se passe, ce qui est attendu" },
    ];
    if (types.length > 0) {
      champs.push({
        name: "type",
        label: "Type",
        type: "select",
        optional: true,
        options: types.map((type) => ({ value: type, label: type })),
      });
    }
    if (priorites.length > 0) {
      champs.push({
        name: "priorite",
        label: "Priorité",
        type: "select",
        optional: true,
        options: priorites.map((priorite) => ({ value: priorite, label: priorite })),
      });
    }
    return openForm({
      title: "Nouveau ticket",
      description: "Le ticket est créé dans Jira, dans le projet choisi.",
      fields: champs,
      submitLabel: "Créer",
      success: "Ticket créé",
      onSubmit: (valeurs) =>
        functions.call("creer-ticket", {
          instance: compte,
          projet: valeurs.projet,
          resume: valeurs.resume,
          description: valeurs.description,
          type: valeurs.type,
          priorite: valeurs.priorite,
        }),
    });
  }

  function formulaireFiltre() {
    return openForm({
      title: "Enregistrer le filtre",
      description: "Il sera proposé à côté de la recherche, pour le retrouver d’un clic.",
      fields: [{ name: "nom", label: "Nom du filtre", placeholder: "Mes tickets urgents" }],
      submitLabel: "Enregistrer",
      success: "Filtre enregistré",
      onSubmit: (valeurs) =>
        db.execute(
          `INSERT INTO atlassian_filtres (id, service, instance, nom, requete)
           VALUES (?, 'jira', ?, ?, ?)
           ON CONFLICT(service, instance, nom) DO UPDATE SET requete = excluded.requete, maj_le = datetime('now')`,
          [crypto.randomUUID(), compte, valeurs.nom.trim(), JSON.stringify({ tags, vue, tri })],
        ),
    });
  }

  if (comptes.loading && !comptes.data) {
    return (
      <Page>
        <LoadingSkeleton />
      </Page>
    );
  }

  if (comptes.error) {
    return (
      <Page>
        <FeedbackBanner
          tone="danger"
          action={<Button onClick={() => comptes.reload()}>Réessayer</Button>}
        >
          {comptes.error.message}
        </FeedbackBanner>
      </Page>
    );
  }

  if (ouvert && listeComptes.length > 0) {
    return (
      <Page
        header={{
          title: `${ouvert.cle} · ${ouvert.titre}`,
          subtitle: ouvert.contexte || undefined,
          status: { label: ouvert.statut, tone: tonCategorie(ouvert.categorie) },
          actions: [{ label: "Retour aux tickets", icon: ArrowLeft, onClick: fermer }],
        }}
      >
        <FicheTicket instance={ouvert.compte || undefined} cle={ouvert.cle} />
      </Page>
    );
  }

  if (listeComptes.length === 0) {
    return (
      <Page width="text">
        <Stack gap="md">
          <FeedbackBanner tone="warning">
            Aucun compte Jira n’est encore relié. Ouvrez Réglages, Modules, puis la fiche Atlassian pour ajouter
            l’adresse de votre Jira et votre jeton personnel.
          </FeedbackBanner>
          <Text>
            Une fois le compte ajouté, cette page affichera vos tickets, avec la recherche par mots et par critères,
            les filtres enregistrés et la fiche complète de chaque ticket.
          </Text>
        </Stack>
      </Page>
    );
  }

  return (
    <Page
      bar={
        <Row gap="sm" wrap>
          <TagSearchField
            label="Rechercher un ticket"
            tags={tags}
            onTagsChange={changerTags}
            suggestions={suggestions}
            formatTag={formaterTag}
            allowFreeText
          />
          <SelectControl aria-label="Vue" value={vue} onChange={(evenement) => changerVue(evenement.target.value)}>
            {VUES.map((element) => (
              <option key={element.value} value={element.value}>
                {element.label}
              </option>
            ))}
          </SelectControl>
          <SelectControl aria-label="Tri" value={tri} onChange={(evenement) => changerTri(evenement.target.value)}>
            {TRIS.map((element) => (
              <option key={element.value} value={element.value}>
                {element.label}
              </option>
            ))}
          </SelectControl>
          {listeComptes.length > 1 && (
            <SelectControl
              aria-label="Compte Jira"
              value={compte}
              onChange={(evenement) => changerCompte(evenement.target.value)}
            >
              {listeComptes.map((element) => (
                <option key={element.id} value={element.id}>
                  {element.label}
                </option>
              ))}
            </SelectControl>
          )}
          {(filtres.data?.length ?? 0) > 0 && (
            <SelectControl
              aria-label="Filtre enregistré"
              value={filtreId}
              onChange={(evenement) => appliquerFiltre(evenement.target.value)}
            >
              <option value="">Aucun filtre</option>
              {(filtres.data ?? []).map((filtre) => (
                <option key={filtre.id} value={filtre.id}>
                  {filtre.nom}
                </option>
              ))}
            </SelectControl>
          )}
        </Row>
      }
      actions={[
        {
          label: "Nouveau ticket",
          icon: Plus,
          primary: true,
          disabled: !compte || projets.length === 0,
          onClick: formulaireTicket,
        },
        {
          label: "Actualiser",
          icon: RefreshCw,
          onClick: () => {
            tickets.reload();
            referentiels.reload();
          },
        },
        {
          label: "Enregistrer ce filtre",
          icon: Bookmark,
          disabled: !compte,
          onClick: async () => {
            const enregistre = await formulaireFiltre();
            if (enregistre) filtres.reload();
          },
        },
        {
          label: "Supprimer le filtre",
          icon: Trash2,
          danger: true,
          hidden: !filtreActuel,
          confirm: `Supprimer le filtre « ${filtreActuel?.nom ?? ""} » ?`,
          success: "Filtre supprimé",
          onClick: async () => {
            await db.execute("DELETE FROM atlassian_filtres WHERE id = ?", [filtreActuel?.id ?? ""]);
            setFiltreId("");
            filtres.reload();
          },
        },
      ]}
      footer={
        <Row align="center" justify="between">
          <Text size="meta">
            {total === 0 ? "Aucun ticket" : `${total} ticket${total > 1 ? "s" : ""}`}
          </Text>
          {pages > 1 && (
            <Pagination page={page} pageSize={TAILLE} total={total} onChange={(nouvelle) => setPage(nouvelle)} />
          )}
        </Row>
      }
    >
      <Stack gap="md">
        {tickets.error && (
          <FeedbackBanner tone="danger" action={<Button onClick={() => tickets.reload()}>Réessayer</Button>}>
            {tickets.error.message}
          </FeedbackBanner>
        )}
        {referentiels.error && (
          <FeedbackBanner tone="warning">
            Les projets et les valeurs proposées n’ont pas pu être lus : {referentiels.error.message}
          </FeedbackBanner>
        )}
        {criticite.erreur && (
          <FeedbackBanner tone="info">{`La criticité n’a pas pu être jugée : ${criticite.erreur.message}`}</FeedbackBanner>
        )}
        <DataTable<LigneTicket>
          label="Tickets"
          columns={[
            { key: "cle", header: "Clé", sortable: true, render: (ligne) => <Code>{ligne.cle}</Code> },
            { key: "titre", header: "Titre", sortable: true },
            {
              key: "statut",
              header: "État",
              sortable: true,
              render: (ligne) => badge(ligne.statut, tonCategorie(ligne.statutCategorie)),
            },
            { key: "assigne", header: "Assigné", sortable: true, render: (ligne) => discret(ligne.assigne) },
            {
              key: "priorite",
              header: "Priorité",
              sortable: true,
              render: (ligne) => badge(ligne.priorite, tonPriorite(ligne.priorite)),
            },
            {
              key: "criticite",
              header: "Criticité",
              render: (ligne) => {
                const jugement = jugements.get(ligne.cle);
                if (!jugement) return discret(criticite.enCours ? "…" : "");
                const libelle = `${NIVEAUX[jugement.niveau]?.label ?? jugement.niveau}${jugement.aVerifier ? " ?" : ""}`;
                return badge(libelle, NIVEAUX[jugement.niveau]?.tone ?? "neutral");
              },
            },
            { key: "miseAJour", header: "Mis à jour", align: "right", render: (ligne) => discret(ligne.miseAJour) },
          ]}
          rows={lignes}
          rowKey={(ligne) => `${compte}|${ligne.cle}`}
          selectedKey={selection}
          onRowClick={ouvrir}
          loading={tickets.loading}
          emptyTitle={tags.length > 0 || vue !== "tous" ? "Aucun résultat" : "Aucun ticket"}
        />
      </Stack>
    </Page>
  );
}
