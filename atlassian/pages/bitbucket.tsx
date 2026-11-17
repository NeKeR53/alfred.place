import { useEffect } from "react";
import {
  ArrowLeft,
  BookMarked,
  Bot,
  Download,
  Check,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Lightbulb,
  ListChecks,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldAlert,
  Star,
  X,
} from "lucide-react";
import { ai, db, functions, shell, useAsync } from "@alfred/sdk";
import {
  type Action,
  Avatar,
  Button,
  ChoiceButton,
  ChoiceGroup,
  Code,
  EmptyState,
  FeedbackBanner,
  Grid,
  IconButton,
  Link,
  List,
  ListItem,
  LoadingSkeleton,
  Markdown,
  Page,
  Row,
  SearchField,
  Section,
  SelectControl,
  Stack,
  StatusBadge,
  Surface,
  Tabs,
  Text,
  openForm,
  openModal,
  openSubpage,
  usePageState,
} from "@alfred/ui";
import { quand } from "../lib/affichage";
import { useJugements } from "../lib/progressif";
import { analyserPr, type ContextePr, expliquerFichier, redigerDescriptionPr, revuePr } from "../lib/assistant";
import {
  AllerAuFichier,
  AVIS,
  type Commit,
  ContenuFichier,
  DernierCommit,
  DiffFichier,
  ETATS_PR,
  type Fichier,
  ListeCommits,
  ListeFichiers,
  Readme,
} from "../lib/bitbucket-vues";

interface Compte {
  id: string;
  label: string;
  default: boolean;
}

interface Depot {
  slug: string;
  nom: string;
  description: string;
  projet: string;
  projetNom: string;
  archive: boolean;
  brancheDefaut: string | null;
  url: string | null;
  clones?: Array<{ nom: string; url: string }>;
  public?: boolean;
}

interface Branche {
  nom: string;
  estDefaut: boolean;
  dernierCommit: string | null;
}

interface Pr {
  id: number;
  version: number;
  titre: string;
  description: string;
  etat: string;
  auteur: string;
  source: string;
  cible: string;
  projet: string;
  depot: string;
  cree: number | null;
  misAJour: number | null;
  commentaires: number | null;
  evaluateurs: Array<{ nom: string; statut: string }>;
  url: string | null;
}

interface CommentairePr {
  id: string;
  auteur: string;
  texte: string;
  cree: number | null;
}

type OngletDepot = "code" | "prs" | "branches" | "commits";
type OngletPr = "conversation" | "commits" | "fichiers";

const DIFFS_AFFICHES = 25;

function separerDepot(cle: string): { projet: string; depot: string } {
  const morceaux = cle.split("/");
  return { projet: morceaux[0] ?? "", depot: morceaux.slice(1).join("/") };
}

const RISQUES: Record<string, { label: string; tone: "danger" | "warning" | "neutral" }> = {
  eleve: { label: "Risque élevé", tone: "danger" },
  moyen: { label: "Risque moyen", tone: "warning" },
  faible: { label: "Risque faible", tone: "neutral" },
};

function ListePrs({
  prs,
  onOuvrir,
  avecDepot,
  risques,
}: {
  prs: Pr[];
  onOuvrir: (pr: Pr) => void;
  avecDepot?: boolean;
  risques?: Map<string, { niveau: string; aVerifier: boolean }>;
}) {
  if (prs.length === 0) return <EmptyState size="compact" title="Aucune pull request ouverte" />;
  return (
    <List label="Pull requests">
      {prs.map((pr) => (
        <ListItem
          key={`${pr.projet}/${pr.depot}/${pr.id}`}
          leading={<GitPullRequest size={16} aria-hidden="true" />}
          title={`${pr.titre}`}
          description={`${avecDepot ? `${pr.projet}/${pr.depot} · ` : ""}#${pr.id} ouverte ${quand(pr.cree)} par ${pr.auteur} · ${pr.source} → ${pr.cible}`}
          trailing={
            <Row gap="sm">
              {risques?.get(`${pr.projet}/${pr.depot}/${pr.id}`) && (
                <StatusBadge tone={RISQUES[risques.get(`${pr.projet}/${pr.depot}/${pr.id}`)!.niveau]?.tone ?? "neutral"} size="compact">
                  {`${RISQUES[risques.get(`${pr.projet}/${pr.depot}/${pr.id}`)!.niveau]?.label ?? "Risque"}${risques.get(`${pr.projet}/${pr.depot}/${pr.id}`)!.aVerifier ? " ?" : ""}`}
                </StatusBadge>
              )}
              {(pr.commentaires ?? 0) > 0 && (
                <Row gap="xs">
                  <MessageSquare size={14} aria-hidden="true" />
                  <Text as="span" size="meta">
                    {String(pr.commentaires)}
                  </Text>
                </Row>
              )}
              <StatusBadge tone={ETATS_PR[pr.etat]?.tone ?? "neutral"} size="compact">
                {ETATS_PR[pr.etat]?.label ?? pr.etat}
              </StatusBadge>
            </Row>
          }
          onClick={() => onOuvrir(pr)}
        />
      ))}
    </List>
  );
}

