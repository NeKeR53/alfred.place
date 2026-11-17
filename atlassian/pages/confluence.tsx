import { useEffect, useState } from "react";
import { ArrowLeft, BookOpen, Bot, ExternalLink, FileText, Home, MessageCircleQuestion, Paperclip, RefreshCw, Star } from "lucide-react";
import { ai, db, functions, semantic, shell, useAsync } from "@alfred/sdk";
import {
  Button,
  ChoiceButton,
  ChoiceGroup,
  EmptyState,
  FeedbackBanner,
  Grid,
  HtmlContent,
  Link,
  List,
  ListItem,
  LoadingSkeleton,
  Markdown,
  openForm,
  openModal,
  Page,
  Row,
  Section,
  SelectControl,
  Stack,
  StatusBadge,
  Text,
  usePageState,
} from "@alfred/ui";
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
    <List label={label}>
      {pages.map((page) => (
        <ListItem
          key={page.id}
          leading={<FileText size={16} aria-hidden="true" />}
          title={page.titre}
          description={[avecEspace ? page.espace : "", page.auteur, page.misAJour ? `modifiée ${quand(page.misAJour)}` : ""]
            .filter(Boolean)
            .join(" · ") || undefined}
          onClick={() => onOuvrir(page.id)}
        />
      ))}
    </List>
  );
}

