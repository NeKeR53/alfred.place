import { Notice, Row, Stack, Text } from "@alfred/kit";
import { ai, db, functions, notifyActionError, semantic, shell, useAsync, usePageState } from "@alfred/sdk";
import { ArrowLeft, Bot, ExternalLink, FileText, MessageCircleQuestion, RefreshCw, Star } from "lucide-react";
import { useEffect, useState } from "react";
import {
  type Action,
  Button,
  DetailPage,
  Dialog,
  HtmlContent,
  Link,
  List,
  Page,
  PageSection,
  RadioGroup,
  SearchField,
  Select,
  StatusBadge,
  useOpenForm,
} from "socle-ui";
import { Markdown } from "socle-ui/markdown";
import { quand } from "../lib/affichage";
import { questionnerPage, resumerPage } from "../lib/assistant";
import { texteBrut } from "../lib/ia";

interface Compte {
  id: string;
  label: string;
  default: boolean;
}

interface PageListe {
  id: string;
  titre: string;
  espace: string;
  espaceCle: string;
  version: number;
  misAJour: string | null;
  auteur: string;
  url: string | null;
}

interface PageComplete extends PageListe {
  messageVersion: string;
  html: string;
  etiquettes: string[];
  ancetres?: Array<{ id: string; titre: string }>;
  enfants?: Array<{ id: string; titre: string }>;
  pieces: Array<{ id: string; nom: string; taille: number; type: string; url: string | null }>;
}

interface Espace {
  cle: string;
  nom: string;
  url: string | null;
}

interface DetailEspace {
  espace: { cle: string; nom: string; description: string; accueil: { id: string; titre: string } | null } | null;
  pages: Array<{ id: string; titre: string; misAJour: string | null; auteur: string; sousPages: number }>;
}

function dateLongue(date: string | null): string {
  if (!date) return "";
  const valeur = new Date(date);
  if (Number.isNaN(valeur.getTime())) return "";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" }).format(valeur);
}