export default function BitbucketPage() {
  // En ouvrant la page, la pastille du menu se remet à jour (sans notification : vous avez la liste sous les yeux).
  useEffect(() => {
    functions.call("relever-bitbucket", { notifier: false }).catch(() => undefined);
  }, []);

  const [compteChoisi, setCompteChoisi] = usePageState<string>("bitbucket.compte", "");
  const [vue, setVue] = usePageState<string>("bitbucket.vue", "depots");
  const [filtre, setFiltre] = usePageState<string>("bitbucket.filtre", "tous");
  const [recherche, setRecherche] = usePageState<string>("bitbucket.recherche", "");
  const [depotCle, setDepotCle] = usePageState<string>("bitbucket.depot", "");
  const [onglet, setOnglet] = usePageState<OngletDepot>("bitbucket.onglet", "code");
  const [branche, setBranche] = usePageState<string>("bitbucket.branche", "");
  const [chemin, setChemin] = usePageState<string>("bitbucket.chemin", "");
  const [prCible, setPrCible] = usePageState<string>("bitbucket.pr", "");
  const [ongletPr, setOngletPr] = usePageState<OngletPr>("bitbucket.ongletPr", "conversation");
  const [originePr, setOriginePr] = usePageState<string>("bitbucket.originePr", "depot");

  // L’ancienne vue « favoris » devient un filtre de la liste.
  useEffect(() => {
    if (vue === "favoris") {
      setFiltre("favoris");
      setVue("depots");
    }
  }, [vue]);

  const comptes = useAsync(() => functions.call<{ comptes: Compte[] }>("comptes-bitbucket"), []);
  const listeComptes = comptes.data?.comptes ?? [];
  const compte = listeComptes.find((element) => element.id === compteChoisi)?.id ?? listeComptes[0]?.id ?? "";

  // De retour sur la page avec un dépôt ouvert, la colonne « À propos » le reprend.
  useEffect(() => {
    if (depotCle && compte && (vue === "depot" || vue === "pr")) void shell.publish({ id: `${compte}|${depotCle}` });
  }, [compte]);

  const favoris = useAsync(
    () =>
      compte
        ? db.query<{ cle: string; libelle: string; contexte: string | null; url: string | null }>(
            "SELECT cle, libelle, contexte, url FROM atlassian_favoris WHERE service = 'bitbucket' AND instance = ? ORDER BY libelle",
            [compte],
          )
        : Promise.resolve([]),
    [compte],
  );
  const clesFavorites = new Set((favoris.data ?? []).map((favori) => favori.cle));

  const depots = useAsync(
    () =>
      compte && vue === "depots"
        ? functions.call<{ depots: Depot[] }>("lister-depots", {
            instance: compte,
            recherche: recherche.trim() || undefined,
            limite: 100,
          })
        : Promise.resolve({ depots: [] as Depot[] }),
    [compte, vue, recherche],
  );

  const cible = depotCle ? separerDepot(depotCle) : null;
  const info = useAsync(
    () =>
      compte && cible
        ? functions.call<{ depot: Depot | null; branches: Branche[] }>("lire-depot", {
            instance: compte,
            projet: cible.projet,
            depot: cible.depot,
          })
        : Promise.resolve({ depot: null, branches: [] as Branche[] }),
    [compte, depotCle],
  );
  const depotInfo = info.data?.depot ?? null;
  const branches = info.data?.branches ?? [];
  const brancheActive = branche || depotInfo?.brancheDefaut || "";

  const fichiers = useAsync(
    () =>
      compte && cible && vue === "depot"
        ? functions.call<{ chemin: string; fichiers: Fichier[]; tronque: boolean }>("lister-fichiers", {
            instance: compte,
            projet: cible.projet,
            depot: cible.depot,
            chemin,
            branche: brancheActive || undefined,
          })
        : Promise.resolve({ chemin: "", fichiers: [] as Fichier[], tronque: false }),
    [compte, depotCle, chemin, brancheActive, vue],
  );

  const prsDepot = useAsync(
    () =>
      compte && cible
        ? functions.call<{ prs: Pr[] }>("lister-prs", {
            instance: compte,
            projet: cible.projet,
            depot: cible.depot,
            etat: "OPEN",
            role: "ALL",
            limite: 50,
          })
        : Promise.resolve({ prs: [] as Pr[] }),
    [compte, depotCle],
  );

  const commits = useAsync(
    () =>
      compte && cible && vue === "depot" && onglet === "commits"
        ? functions.call<{ commits: Commit[] }>("lister-commits", {
            instance: compte,
            projet: cible.projet,
            depot: cible.depot,
            branche: brancheActive || undefined,
            limite: 50,
          })
        : Promise.resolve({ commits: [] as Commit[] }),
    [compte, depotCle, brancheActive, vue, onglet],
  );

  const prsEntrantes = useAsync(
    () =>
      compte && vue === "prs"
        ? functions.call<{ prs: Pr[] }>("lister-prs", { instance: compte, etat: "OPEN", role: "INCOMING", limite: 50 })
        : Promise.resolve({ prs: [] as Pr[] }),
    [compte, vue],
  );

  // Risque des pull requests affichées, jugé sur l’ordinateur.
  const prsAJuger = [...(prsDepot.data?.prs ?? []), ...(prsEntrantes.data?.prs ?? [])].map((pr) => ({
    ...pr,
    projet: pr.projet || cible?.projet || "",
    depot: pr.depot || cible?.depot || "",
  }));
  const risquesPr = useJugements<{ cle: string; niveau: string; aVerifier: boolean }>(
    "evaluer-risque-pr",
    { instance: compte },
    "prs",
    prsAJuger.map((pr) => ({
      cle: `${pr.projet}/${pr.depot}/${pr.id}`,
      titre: pr.titre,
      description: pr.description,
      source: pr.source,
      cible: pr.cible,
      misAJour: pr.misAJour,
    })),
  );
  const risques = risquesPr.resultats;
  const [analysePr, setAnalysePr] = usePageState<{
    pr: string;
    resume: string;
    risques: Array<{ fichier: string; risque: string; gravite: string }>;
    conseil: string;
  } | null>("bitbucket.analyse", null);
  const [revue, setRevue] = usePageState<{ pr: string; commentaires: Array<{ fichier: string; remarque: string }> } | null>(
    "bitbucket.revue",
    null,
  );

  const prActive = prCible ? prCible.split("/") : [];
  const prNumero = Number(prActive[prActive.length - 1] ?? 0);
  const prProjet = prActive[0] ?? "";
  const prDepot = prActive.slice(1, -1).join("/");

  const detail = useAsync(
    () =>
      compte && vue === "pr" && prNumero
        ? functions.call<{ pr: Pr | null; commentaires: CommentairePr[]; commits: Commit[] }>("lire-pr", {
            instance: compte,
            projet: prProjet,
            depot: prDepot,
            id: prNumero,
          })
        : Promise.resolve({ pr: null, commentaires: [] as CommentairePr[], commits: [] as Commit[] }),
    [compte, vue, prCible],
  );

  const changements = useAsync(
    () =>
      compte && vue === "pr" && prNumero && ongletPr === "fichiers"
        ? functions.call<{ fichiers: Array<{ chemin: string; nature: string }> }>("lister-changements-pr", {
            instance: compte,
            pr: prCible,
          })
        : Promise.resolve({ fichiers: [] as Array<{ chemin: string; nature: string }> }),
    [compte, vue, prCible, ongletPr],
  );

  function changerCompte(nouveau: string) {
    setCompteChoisi(nouveau);
    setVue("depots");
    setDepotCle("");
    setPrCible("");
  }

  function ouvrirDepot(cle: string) {
    setDepotCle(cle);
    setBranche("");
    setChemin("");
    setOnglet("code");
    setVue("depot");
    // La colonne « À propos » s’ouvre à droite, comme sur GitHub.
    void shell.publish({ id: `${compte}|${cle}` });
    void shell.setPanelVisible(true);
  }

  function ouvrirPr(pr: Pr, origine: "depot" | "prs") {
    setOriginePr(origine);
    setPrCible(`${pr.projet}/${pr.depot}/${pr.id}`);
    setOngletPr("conversation");
    setVue("pr");
  }

  function retour() {
    if (vue === "pr") {
      setVue(originePr === "prs" ? "prs" : "depot");
      if (originePr !== "prs") setOnglet("prs");
      return;
    }
    setVue("depots");
    setDepotCle("");
    setChemin("");
    void shell.setPanelVisible(false);
  }

  async function basculerFavori(depot: Depot) {
    if (!compte) return;
    const cle = `${depot.projet}/${depot.slug}`;
    const existant = await db.query<{ id: string }>(
      "SELECT id FROM atlassian_favoris WHERE service = 'bitbucket' AND instance = ? AND genre = 'depot' AND cle = ?",
      [compte, cle],
    );
    if (existant.length > 0) {
      await db.execute("DELETE FROM atlassian_favoris WHERE id = ?", [existant[0].id]);
    } else {
      await db.execute(
        `INSERT INTO atlassian_favoris (id, service, instance, genre, cle, libelle, contexte, url)
         VALUES (?, 'bitbucket', ?, 'depot', ?, ?, ?, ?)`,
        [crypto.randomUUID(), compte, cle, depot.nom, depot.projetNom, depot.url],
      );
    }
    favoris.reload();
  }

  function ouvrirFichier(fichier: Fichier) {
    if (!compte || !cible || !fichier.chemin) return;
    void openSubpage({
      title: fichier.nom,
      subtitle: `${cible.projet} / ${cible.depot} · ${fichier.chemin} · ${brancheActive || "branche par défaut"}`,
      actions: [
        {
          label: "Expliquer ce fichier",
          icon: Lightbulb,
          onClick: async () => {
            const { contenu } = await functions.call<{ contenu: string }>("lire-fichier", {
              instance: compte,
              projet: cible.projet,
              depot: cible.depot,
              chemin: fichier.chemin,
              branche: brancheActive || undefined,
            });
            const { explication } = await expliquerFichier(fichier.chemin, contenu);
            return openModal({
              title: `Explication de ${fichier.nom}`,
              size: "wide",
              content: <Markdown>{explication}</Markdown>,
            });
          },
        },
      ],
      content: (
        <ContenuFichier
          instance={compte}
          projet={cible.projet}
          depot={cible.depot}
          chemin={fichier.chemin}
          branche={brancheActive}
          nom={fichier.nom}
        />
      ),
    });
  }

  const entreePr = { instance: compte, projet: prProjet, depot: prDepot, id: prNumero };

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
          Aucun compte Bitbucket n’est encore relié. Ouvrez Réglages, Modules, puis la fiche Atlassian pour ajouter
          l’adresse de votre Bitbucket et votre jeton personnel.
        </FeedbackBanner>
      </Page>
    );
  }

  // ——— Un dépôt, comme sur GitHub : Code, Pull requests, Branches, Commits ———
  if (vue === "depot" && cible) {
    const estFavori = clesFavorites.has(depotCle);
    const prs = prsDepot.data?.prs ?? [];
    const liste = fichiers.data?.fichiers ?? [];
    const readme = liste.find((f) => !f.dossier && /^readme(\.md|\.markdown|\.txt)?$/i.test(f.nom));
    const morceaux = chemin ? chemin.split("/") : [];

    let contenu;
    if (onglet === "code") {
      contenu = (
        <Stack gap="md">
          <Row gap="sm" justify="between" wrap>
            <Row gap="sm" wrap>
              <GitBranch size={16} aria-hidden="true" />
              <SelectControl
                aria-label="Branche"
                value={brancheActive}
                onChange={(evenement) => {
                  setBranche(evenement.target.value);
                  setChemin("");
                }}
              >
                {brancheActive && !branches.some((b) => b.nom === brancheActive) && (
                  <option value={brancheActive}>{brancheActive}</option>
                )}
                {branches.map((b) => (
                  <option key={b.nom} value={b.nom}>
                    {b.nom}
                  </option>
                ))}
              </SelectControl>
              <Link onClick={() => setOnglet("branches")}>{`${branches.length} branche${branches.length > 1 ? "s" : ""}`}</Link>
              {chemin && (
              <Row gap="xs" wrap>
                <Link onClick={() => setChemin("")}>{cible.depot}</Link>
                {morceaux.map((morceau, index) => (
                  <Row gap="xs" key={`${index}-${morceau}`}>
                    <Text as="span" tone="muted">
                      /
                    </Text>
                    {index === morceaux.length - 1 ? (
                      <Text as="span" weight="strong">
                        {morceau}
                      </Text>
                    ) : (
                      <Link onClick={() => setChemin(morceaux.slice(0, index + 1).join("/"))}>{morceau}</Link>
                    )}
                  </Row>
                ))}
              </Row>
              )}
            </Row>
            <Row gap="sm" wrap>
              <AllerAuFichier
                instance={compte}
                projet={cible.projet}
                depot={cible.depot}
                branche={brancheActive}
                onChoisir={(f) => ouvrirFichier({ nom: f.nom, chemin: f.chemin, dossier: false, taille: 0 })}
              />
              <Link onClick={() => setOnglet("commits")}>Historique</Link>
            </Row>
          </Row>
          <DernierCommit
            instance={compte}
            projet={cible.projet}
            depot={cible.depot}
            branche={brancheActive}
            chemin={chemin}
          />
          {fichiers.error ? (
            <FeedbackBanner tone="danger" action={<Button onClick={() => fichiers.reload()}>Réessayer</Button>}>
              {fichiers.error.message}
            </FeedbackBanner>
          ) : fichiers.loading && !fichiers.data ? (
            <LoadingSkeleton />
          ) : liste.length === 0 && !chemin ? (
            <EmptyState size="compact" title="Dépôt vide" />
          ) : (
            <ListeFichiers fichiers={liste} chemin={chemin} onDossier={setChemin} onFichier={ouvrirFichier} />
          )}
          {fichiers.data?.tronque && <Text size="meta">Liste partielle : ce dossier contient trop d’éléments.</Text>}
          {readme && (
            <Surface title={readme.nom}>
              <Readme
                instance={compte}
                projet={cible.projet}
                depot={cible.depot}
                branche={brancheActive}
                chemin={readme.chemin}
                nom={readme.nom}
              />
            </Surface>
          )}
        </Stack>
      );
    } else if (onglet === "prs") {
      contenu = (
        <ListePrs
          prs={prs}
          risques={risques}
          onOuvrir={(pr) => ouvrirPr({ ...pr, projet: cible.projet, depot: cible.depot }, "depot")}
        />
      );
    } else if (onglet === "branches") {
      contenu =
        branches.length === 0 ? (
          <EmptyState size="compact" title="Aucune branche" />
        ) : (
          <List label="Branches">
            {branches.map((b) => (
              <ListItem
                key={b.nom}
                leading={<GitBranch size={16} aria-hidden="true" />}
                title={b.nom}
                selected={b.nom === brancheActive}
                trailing={
                  <Row gap="sm">
                    {b.estDefaut && (
                      <StatusBadge tone="neutral" size="compact">
                        par défaut
                      </StatusBadge>
                    )}
                    {b.dernierCommit && <Code>{b.dernierCommit.slice(0, 11)}</Code>}
                  </Row>
                }
                onClick={() => {
                  setBranche(b.nom);
                  setChemin("");
                  setOnglet("code");
                }}
              />
            ))}
          </List>
        );
    } else {
      contenu =
        commits.loading && !commits.data ? <LoadingSkeleton /> : <ListeCommits commits={commits.data?.commits ?? []} />;
    }

    return (
      <Page
        header={{
          title: `${cible.projet} / ${depotInfo?.nom ?? cible.depot}`,
          subtitle: depotInfo?.description || depotInfo?.projetNom || undefined,
          status: depotInfo
            ? depotInfo.archive
              ? { label: "Archivé", tone: "warning" }
              : { label: depotInfo.public ? "Public" : "Privé", tone: "neutral" }
            : undefined,
          actions: [
            { label: "Retour aux dépôts", icon: ArrowLeft, onClick: retour },
            {
              label: estFavori ? "Retirer des favoris" : "Ajouter aux favoris",
              icon: Star,
              success: estFavori ? "Dépôt retiré des favoris" : "Dépôt ajouté aux favoris",
              onClick: () => (depotInfo ? basculerFavori(depotInfo) : undefined),
            },
            {
              label: "Cloner le dépôt",
              icon: Download,
              hidden: !depotInfo?.clones?.length,
              onClick: () =>
                openModal({
                  title: "Cloner le dépôt",
                  description: "Sélectionnez une adresse pour la copier dans votre outil Git.",
                  content: (
                    <Stack gap="md">
                      {(depotInfo?.clones ?? []).map((lien) => (
                        <Stack key={lien.nom} gap="xs">
                          <Text size="meta" tone="muted">
                            {lien.nom}
                          </Text>
                          <Code block label={`Adresse ${lien.nom}`}>{`git clone ${lien.url}`}</Code>
                        </Stack>
                      ))}
                    </Stack>
                  ),
                }),
            },
            {
              label: "Ouvrir dans Bitbucket",
              icon: ExternalLink,
              hidden: !depotInfo?.url,
              onClick: () => shell.openExternal(depotInfo?.url ?? ""),
            },
            {
              label: "Actualiser",
              onClick: () => {
                info.reload();
                fichiers.reload();
                prsDepot.reload();
                commits.reload();
              },
            },
          ],
        }}
      >
        <Stack gap="md">
          {info.error && (
            <FeedbackBanner tone="danger" action={<Button onClick={() => info.reload()}>Réessayer</Button>}>
              {info.error.message}
            </FeedbackBanner>
          )}
          {!info.loading && !depotInfo && !info.error ? (
            <EmptyState title="Dépôt introuvable" description="Il a peut-être été renommé ou vous n’y avez plus accès." />
          ) : (
            <>
              <Tabs<OngletDepot>
                label="Rubriques du dépôt"
                activeId={onglet}
                onChange={setOnglet}
                items={[
                  { id: "code", label: "Code" },
                  { id: "prs", label: `Pull requests (${prs.length})` },
                  { id: "branches", label: `Branches (${branches.length})` },
                  { id: "commits", label: "Commits" },
                ]}
              />
              {contenu}
            </>
          )}
        </Stack>
      </Page>
    );
  }

  // ——— Pull requests qui vous attendent, tous dépôts confondus ———
  if (vue === "prs") {
    return (
      <Page
        header={{
          title: "Pull requests à traiter",
          subtitle: "Celles où l’on vous demande une revue, tous dépôts confondus.",
          actions: [
            { label: "Retour aux dépôts", icon: ArrowLeft, onClick: retour },
            { label: "Actualiser", icon: RefreshCw, onClick: () => prsEntrantes.reload() },
          ],
        }}
      >
        <Stack gap="md">
          {prsEntrantes.error && (
            <FeedbackBanner tone="danger" action={<Button onClick={() => prsEntrantes.reload()}>Réessayer</Button>}>
              {prsEntrantes.error.message}
            </FeedbackBanner>
          )}
          {prsEntrantes.loading && !prsEntrantes.data ? (
            <LoadingSkeleton />
          ) : (
            <ListePrs prs={prsEntrantes.data?.prs ?? []} risques={risques} onOuvrir={(pr) => ouvrirPr(pr, "prs")} avecDepot />
          )}
        </Stack>
      </Page>
    );
  }

  // ——— Une pull request : Conversation, Commits, Fichiers modifiés ———
  if (vue === "pr") {
    const pr = detail.data?.pr ?? null;
    const commentaires = detail.data?.commentaires ?? [];
    const commitsPr = detail.data?.commits ?? [];
    const fichiersPr = changements.data?.fichiers ?? [];
    const ouverte = pr?.etat === "OPEN";

    async function contextePr(): Promise<ContextePr> {
      const { fichiers } = await functions.call<{ fichiers: Array<{ chemin: string; nature: string }> }>(
        "lister-changements-pr",
        { instance: compte, pr: prCible },
      );
      const diffs = [];
      for (const f of fichiers.slice(0, 15)) {
        const d = await functions
          .call<{ texte: string }>("lire-diff-pr", { instance: compte, pr: prCible, chemin: f.chemin })
          .catch(() => ({ texte: "" }));
        diffs.push({ chemin: f.chemin, nature: f.nature, texte: d.texte });
      }
      return {
        titre: pr?.titre ?? "",
        description: pr?.description ?? "",
        source: pr?.source ?? "",
        cible: pr?.cible ?? "",
        commits: commitsPr.map((c) => c.message.split("\n")[0]),
        diffs,
      };
    }

    const actionsAssistantPr: Action[] = [
      {
        label: "Analyser les risques",
        icon: ShieldAlert,
        onClick: async () => setAnalysePr({ pr: prCible, ...(await analyserPr(await contextePr())) }),
      },
      {
        label: "Proposer une revue",
        icon: ListChecks,
        onClick: async () => setRevue({ pr: prCible, ...(await revuePr(await contextePr())) }),
      },
      {
        label: "Rédiger la description",
        onClick: async () => {
          const { description } = await redigerDescriptionPr(await contextePr());
          return openForm({
            title: "Description proposée",
            description: "Relisez et ajustez avant de l’enregistrer sur la pull request.",
            fields: [{ name: "description", label: "Description", type: "textarea" }],
            initial: { description },
            submitLabel: "Enregistrer",
            success: "Description enregistrée",
            onSubmit: async (v) => {
              await functions.call("modifier-pr", { ...entreePr, version: pr?.version ?? 0, description: v.description });
              detail.reload();
            },
          });
        },
      },
      {
        label: "Confier la revue à l’assistant",
        icon: Bot,
        primary: true,
        onClick: () =>
          ai.startAgent({
            title: `Revue de ${pr?.titre ?? prCible}`,
            instruction: `Fais la revue de la pull request ${prCible} (compte « ${compte} ») : lis ses fichiers modifiés un par un, repère les bogues, les risques et les tests manquants, puis propose tes commentaires à l’utilisateur. Ne publie un commentaire, n’approuve ou ne fusionne qu’avec son accord. Passe toujours instance = « ${compte} » et pr = « ${prCible} » aux fonctions. Réponds en français.`,
            context: { titre: pr?.titre, description: pr?.description, source: pr?.source, cible: pr?.cible },
            functions: ["lire-pr", "lister-changements-pr", "lire-diff-pr", "commenter-pr", "approuver-pr", "lire-fichier", "lire-ticket"],
          }).then(() => detail.reload()),
      },
    ];

    let contenu;
    if (!pr) {
      contenu =
        detail.loading ? (
          <LoadingSkeleton />
        ) : (
          <EmptyState title="Pull request introuvable" description="Elle a peut-être été fusionnée ou supprimée." />
        );
    } else if (ongletPr === "conversation") {
      contenu = (
        <Grid minColumnWidth={320} gap="lg">
          <Stack gap="lg">
            <Section
              title="Assistant"
              description="Je lis les fichiers modifiés pour vous aider ; rien n’est publié sans votre accord."
              actions={actionsAssistantPr}
            >
              <Stack gap="md">
                {risques.get(prCible) ? (
                  <Row gap="sm">
                    <StatusBadge tone={RISQUES[risques.get(prCible)!.niveau]?.tone ?? "neutral"}>
                      {`${RISQUES[risques.get(prCible)!.niveau]?.label ?? "Risque"}${risques.get(prCible)!.aVerifier ? " (à vérifier)" : ""}`}
                    </StatusBadge>
                  </Row>
                ) : null}
                {analysePr?.pr === prCible && (
                  <Markdown>
                    {[
                      analysePr.resume,
                      "",
                      ...(analysePr.risques.length > 0
                        ? ["**Risques repérés**", ...analysePr.risques.map((r) => `- \`${r.fichier}\` (${r.gravite}) : ${r.risque}`), ""]
                        : ["Aucun risque particulier repéré.", ""]),
                      `**Conseil :** ${analysePr.conseil}`,
                    ].join("\n")}
                  </Markdown>
                )}
                {revue?.pr === prCible && (
                  <List label="Remarques de revue proposées">
                    {revue.commentaires.map((c, index) => (
                      <ListItem
                        key={`${c.fichier}-${index}`}
                        title={c.remarque}
                        description={c.fichier}
                        trailing={
                          <IconButton
                            label="Publier la remarque"
                            onClick={async () => {
                              await functions.call("commenter-pr", { ...entreePr, texte: `**${c.fichier}** : ${c.remarque}` });
                              setRevue({ ...revue, commentaires: revue.commentaires.filter((_, i) => i !== index) });
                              detail.reload();
                              void shell.notify({ title: "Remarque publiée", tone: "success" });
                            }}
                          >
                            <Send size={16} aria-hidden="true" />
                          </IconButton>
                        }
                      />
                    ))}
                  </List>
                )}
              </Stack>
            </Section>
            <Section title={`${pr.auteur} · ${quand(pr.cree)}`}>
              {pr.description ? (
                <Markdown onLink={(href) => void shell.openExternal(href)}>{pr.description}</Markdown>
              ) : (
                <Text tone="muted">Aucune description.</Text>
              )}
            </Section>
            {commentaires.map((commentaire) => (
              <Stack key={commentaire.id} gap="xs">
                <Row gap="sm">
                  <Avatar name={commentaire.auteur} size="sm" />
                  <Text as="span" weight="strong">
                    {commentaire.auteur}
                  </Text>
                  <Text as="span" size="meta" tone="muted">
                    {quand(commentaire.cree)}
                  </Text>
                </Row>
                <Markdown onLink={(href) => void shell.openExternal(href)}>{commentaire.texte || "(commentaire vide)"}</Markdown>
              </Stack>
            ))}
          </Stack>
          <Stack gap="lg">
            <Section title="Évaluateurs">
              {pr.evaluateurs.length > 0 ? (
                <List label="Évaluateurs">
                  {pr.evaluateurs.map((evaluateur) => (
                    <ListItem
                      key={evaluateur.nom}
                      leading={<Avatar name={evaluateur.nom} size="sm" />}
                      title={evaluateur.nom}
                      trailing={
                        <StatusBadge tone={AVIS[evaluateur.statut]?.tone ?? "neutral"} size="compact">
                          {AVIS[evaluateur.statut]?.label ?? evaluateur.statut}
                        </StatusBadge>
                      }
                    />
                  ))}
                </List>
              ) : (
                <Text tone="muted">Aucun évaluateur.</Text>
              )}
            </Section>
            <Section title="Branches">
              <Row gap="sm" wrap>
                <Code>{pr.source}</Code>
                <Text as="span" tone="muted">
                  →
                </Text>
                <Code>{pr.cible}</Code>
              </Row>
            </Section>
          </Stack>
        </Grid>
      );
    } else if (ongletPr === "commits") {
      contenu = <ListeCommits commits={commitsPr} />;
    } else {
      contenu =
        changements.loading && !changements.data ? (
          <LoadingSkeleton />
        ) : fichiersPr.length === 0 ? (
          <EmptyState size="compact" title="Aucun fichier modifié" />
        ) : (
          <Stack gap="lg">
            <Text size="meta" tone="muted">
              {`${fichiersPr.length} fichier${fichiersPr.length > 1 ? "s" : ""} modifié${fichiersPr.length > 1 ? "s" : ""}`}
              {fichiersPr.length > DIFFS_AFFICHES ? ` · les ${DIFFS_AFFICHES} premiers sont affichés` : ""}
            </Text>
            {fichiersPr.slice(0, DIFFS_AFFICHES).map((fichier) => (
              <DiffFichier key={fichier.chemin} instance={compte} pr={prCible} chemin={fichier.chemin} nature={fichier.nature} />
            ))}
          </Stack>
        );
    }

    return (
      <Page
        header={{
          title: pr ? `${pr.titre} #${pr.id}` : `Pull request #${prNumero}`,
          subtitle: pr
            ? `${pr.auteur} veut fusionner ${commitsPr.length} commit${commitsPr.length > 1 ? "s" : ""} de ${pr.source} vers ${pr.cible} · ${prProjet} / ${prDepot}`
            : `${prProjet} / ${prDepot}`,
          status: pr ? { label: ETATS_PR[pr.etat]?.label ?? pr.etat, tone: ETATS_PR[pr.etat]?.tone ?? "neutral" } : undefined,
          actions: [
            { label: "Retour", icon: ArrowLeft, onClick: retour },
            {
              label: "Approuver",
              icon: Check,
              hidden: !ouverte,
              success: "Pull request approuvée",
              onClick: () => functions.call("approuver-pr", { ...entreePr, action: "approuver" }).then(() => detail.reload()),
            },
            {
              label: "Commenter",
              icon: MessageSquare,
              hidden: !pr,
              onClick: () =>
                openForm({
                  title: "Commenter la pull request",
                  fields: [{ name: "texte", label: "Commentaire", type: "textarea" }],
                  submitLabel: "Publier",
                  success: "Commentaire ajouté",
                  onSubmit: async (valeurs) => {
                    await functions.call("commenter-pr", { ...entreePr, texte: valeurs.texte });
                    detail.reload();
                  },
                }),
            },
            {
              label: "Fusionner",
              icon: GitMerge,
              primary: true,
              hidden: !ouverte,
              confirm: pr ? `Fusionner « ${pr.titre} » dans ${pr.cible} ?` : "Fusionner cette pull request ?",
              success: "Pull request fusionnée",
              onClick: () => functions.call("fusionner-pr", { ...entreePr, version: pr?.version }).then(() => detail.reload()),
            },
            {
              label: "Retirer mon approbation",
              hidden: !ouverte,
              success: "Approbation retirée",
              onClick: () => functions.call("approuver-pr", { ...entreePr, action: "retirer" }).then(() => detail.reload()),
            },
            {
              label: "Ouvrir dans Bitbucket",
              icon: ExternalLink,
              hidden: !pr?.url,
              onClick: () => shell.openExternal(pr?.url ?? ""),
            },
            {
              label: "Refuser la pull request",
              icon: X,
              danger: true,
              hidden: !ouverte,
              confirm: pr ? `Refuser « ${pr.titre} » ?` : "Refuser cette pull request ?",
              confirmMessage: "Elle sera fermée sans être fusionnée.",
              success: "Pull request refusée",
              onClick: () => functions.call("refuser-pr", { ...entreePr, version: pr?.version ?? 0 }).then(() => detail.reload()),
            },
          ],
        }}
      >
        <Stack gap="md">
          {detail.error && (
            <FeedbackBanner tone="danger" action={<Button onClick={() => detail.reload()}>Réessayer</Button>}>
              {detail.error.message}
            </FeedbackBanner>
          )}
          {pr && (
            <Tabs<OngletPr>
              label="Rubriques de la pull request"
              activeId={ongletPr}
              onChange={setOngletPr}
              items={[
                { id: "conversation", label: `Conversation (${commentaires.length})` },
                { id: "commits", label: `Commits (${commitsPr.length})` },
                { id: "fichiers", label: "Fichiers modifiés" },
              ]}
            />
          )}
          {contenu}
        </Stack>
      </Page>
    );
  }

  // ——— La liste des dépôts ———
  const tous = depots.data?.depots ?? [];
  const lignes =
    filtre === "favoris"
      ? [
          ...tous.filter((d) => clesFavorites.has(`${d.projet}/${d.slug}`)),
          ...(favoris.data ?? [])
            .filter((f) => !tous.some((d) => `${d.projet}/${d.slug}` === f.cle))
            .filter((f) => !recherche.trim() || f.libelle.toLowerCase().includes(recherche.trim().toLowerCase()))
            .map((f) => {
              const { projet, depot } = separerDepot(f.cle);
              return {
                slug: depot,
                nom: f.libelle,
                description: "",
                projet,
                projetNom: f.contexte ?? projet,
                archive: false,
                brancheDefaut: null,
                url: f.url,
              } as Depot;
            }),
        ]
      : tous;

  return (
    <Page
      search={{
        label: "Rechercher un dépôt",
        value: recherche,
        onChange: setRecherche,
      }}
      bar={
        <Row gap="sm" wrap>
          <ChoiceGroup label="Dépôts affichés" appearance="segmented">
            <ChoiceButton label="Tous" variant="label" size="compact" selected={filtre === "tous"} onClick={() => setFiltre("tous")}>
              Tous
            </ChoiceButton>
            <ChoiceButton
              label={`Favoris (${clesFavorites.size})`}
              variant="label"
              size="compact"
              selected={filtre === "favoris"}
              onClick={() => setFiltre("favoris")}
            >
              {`Favoris (${clesFavorites.size})`}
            </ChoiceButton>
          </ChoiceGroup>
          {listeComptes.length > 1 && (
            <SelectControl aria-label="Compte Bitbucket" value={compte} onChange={(e) => changerCompte(e.target.value)}>
              {listeComptes.map((element) => (
                <option key={element.id} value={element.id}>
                  {element.label}
                </option>
              ))}
            </SelectControl>
          )}
        </Row>
      }
      actions={[
        { label: "Pull requests à traiter", icon: GitPullRequest, onClick: () => setVue("prs") },
        {
          label: "Actualiser",
          icon: RefreshCw,
          onClick: () => {
            depots.reload();
            favoris.reload();
          },
        },
      ]}
    >
      <Stack gap="md">
        {depots.error && (
          <FeedbackBanner tone="danger" action={<Button onClick={() => depots.reload()}>Réessayer</Button>}>
            {depots.error.message}
          </FeedbackBanner>
        )}
        {depots.loading && !depots.data ? (
          <LoadingSkeleton />
        ) : lignes.length === 0 ? (
          <EmptyState
            title={filtre === "favoris" ? "Aucun dépôt favori" : "Aucun dépôt"}
            description={
              filtre === "favoris"
                ? "Ouvrez un dépôt puis l’étoile pour le retrouver ici."
                : "Aucun dépôt ne correspond à cette recherche."
            }
          />
        ) : (
          <List label="Dépôts">
            {lignes.map((depot) => {
              const cle = `${depot.projet}/${depot.slug}`;
              return (
                <ListItem
                  key={cle}
                  leading={<BookMarked size={16} aria-hidden="true" />}
                  title={
                    <Row gap="sm">
                      <Text as="span" weight="strong">{`${depot.projet} / ${depot.nom}`}</Text>
                      <StatusBadge tone={depot.archive ? "warning" : "neutral"} size="compact">
                        {depot.archive ? "Archivé" : depot.public ? "Public" : "Privé"}
                      </StatusBadge>
                    </Row>
                  }
                  description={depot.description || depot.projetNom || undefined}
                  trailing={
                    <Row gap="sm">
                      {clesFavorites.has(cle) && <Star size={14} aria-label="Favori" />}
                      <Text as="span" size="meta" tone="muted">
                        {depot.projetNom}
                      </Text>
                    </Row>
                  }
                  onClick={() => ouvrirDepot(cle)}
                />
              );
            })}
          </List>
        )}
      </Stack>
    </Page>
  );
}