export default function ConfluencePage() {
  // En ouvrant la page, la pastille du menu se remet à jour (sans notification : vous avez la liste sous les yeux).
  useEffect(() => {
    functions.call("relever-confluence", { notifier: false }).catch(() => undefined);
  }, []);

  const [compteChoisi, setCompteChoisi] = usePageState<string>("confluence.compte", "");
  const [saisie, setSaisie] = usePageState<string>("confluence.recherche", "");
  const [recherche, setRecherche] = useState(saisie.trim());
  const [espace, setEspace] = usePageState<string>("confluence.espace", "");
  const [pageId, setPageId] = usePageState<string>("confluence.page", "");

  useEffect(() => {
    const minuteur = setTimeout(() => setRecherche(saisie.trim()), 350);
    return () => clearTimeout(minuteur);
  }, [saisie]);

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

  const demanderAssistant = {
    label: "Demander à l’assistant",
    icon: Bot,
    primary: true,
    onClick: () =>
      openForm({
        title: "Demander à l’assistant",
        description: "Je cherche dans vos espaces Confluence, je lis les pages utiles et je vous réponds avec leurs liens.",
        fields: [{ name: "question", label: "Votre question", type: "textarea", placeholder: "Comment fait-on une mise en production ?" }],
        submitLabel: "Demander",
        onSubmit: (v) =>
          ai.startAgent({
            title: v.question.slice(0, 60),
            instruction: `Réponds à la question de l’utilisateur en cherchant dans Confluence (compte « ${compte} ») : cherche les pages pertinentes, lis-les, puis réponds en citant chaque page utilisée (titre et lien). Passe toujours instance = « ${compte} » aux fonctions. Réponds en français.\nQuestion : ${v.question}`,
            functions: ["rechercher-pages", "lire-page", "lister-espaces", "lister-pages-espace"],
          }),
      }),
  };

  function ouvrirPage(id: string) {
    setPageId(id);
  }

  function ouvrirEspace(cle: string) {
    setEspace(cle);
    setPageId("");
    setSaisie("");
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
        <FeedbackBanner tone="danger" action={<Button onClick={() => comptes.reload()}>Réessayer</Button>}>
          {comptes.error.message}
        </FeedbackBanner>
      </Page>
    );
  }

  if (listeComptes.length === 0) {
    return (
      <Page width="text">
        <FeedbackBanner tone="warning">
          Aucun compte Confluence n’est encore relié. Ouvrez Réglages, Modules, puis la fiche Atlassian pour ajouter
          l’adresse de votre Confluence et votre jeton personnel.
        </FeedbackBanner>
      </Page>
    );
  }

  // ——— Une page, en lecture, comme dans Confluence ———
  if (pageId) {
    const ancetres = pageComplete?.ancetres ?? [];
    const enfants = pageComplete?.enfants ?? [];
    const parent = ancetres[ancetres.length - 1];
    return (
      <Page
        width="text"
        header={{
          title: pageComplete?.titre ?? "Page Confluence",
          subtitle: pageComplete
            ? [
                pageComplete.auteur ? `Modifiée par ${pageComplete.auteur}` : "",
                dateLongue(pageComplete.misAJour),
                pageComplete.version > 0 ? `version ${pageComplete.version}` : "",
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined,
          actions: [
            {
              label: parent ? `Retour à « ${parent.titre} »` : "Retour",
              icon: ArrowLeft,
              onClick: () => (parent ? setPageId(parent.id) : setPageId("")),
            },
            {
              label: estFavorite ? "Retirer des favoris" : "Ajouter aux favoris",
              icon: Star,
              disabled: !pageComplete,
              success: estFavorite ? "Page retirée des favoris" : "Page ajoutée aux favoris",
              onClick: basculerFavori,
            },
            {
              label: "Résumer la page",
              icon: FileText,
              disabled: !pageComplete,
              onClick: async () => {
                const { resume, pointsCles } = await resumerPage(pageComplete!.titre, texteBrut(pageComplete!.html));
                return openModal({
                  title: `Résumé : ${pageComplete!.titre}`,
                  size: "wide",
                  content: <Markdown>{[resume, "", ...pointsCles.map((p) => `- ${p}`)].join("\n")}</Markdown>,
                });
              },
            },
            {
              label: "Poser une question sur la page",
              icon: MessageCircleQuestion,
              disabled: !pageComplete,
              onClick: () =>
                openForm({
                  title: "Poser une question sur la page",
                  description: "Je réponds en m’appuyant uniquement sur cette page.",
                  fields: [{ name: "question", label: "Question", type: "textarea" }],
                  submitLabel: "Demander",
                  onSubmit: async (v) => {
                    const { reponse, trouve } = await questionnerPage(pageComplete!.titre, texteBrut(pageComplete!.html), v.question);
                    void openModal({
                      title: v.question.length > 70 ? `${v.question.slice(0, 70)}…` : v.question,
                      size: "wide",
                      content: (
                        <Stack gap="md">
                          {!trouve && <FeedbackBanner tone="info">La page ne répond pas directement à cette question.</FeedbackBanner>}
                          <Markdown>{reponse}</Markdown>
                        </Stack>
                      ),
                    });
                  },
                }),
            },
            {
              label: "Ouvrir dans Confluence",
              icon: ExternalLink,
              hidden: !pageComplete?.url,
              onClick: () => shell.openExternal(pageComplete?.url ?? ""),
            },
            { label: "Actualiser", onClick: () => page.reload() },
          ],
        }}
      >
        <Stack gap="lg">
          {page.error && (
            <FeedbackBanner tone="danger" action={<Button onClick={() => page.reload()}>Réessayer</Button>}>
              {page.error.message}
            </FeedbackBanner>
          )}
          {page.loading && !pageComplete && <LoadingSkeleton />}
          {!page.loading && !pageComplete && !page.error && (
            <EmptyState title="Page introuvable" description="Elle a peut-être été déplacée, ou vous n’y avez plus accès." />
          )}
          {pageComplete && (
            <>
              <Row gap="xs" wrap>
                <Link
                  onClick={() => {
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
                    <Link onClick={() => setPageId(ancetre.id)}>{ancetre.titre}</Link>
                  </Row>
                ))}
              </Row>
              {pageComplete.etiquettes.length > 0 && (
                <Row gap="xs" wrap>
                  {pageComplete.etiquettes.map((etiquette) => (
                    <StatusBadge key={etiquette} tone="neutral" size="compact">
                      {etiquette}
                    </StatusBadge>
                  ))}
                </Row>
              )}
              <HtmlContent
                html={pageComplete.html}
                label={`Contenu de la page ${pageComplete.titre}`}
                onLink={(url) => void shell.openExternal(url)}
              />
              {enfants.length > 0 && (
                <Section title={`Sous-pages (${enfants.length})`}>
                  <List label="Sous-pages">
                    {enfants.map((enfant) => (
                      <ListItem
                        key={enfant.id}
                        leading={<FileText size={16} aria-hidden="true" />}
                        title={enfant.titre}
                        onClick={() => setPageId(enfant.id)}
                      />
                    ))}
                  </List>
                </Section>
              )}
              {pageComplete.pieces.length > 0 && (
                <Section title={`Pièces jointes (${pageComplete.pieces.length})`}>
                  <List label="Pièces jointes">
                    {pageComplete.pieces.map((piece) => (
                      <ListItem
                        key={piece.id}
                        leading={<Paperclip size={16} aria-hidden="true" />}
                        title={piece.nom}
                        description={taille(piece.taille) || undefined}
                        onClick={piece.url ? () => void shell.openExternal(piece.url ?? "") : undefined}
                      />
                    ))}
                  </List>
                </Section>
              )}
              {pageComplete.messageVersion && (
                <Text size="meta" tone="muted">
                  {`Dernière modification : ${pageComplete.messageVersion}`}
                </Text>
              )}
            </>
          )}
        </Stack>
      </Page>
    );
  }

  const listeEspaces = espaces.data?.espaces ?? [];
  const barre = (
    <Row gap="sm" wrap>
      <ChoiceGroup label="Type de recherche" appearance="segmented">
        <ChoiceButton label="Par les mots" variant="label" size="compact" selected={mode === "mots"} onClick={() => setMode("mots")}>
          Par les mots
        </ChoiceButton>
        <ChoiceButton label="Par le sens" variant="label" size="compact" selected={mode === "sens"} onClick={() => setMode("sens")}>
          Par le sens
        </ChoiceButton>
      </ChoiceGroup>
      <SelectControl aria-label="Espace" value={espace} onChange={(evenement) => ouvrirEspace(evenement.target.value)}>
        <option value="">Tous les espaces</option>
        {listeEspaces.map((element) => (
          <option key={element.cle} value={element.cle}>
            {element.nom}
          </option>
        ))}
      </SelectControl>
      {listeComptes.length > 1 && (
        <SelectControl aria-label="Compte Confluence" value={compte} onChange={(e) => changerCompte(e.target.value)}>
          {listeComptes.map((element) => (
            <option key={element.id} value={element.id}>
              {element.label}
            </option>
          ))}
        </SelectControl>
      )}
    </Row>
  );
  const recherchePage = {
    label: espace ? "Rechercher dans cet espace" : "Rechercher une page",
    value: saisie,
    onChange: setSaisie,
  };
  const actualiser = {
    label: "Actualiser",
    icon: RefreshCw,
    onClick: () => {
      pages.reload();
      favoris.reload();
      espaces.reload();
      detailEspace.reload();
    },
  };

  // ——— Résultats d’une recherche ———
  if (recherche && mode === "sens") {
    const sens = parLeSens.data;
    return (
      <Page search={recherchePage} bar={barre} actions={[actualiser, demanderAssistant]}>
        <Stack gap="md">
          {parLeSens.error && <FeedbackBanner tone="danger">{parLeSens.error.message}</FeedbackBanner>}
          {sens?.etat === "absent" ? (
            <FeedbackBanner tone="info">
              La recherche par le sens n’est pas encore installée : ouvrez Réglages, Général, rubrique « Recherche par le sens ».
            </FeedbackBanner>
          ) : parLeSens.loading && !sens ? (
            <LoadingSkeleton />
          ) : (sens?.pages.length ?? 0) === 0 ? (
            <EmptyState
              title="Aucune page proche"
              description="La recherche par le sens porte sur les pages que vous avez déjà ouvertes ici."
            />
          ) : (
            <Section
              title="Pages les plus proches de votre question"
              description="Parmi les pages que vous avez déjà ouvertes, de la plus proche à la moins proche."
            >
              <ListePages pages={sens?.pages ?? []} onOuvrir={ouvrirPage} avecEspace label="Pages proches" />
            </Section>
          )}
        </Stack>
      </Page>
    );
  }

  if (recherche) {
    const resultats = pages.data?.pages ?? [];
    return (
      <Page search={recherchePage} bar={barre} actions={[actualiser, demanderAssistant]}>
        <Stack gap="md">
          {pages.error && <FeedbackBanner tone="danger">{pages.error.message}</FeedbackBanner>}
          {pages.loading && !pages.data ? (
            <LoadingSkeleton />
          ) : resultats.length === 0 ? (
            <EmptyState title="Aucune page trouvée" description="Essayez d’autres mots, ou un autre espace." />
          ) : (
            <Section title={`${resultats.length} résultat${resultats.length > 1 ? "s" : ""}`}>
              <ListePages pages={resultats} onOuvrir={ouvrirPage} avecEspace={!espace} label="Résultats" />
            </Section>
          )}
        </Stack>
      </Page>
    );
  }

  // ——— Un espace : sa page d’accueil et ses pages ———
  if (espace) {
    const detail = detailEspace.data;
    const infoEspace = listeEspaces.find((e) => e.cle === espace);
    return (
      <Page
        search={recherchePage}
        bar={barre}
        actions={[
          {
            label: "Ouvrir l’espace dans Confluence",
            icon: ExternalLink,
            hidden: !infoEspace?.url,
            onClick: () => shell.openExternal(infoEspace?.url ?? ""),
          },
          actualiser,
          demanderAssistant,
        ]}
      >
        <Stack gap="lg">
          {detailEspace.error && <FeedbackBanner tone="danger">{detailEspace.error.message}</FeedbackBanner>}
          {detailEspace.loading && !detail?.espace ? (
            <LoadingSkeleton />
          ) : !detail?.espace ? (
            <EmptyState title="Espace introuvable" />
          ) : (
            <>
              <Section title={detail.espace.nom} description={detail.espace.description || undefined}>
                {detail.espace.accueil ? (
                  <List label="Page d’accueil">
                    <ListItem
                      leading={<Home size={16} aria-hidden="true" />}
                      title={detail.espace.accueil.titre}
                      description="Page d’accueil de l’espace"
                      onClick={() => ouvrirPage(detail.espace!.accueil!.id)}
                    />
                  </List>
                ) : (
                  <Text tone="muted">Cet espace n’a pas de page d’accueil.</Text>
                )}
              </Section>
              <Section title={`Pages (${detail.pages.length})`}>
                {detail.pages.length === 0 ? (
                  <EmptyState size="compact" title="Aucune page" />
                ) : (
                  <List label="Pages de l’espace">
                    {detail.pages.map((p) => (
                      <ListItem
                        key={p.id}
                        leading={<FileText size={16} aria-hidden="true" />}
                        title={p.titre}
                        description={[p.auteur, p.misAJour ? `modifiée ${quand(p.misAJour)}` : ""].filter(Boolean).join(" · ") || undefined}
                        trailing={
                          p.sousPages > 0 ? (
                            <Text as="span" size="meta" tone="muted">
                              {`${p.sousPages} sous-page${p.sousPages > 1 ? "s" : ""}`}
                            </Text>
                          ) : undefined
                        }
                        onClick={() => ouvrirPage(p.id)}
                      />
                    ))}
                  </List>
                )}
              </Section>
            </>
          )}
        </Stack>
      </Page>
    );
  }

  // ——— Accueil : favoris, espaces, pages récentes ———
  const recentes = pages.data?.pages ?? [];
  const listeFavoris = favoris.data ?? [];
  return (
    <Page search={recherchePage} bar={barre} actions={[actualiser, demanderAssistant]}>
      <Grid minColumnWidth={360} gap="lg">
        <Section title="Récemment mises à jour">
          {pages.error ? (
            <FeedbackBanner tone="danger">{pages.error.message}</FeedbackBanner>
          ) : pages.loading && !pages.data ? (
            <LoadingSkeleton />
          ) : recentes.length === 0 ? (
            <EmptyState size="compact" title="Aucune page récente" />
          ) : (
            <ListePages pages={recentes} onOuvrir={ouvrirPage} avecEspace label="Pages récentes" />
          )}
        </Section>
        <Stack gap="lg">
          <Section title="Vos favoris">
            {listeFavoris.length === 0 ? (
              <Text tone="muted">Ouvrez une page puis l’étoile pour la retrouver ici.</Text>
            ) : (
              <List label="Pages favorites">
                {listeFavoris.map((favori) => (
                  <ListItem
                    key={favori.cle}
                    leading={<Star size={16} aria-hidden="true" />}
                    title={favori.libelle}
                    description={favori.contexte ?? undefined}
                    onClick={() => ouvrirPage(favori.cle)}
                  />
                ))}
              </List>
            )}
          </Section>
          <Section title="Espaces">
            {listeEspaces.length === 0 ? (
              <Text tone="muted">Aucun espace.</Text>
            ) : (
              <List label="Espaces">
                {listeEspaces.map((element) => (
                  <ListItem
                    key={element.cle}
                    leading={<BookOpen size={16} aria-hidden="true" />}
                    title={element.nom}
                    description={element.cle}
                    onClick={() => ouvrirEspace(element.cle)}
                  />
                ))}
              </List>
            )}
          </Section>
        </Stack>
      </Grid>
    </Page>
  );
}