function taille(octets: number): string {
  if (!octets) return "";
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} ko`;
  return `${(octets / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

function ListePages({
  pages,
  onOuvrir,
  avecEspace,
  label,
}: {
  pages: PageListe[];
  onOuvrir: (id: string) => void;
  avecEspace?: boolean;
  label: string;
}) {
  return (
    <List
      label={label}
      selectionMode="none"
      items={pages.map((page) => ({
        id: page.id,
        title: page.titre,
        subtitle:
          [avecEspace ? page.espace : "", page.auteur, page.misAJour ? `modifiée ${quand(page.misAJour)}` : ""]
            .filter(Boolean)
            .join(" · ") || undefined,
      }))}
      onAction={onOuvrir}
    />
  );
}

export default function ConfluencePage() {
  // En ouvrant la page, la pastille du menu se remet à jour (sans notification : vous avez la liste sous les yeux).
  useEffect(() => {
    functions.call("relever-confluence", { notifier: false }).catch(() => undefined);
  }, []);

  const [compteChoisi, setCompteChoisi] = usePageState<string>("confluence.compte", "");
  const [recherche, setRecherche] = usePageState<string>("confluence.recherche", "");
  const openForm = useOpenForm();
  const [fenetre, setFenetre] = useState<{ titre: string; texte: string; note?: string } | null>(null);
  const [espace, setEspace] = usePageState<string>("confluence.espace", "");
  const [pageId, setPageId] = usePageState<string>("confluence.page", "");

  const comptes = useAsync(() => functions.call<{ comptes: Compte[] }>("comptes-confluence"), []);
  const listeComptes = comptes.data?.comptes ?? [];
  const compte = listeComptes.find((element) => element.id === compteChoisi)?.id ?? listeComptes[0]?.id ?? "";

  const espaces = useAsync(
    () =>
      compte
        ? functions.call<{ espaces: Espace[] }>("lister-espaces", { instance: compte })
        : Promise.resolve({ espaces: [] as Espace[] }),
    [compte],
  );

  const favoris = useAsync(
    () =>
      compte
        ? db.query<{ cle: string; libelle: string; contexte: string | null; url: string | null }>(
            "SELECT cle, libelle, contexte, url FROM atlassian_favoris WHERE service = 'confluence' AND instance = ? AND genre = 'page' ORDER BY libelle",
            [compte],
          )
        : Promise.resolve([]),
    [compte],
  );

  // Recherche, ou pages récentes de l’accueil.
  const pages = useAsync(
    () =>
      compte && !pageId && (recherche || !espace)
        ? functions.call<{ pages: PageListe[] }>("rechercher-pages", {
            instance: compte,
            texte: recherche || undefined,
            espace: recherche && espace ? espace : undefined,
            limite: recherche ? 50 : 12,
          })
        : Promise.resolve({ pages: [] as PageListe[] }),
    [compte, recherche, espace, pageId],
  );

  const detailEspace = useAsync(
    () =>
      compte && espace && !pageId && !recherche
        ? functions.call<DetailEspace>("lister-pages-espace", { instance: compte, espace })
        : Promise.resolve({ espace: null, pages: [] } as DetailEspace),
    [compte, espace, pageId, recherche],
  );

  const page = useAsync(
    () =>
      compte && pageId
        ? functions.call<{ page: PageComplete | null }>("lire-page", { instance: compte, id: pageId })
        : Promise.resolve({ page: null as PageComplete | null }),
    [compte, pageId],
  );
  const pageComplete = page.data?.page ?? null;
  const estFavorite = pageId ? (favoris.data ?? []).some((favori) => favori.cle === pageId) : false;

  // Chaque page lue est gardée en texte, pour la retrouver ensuite par le sens.
  // On n’écrit que si son contenu a changé : une page relue telle quelle ne se réindexe pas.
  useEffect(() => {
    if (!pageComplete || !compte) return;
    const id = `${compte}|${pageComplete.id}`;
    const texte = texteBrut(pageComplete.html, 12000);
    void (async () => {
      try {
        const [connue] = await db.query<{ titre: string; texte: string }>(
          "SELECT titre, texte FROM atlassian_pages_lues WHERE id = ?",
          [id],
        );
        if (connue && connue.titre === pageComplete.titre && connue.texte === texte) {
          await db.execute("UPDATE atlassian_pages_lues SET lu_le = datetime('now') WHERE id = ?", [id]);
          return;
        }
        if (connue) {
          await db.execute("UPDATE atlassian_pages_lues SET titre = ?, espace = ?, texte = ?, lu_le = datetime('now') WHERE id = ?", [
            pageComplete.titre,
            pageComplete.espace,
            texte,
            id,
          ]);
        } else {
          await db.execute(
            "INSERT INTO atlassian_pages_lues (id, instance, page_id, titre, espace, texte) VALUES (?, ?, ?, ?, ?, ?)",
            [id, compte, pageComplete.id, pageComplete.titre, pageComplete.espace, texte],
          );
        }
      } catch (erreur) {
        // L’index sera mis à jour à la prochaine lecture : la page reste affichée normalement.
        console.warn("Page non enregistrée pour la recherche par le sens", erreur);
      }
    })();
  }, [pageComplete?.id, pageComplete?.version]);

  // Recherche par les mots (Confluence) ou par le sens (pages déjà lues, sur l’ordinateur).
  const [mode, setMode] = usePageState<string>("confluence.mode", "mots");
  const parLeSens = useAsync(async () => {
    if (mode !== "sens" || !recherche || !compte) return { etat: "inactif", pages: [] as PageListe[] };
    const etat = await semantic.status("pages");
    if (etat.model === "missing") return { etat: "absent", pages: [] as PageListe[] };
    const { results } = await semantic.search<string>("pages", recherche, { limit: 15 });
    const ids = results.map((r) => String(r.key)).filter((id) => id.startsWith(`${compte}|`));
    if (ids.length === 0) return { etat: "pret", pages: [] as PageListe[] };
    const lignes = await db.query<{ id: string; page_id: string; titre: string; espace: string; lu_le: string }>(
      `SELECT id, page_id, titre, espace, lu_le FROM atlassian_pages_lues WHERE id IN (${ids.map(() => "?").join(", ")})`,
      ids,
    );
    return {
      etat: "pret",
      pages: ids
        .map((id) => lignes.find((l) => l.id === id))
        .filter((l): l is NonNullable<typeof l> => Boolean(l))
        .map((l) => ({
          id: l.page_id,
          titre: l.titre,
          espace: l.espace,
          espaceCle: "",
          version: 0,
          misAJour: null,
          auteur: `lue ${quand(l.lu_le.replace(" ", "T") + "Z")}`,
          url: null,
        })),
    };
  }, [mode, recherche, compte]);

  const demanderAssistant: Action = {
    id: "assistant",
    label: "Demander à l’assistant",
    icon: <Bot size={16} />,
    primary: true,
    onPress: () =>
      openForm({
        title: "Demander à l’assistant",
        description: "Je cherche dans vos espaces Confluence, je lis les pages utiles et je vous réponds avec leurs liens.",
        fields: [
          {
            name: "question",
            label: "Votre question",
            type: "textarea",
            isRequired: true,
            placeholder: "Comment fait-on une mise en production ?",
          },
        ],
        submitLabel: "Demander",
        onSubmit: async (v) => {
          await ai.startAgent({
            title: String(v.question).slice(0, 60),
            instruction: `Réponds à la question de l’utilisateur en cherchant dans Confluence (compte « ${compte} ») : cherche les pages pertinentes, lis-les, puis réponds en citant chaque page utilisée (titre et lien). Passe toujours instance = « ${compte} » aux fonctions. Réponds en français.\nQuestion : ${v.question}`,
            functions: ["rechercher-pages", "lire-page", "lister-espaces", "lister-pages-espace"],
          });
        },
      }),
  };

  function ouvrirPage(id: string) {
    setPageId(id);
  }

  function ouvrirEspace(cle: string) {
    setEspace(cle);
    setPageId("");
    setRecherche("");
  }

  function changerCompte(nouveau: string) {
    setCompteChoisi(nouveau);
    setPageId("");
    setEspace("");
  }

  async function basculerFavori() {
    if (!compte || !pageComplete) return;
    if (estFavorite) {
      await db.execute(
        "DELETE FROM atlassian_favoris WHERE service = 'confluence' AND instance = ? AND genre = 'page' AND cle = ?",
        [compte, pageComplete.id],
      );
    } else {
      await db.execute(
        `INSERT INTO atlassian_favoris (id, service, instance, genre, cle, libelle, contexte, url)
         VALUES (?, 'confluence', ?, 'page', ?, ?, ?, ?)`,
        [crypto.randomUUID(), compte, pageComplete.id, pageComplete.titre, pageComplete.espace, pageComplete.url],
      );
    }
    favoris.reload();
  }

  const modale = fenetre ? (
    <Dialog
      isOpen
      size="lg"
      title={fenetre.titre}
      onOpenChange={(ouverte) => {
        if (!ouverte) setFenetre(null);
      }}
      footer={<Button onPress={() => setFenetre(null)}>Fermer</Button>}
    >
      <Stack gap="md">
        {fenetre.note ? <Notice tone="info">{fenetre.note}</Notice> : null}
        <Markdown>{fenetre.texte}</Markdown>
      </Stack>
    </Dialog>
  ) : null;

  if (comptes.loading && !comptes.data) return <Page state="loading">{null}</Page>;

  if (comptes.error || listeComptes.length === 0) {
    return (
      <Page width="text" state={comptes.error ? "error" : "ready"} onRetry={comptes.reload}>
        <PageSection
          title="Confluence"
          empty={{
            title: "Aucun compte Confluence relié",
            description:
              "Ouvrez Réglages, Modules, puis la fiche Atlassian pour ajouter l’adresse de votre Confluence et votre jeton personnel.",
          }}
        >
          {null}
        </PageSection>
      </Page>
    );
  }

  // ——— Une page, en lecture, comme dans Confluence ———
  if (pageId) {
    const ancetres = pageComplete?.ancetres ?? [];
    const enfants = pageComplete?.enfants ?? [];
    const parent = ancetres[ancetres.length - 1];
    return (
      <DetailPage
        title={pageComplete?.titre ?? "Page Confluence"}
        back={{
          label: parent ? parent.titre : "Confluence",
          onPress: () => (parent ? setPageId(parent.id) : setPageId("")),
        }}
        meta={
          pageComplete
            ? [
                pageComplete.auteur ? `Modifiée par ${pageComplete.auteur}` : "",
                dateLongue(pageComplete.misAJour),
                pageComplete.version > 0 ? `version ${pageComplete.version}` : "",
              ].filter(Boolean)
            : undefined
        }
        state={page.error ? "error" : page.loading && !pageComplete ? "loading" : !pageComplete ? "not-found" : "ready"}
        onRetry={page.reload}
        notFound={{ title: "Page introuvable", description: "Elle a peut-être été déplacée, ou vous n’y avez plus accès." }}
        actions={[
          {
            id: "favori",
            label: estFavorite ? "Retirer des favoris" : "Ajouter aux favoris",
            icon: <Star size={16} />,
            isDisabled: !pageComplete,
            onPress: async () => {
              await basculerFavori();
              shell.notify({ title: estFavorite ? "Page retirée des favoris" : "Page ajoutée aux favoris", tone: "success" });
            },
          },
          {
            id: "resumer",
            label: "Résumer la page",
            icon: <FileText size={16} />,
            isDisabled: !pageComplete,
            onPress: async () => {
              if (!pageComplete) return;
              const { resume, pointsCles } = await resumerPage(pageComplete.titre, texteBrut(pageComplete.html));
              setFenetre({ titre: `Résumé : ${pageComplete.titre}`, texte: [resume, "", ...pointsCles.map((p) => `- ${p}`)].join("\n") });
            },
          },
          {
            id: "question",
            label: "Poser une question sur la page",
            icon: <MessageCircleQuestion size={16} />,
            isDisabled: !pageComplete,
            onPress: async () => {
              if (!pageComplete) return;
              let reponse: { reponse: string; trouve: boolean; question: string } | null = null;
              const rempli = await openForm({
                title: "Poser une question sur la page",
                description: "Je réponds en m’appuyant uniquement sur cette page.",
                fields: [{ name: "question", label: "Question", type: "textarea", isRequired: true }],
                submitLabel: "Demander",
                onSubmit: async (v) => {
                  const question = String(v.question);
                  reponse = { ...(await questionnerPage(pageComplete.titre, texteBrut(pageComplete.html), question)), question };
                },
              });
              const lue = reponse as { reponse: string; trouve: boolean; question: string } | null;
              if (!rempli || !lue) return;
              setFenetre({
                titre: lue.question.length > 70 ? `${lue.question.slice(0, 70)}…` : lue.question,
                texte: lue.reponse,
                note: lue.trouve ? undefined : "La page ne répond pas directement à cette question.",
              });
            },
          },
          {
            id: "confluence",
            label: "Ouvrir dans Confluence",
            icon: <ExternalLink size={16} />,
            isHidden: !pageComplete?.url,
            onPress: () => shell.openExternal(pageComplete?.url ?? ""),
          },
          { id: "actualiser", label: "Actualiser", icon: <RefreshCw size={16} />, onPress: () => page.reload() },
        ]}
        onActionError={notifyActionError}
      >
        {pageComplete ? (
          <>
            <DetailPage.Section title="Contenu">
              <Stack gap="md">
                <Row gap="xs" wrap>
                  <Link
                    onPress={() => {
                      setEspace(pageComplete.espaceCle);
                      setPageId("");
                    }}
                  >
                    {pageComplete.espace || "Espace"}
                  </Link>
                  {ancetres.map((ancetre) => (
                    <Row gap="xs" key={ancetre.id}>
                      <Text as="span" tone="muted">
                        ›
                      </Text>
                      <Link onPress={() => setPageId(ancetre.id)}>{ancetre.titre}</Link>
                    </Row>
                  ))}
                </Row>
                {pageComplete.etiquettes.length > 0 ? (
                  <Row gap="xs" wrap>
                    {pageComplete.etiquettes.map((etiquette) => (
                      <StatusBadge key={etiquette} tone="neutral">
                        {etiquette}
                      </StatusBadge>
                    ))}
                  </Row>
                ) : null}
                <HtmlContent
                  html={pageComplete.html}
                  label={`Contenu de la page ${pageComplete.titre}`}
                  onLink={(url) => void shell.openExternal(url)}
                />
                {pageComplete.messageVersion ? (
                  <Text size="meta" tone="muted">
                    {`Dernière modification : ${pageComplete.messageVersion}`}
                  </Text>
                ) : null}
              </Stack>
            </DetailPage.Section>
            {enfants.length > 0 ? (
              <DetailPage.Section title={`Sous-pages (${enfants.length})`}>
                <List
                  label="Sous-pages"
                  selectionMode="none"
                  items={enfants.map((enfant) => ({ id: enfant.id, title: enfant.titre }))}
                  onAction={(id) => setPageId(id)}
                />
              </DetailPage.Section>
            ) : null}
            {pageComplete.pieces.length > 0 ? (
              <DetailPage.Section title={`Pièces jointes (${pageComplete.pieces.length})`}>
                <List
                  label="Pièces jointes"
                  selectionMode="none"
                  items={pageComplete.pieces.map((piece) => ({
                    id: piece.id,
                    title: piece.nom,
                    subtitle: taille(piece.taille) || undefined,
                  }))}
                  onAction={(id) => {
                    const piece = pageComplete.pieces.find((element) => element.id === id);
                    if (piece?.url) void shell.openExternal(piece.url);
                  }}
                />
              </DetailPage.Section>
            ) : null}
          </>
        ) : null}
        {modale}
      </DetailPage>
    );
  }

  const listeEspaces = espaces.data?.espaces ?? [];
  const barre = (
    <Row gap="sm">
      <SearchField
        label={espace ? "cet espace" : "les pages Confluence"}
        onChange={({ text }) => setRecherche(text.trim())}
      />
      <RadioGroup label="Type de recherche" hideLabel orientation="horizontal" value={mode} onChange={setMode}>
        <RadioGroup.Option value="mots">Par les mots</RadioGroup.Option>
        <RadioGroup.Option value="sens">Par le sens</RadioGroup.Option>
      </RadioGroup>
      <Select
        label="Espace"
        hideLabel
        width="sm"
        value={espace}
        options={[{ id: "", label: "Tous les espaces" }, ...listeEspaces.map((element) => ({ id: element.cle, label: element.nom }))]}
        onChange={(id) => ouvrirEspace(id ?? "")}
      />
      {listeComptes.length > 1 ? (
        <Select
          label="Compte Confluence"
          hideLabel
          width="sm"
          value={compte}
          options={listeComptes.map((element) => ({ id: element.id, label: element.label }))}
          onChange={(id) => id && changerCompte(id)}
        />
      ) : null}
    </Row>
  );
  const actualiser: Action = {
    id: "actualiser",
    label: "Actualiser",
    icon: <RefreshCw size={16} />,
    onPress: () => {
      pages.reload();
      favoris.reload();
      espaces.reload();
      detailEspace.reload();
    },
  };
  const infoEspace = listeEspaces.find((e) => e.cle === espace);
  const actions: Action[] = [
    {
      id: "espace-confluence",
      label: "Ouvrir l’espace dans Confluence",
      icon: <ExternalLink size={16} />,
      isHidden: !espace || recherche !== "" || !infoEspace?.url,
      onPress: () => shell.openExternal(infoEspace?.url ?? ""),
    },
    {
      id: "retour",
      label: "Retour à l’accueil",
      icon: <ArrowLeft size={16} />,
      isHidden: !espace || recherche !== "",
      onPress: () => ouvrirEspace(""),
    },
    actualiser,
    demanderAssistant,
  ];

  let contenu;
  if (recherche && mode === "sens") {
    const sens = parLeSens.data;
    contenu = (
      <PageSection
        title="Pages les plus proches de votre question"
        description="Parmi les pages que vous avez déjà ouvertes, de la plus proche à la moins proche."
        state={parLeSens.error ? "error" : parLeSens.loading && !sens ? "loading" : "ready"}
        onRetry={parLeSens.reload}
        empty={
          sens?.etat === "absent"
            ? {
                title: "Recherche par le sens non installée",
                description: "Ouvrez Réglages, Général, rubrique « Recherche par le sens ».",
              }
            : sens && sens.pages.length === 0
              ? {
                  title: "Aucune page proche",
                  description: "La recherche par le sens porte sur les pages que vous avez déjà ouvertes ici.",
                }
              : undefined
        }
      >
        <ListePages pages={sens?.pages ?? []} onOuvrir={ouvrirPage} avecEspace label="Pages proches" />
      </PageSection>
    );
  } else if (recherche) {
    const resultats = pages.data?.pages ?? [];
    contenu = (
      <PageSection
        title={pages.data ? `${resultats.length} résultat${resultats.length > 1 ? "s" : ""}` : "Résultats"}
        state={pages.error ? "error" : pages.loading && !pages.data ? "loading" : "ready"}
        onRetry={pages.reload}
        empty={
          pages.data && resultats.length === 0
            ? { title: "Aucune page trouvée", description: "Essayez d’autres mots, ou un autre espace." }
            : undefined
        }
      >
        <ListePages pages={resultats} onOuvrir={ouvrirPage} avecEspace={!espace} label="Résultats" />
      </PageSection>
    );
  } else if (espace) {
    const detail = detailEspace.data;
    contenu =
      detailEspace.error || (detailEspace.loading && !detail?.espace) || !detail?.espace ? (
        <PageSection
          title={infoEspace?.nom ?? "Espace"}
          state={detailEspace.error ? "error" : detailEspace.loading ? "loading" : "ready"}
          onRetry={detailEspace.reload}
          empty={!detailEspace.loading && !detailEspace.error ? { title: "Espace introuvable" } : undefined}
        >
          {null}
        </PageSection>
      ) : (
        <>
          <PageSection title={detail.espace.nom} description={detail.espace.description || undefined}>
            {detail.espace.accueil ? (
              <List
                label="Page d’accueil"
                selectionMode="none"
                items={[
                  { id: detail.espace.accueil.id, title: detail.espace.accueil.titre, subtitle: "Page d’accueil de l’espace" },
                ]}
                onAction={ouvrirPage}
              />
            ) : (
              <Text tone="muted">Cet espace n’a pas de page d’accueil.</Text>
            )}
          </PageSection>
          <PageSection
            title={`Pages (${detail.pages.length})`}
            empty={detail.pages.length === 0 ? { title: "Aucune page" } : undefined}
          >
            <List
              label="Pages de l’espace"
              selectionMode="none"
              items={detail.pages.map((p) => ({
                id: p.id,
                title: p.titre,
                subtitle: [p.auteur, p.misAJour ? `modifiée ${quand(p.misAJour)}` : ""].filter(Boolean).join(" · ") || undefined,
                meta: p.sousPages > 0 ? `${p.sousPages} sous-page${p.sousPages > 1 ? "s" : ""}` : undefined,
              }))}
              onAction={ouvrirPage}
            />
          </PageSection>
        </>
      );
  } else {
    const recentes = pages.data?.pages ?? [];
    const listeFavoris = favoris.data ?? [];
    contenu = (
      <>
        <PageSection
          title="Récemment mises à jour"
          state={pages.error ? "error" : pages.loading && !pages.data ? "loading" : "ready"}
          onRetry={pages.reload}
          empty={pages.data && recentes.length === 0 ? { title: "Aucune page récente" } : undefined}
        >
          <ListePages pages={recentes} onOuvrir={ouvrirPage} avecEspace label="Pages récentes" />
        </PageSection>
        <PageSection
          title="Vos favoris"
          empty={
            listeFavoris.length === 0
              ? { title: "Aucun favori", description: "Ouvrez une page puis l’étoile pour la retrouver ici." }
              : undefined
          }
        >
          <List
            label="Pages favorites"
            selectionMode="none"
            items={listeFavoris.map((favori) => ({ id: favori.cle, title: favori.libelle, subtitle: favori.contexte ?? undefined }))}
            onAction={ouvrirPage}
          />
        </PageSection>
        <PageSection title="Espaces" empty={listeEspaces.length === 0 ? { title: "Aucun espace" } : undefined}>
          <List
            label="Espaces"
            selectionMode="none"
            items={listeEspaces.map((element) => ({ id: element.cle, title: element.nom, subtitle: element.cle }))}
            onAction={ouvrirEspace}
          />
        </PageSection>
      </>
    );
  }

  return (
    <Page toolbar={barre} actions={actions} onActionError={notifyActionError}>
      {contenu}
      {modale}
    </Page>
  );
}
