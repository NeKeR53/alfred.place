import { Row, Stack, Text } from "@alfred/kit";
import { db, notifyActionError, shell, useAsync, usePageContext, usePageState, usePeerMessage } from "@alfred/sdk";
import { Download, ExternalLink, Lightbulb, RefreshCw, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { ActionBar, Button, Code, Modal, Link, List, Page, PageSection, Select, TabPanel, Tabs } from "socle-ui";
import { Markdown } from "socle-ui/markdown";
import { expliquerFichier } from "../lib/assistant";
import { type Branche, type Depot, ListePrs, lireVueDepot, type Pr, separerDepot } from "../lib/bitbucket-commun";
import { AllerAuFichier, type Commit, ContenuFichier, DernierCommit, type Fichier, ListeCommits, ListeFichiers, Readme } from "../lib/bitbucket-vues";
import { useEtat } from "../lib/etat";
import { PullRequestModale } from "../lib/pull-request-modale";
import { useJugements } from "../lib/progressif";

type Fenetre =
  | { kind: "fichier"; fichier: Fichier }
  | { kind: "explication"; fichier: Fichier; texte: string }
  | { kind: "branche"; branche: Branche }
  | { kind: "cloner"; liens: Array<{ nom: string; url: string }> };

type OngletDepot = "code" | "prs" | "branches" | "commits";

export default function DepotOuvert() {
  const contexte = usePageContext();
  if (!contexte) return <Page state="loading">{null}</Page>;
  const ouverture = lireVueDepot(contexte.view?.params);
  if (ouverture) return <FicheDepot {...ouverture} />;
  return (
    <Page>
      <PageSection title="Dépôts" empty={{ title: "Aucun dépôt ouvert", description: "Choisissez un dépôt dans Dépôts ou Favoris." }}>
        {null}
      </PageSection>
    </Page>
  );
}

function FicheDepot({ instance: compte, depot: depotCle }: { instance: string; depot: string }) {
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const [prOuverte, setPrOuverte] = useState<Pr | null>(null);
  const memoire = `${compte}|${depotCle}`;
  const [onglet, setOnglet] = usePageState<OngletDepot>(`onglet:${memoire}`, "code");
  const [branche, setBranche] = usePageState<string>(`branche:${memoire}`, "");
  const [chemin, setChemin] = usePageState<string>(`chemin:${memoire}`, "");

  useEffect(() => {
    void shell.setPanelVisible(true);
  }, []);

  usePeerMessage((message) => {
    const aller = (message as { aller?: string } | null)?.aller;
    if (aller === "branches" || aller === "prs") setOnglet(aller);
  });

  const favoris = useAsync(
    () =>
      compte
        ? db.query<{ cle: string }>("SELECT cle FROM atlassian_favoris WHERE service = 'bitbucket' AND instance = ?", [compte])
        : Promise.resolve([] as Array<{ cle: string }>),
    [compte],
  );
  const clesFavorites = new Set((Array.isArray(favoris.data) ? favoris.data : []).map((favori) => favori.cle));

  const cible = separerDepot(depotCle);
  const info = useEtat<{ depot: Depot | null; branches: Branche[] }>(
    "depot",
    compte ? { instance: compte, projet: cible.projet, depot: cible.depot } : null,
  );
  const depotInfo = info.data?.depot ?? null;
  const branches = info.data?.branches ?? [];
  const brancheActive = branche || depotInfo?.brancheDefaut || "";

  const fichiers = useEtat<{ chemin: string; fichiers: Fichier[]; tronque: boolean }>(
    "fichiers-depot",
    onglet === "code"
      ? { instance: compte, projet: cible.projet, depot: cible.depot, chemin, branche: brancheActive || undefined }
      : null,
  );

  const prsDepot = useEtat<{ prs: Pr[] }>(
    "pull-requests",
    compte
      ? { instance: compte, projet: cible.projet, depot: cible.depot, etat: "OPEN", role: "ALL", limite: 50 }
      : null,
  );

  const commits = useEtat<{ commits: Commit[] }>(
    "commits",
    onglet === "commits"
      ? { instance: compte, projet: cible.projet, depot: cible.depot, branche: brancheActive || undefined, limite: 50 }
      : null,
  );

  // Risque des pull requests affichées, jugé sur l’ordinateur.
  const prsAJuger = (prsDepot.data?.prs ?? []).map((pr) => ({
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

  const reussi = (title: string) => shell.notify({ title, tone: "success" });

  const modale =
    fenetre?.kind === "explication" ? (
      <Modal
        isOpen
        size="lg"
        title={`Explication de ${fenetre.fichier.nom}`}
        onOpenChange={(ouverte) => {
          if (!ouverte) setFenetre(null);
        }}
        footer={<Button onPress={() => setFenetre({ kind: "fichier", fichier: fenetre.fichier })}>Retour au fichier</Button>}
      >
        <Markdown>{fenetre.texte}</Markdown>
      </Modal>
    ) : fenetre?.kind === "cloner" ? (
      <Modal
        isOpen
        title="Cloner le dépôt"
        description="Sélectionnez une adresse pour la copier dans votre outil Git."
        onOpenChange={(ouverte) => {
          if (!ouverte) setFenetre(null);
        }}
        footer={<Button onPress={() => setFenetre(null)}>Fermer</Button>}
      >
        <Stack gap="md">
          {fenetre.liens.map((lien) => (
            <Stack key={lien.nom} gap="xs">
              <Text size="meta" tone="muted">
                {lien.nom}
              </Text>
              <Code block label={`Adresse ${lien.nom}`}>{`git clone ${lien.url}`}</Code>
            </Stack>
          ))}
        </Stack>
      </Modal>
    ) : null;

  const fichier = fenetre?.kind === "fichier" ? fenetre.fichier : null;
  const brancheOuverte = fenetre?.kind === "branche" ? fenetre.branche : null;
  // Le texte du fichier ouvert, pour l’expliquer sans le relire.
  const texteFichier = useEtat<{ contenu: string }>(
    "fichier-depot",
    fichier
      ? { instance: compte, projet: cible.projet, depot: cible.depot, chemin: fichier.chemin, branche: brancheActive || undefined }
      : null,
  );

  // ——— Un dépôt, comme sur GitHub : Code, Pull requests, Branches, Commits ———
  const estFavori = clesFavorites.has(depotCle);
  const prs = prsDepot.data?.prs ?? [];
  const liste = fichiers.data?.fichiers ?? [];
  const readme = liste.find((f) => !f.dossier && /^readme(\.md|\.markdown|\.txt)?$/i.test(f.nom));
  const morceaux = chemin ? chemin.split("/") : [];
  const statut = depotInfo ? (depotInfo.archive ? "Archivé" : depotInfo.public ? "Public" : "Privé") : null;

  let contenu;
  if (onglet === "code") {
    contenu = (
      <>
        <PageSection
          title={chemin ? `${cible.depot} / ${chemin}` : "Code"}
          description={`${branches.length} branche${branches.length > 1 ? "s" : ""} · ${prs.length} pull request${prs.length > 1 ? "s" : ""}`}
          state={fichiers.error ? "error" : fichiers.data ? "ready" : "loading"}
          onRetry={fichiers.reload}
          empty={fichiers.data && liste.length === 0 && !chemin ? { title: "Dépôt vide" } : undefined}
        >
          <Stack gap="md">
            <Row gap="sm" justify="between" wrap>
              <Row gap="sm" wrap>
                <Select
                  label="Branche"
                  hideLabel
                  width="sm"
                  value={brancheActive || null}
                  options={[
                    ...(brancheActive && !branches.some((b) => b.nom === brancheActive) ? [{ id: brancheActive, label: brancheActive }] : []),
                    ...branches.map((b) => ({ id: b.nom, label: b.nom })),
                  ]}
                  onChange={(id) => {
                    if (!id) return;
                    setBranche(id);
                    setChemin("");
                  }}
                />
                {chemin ? (
                  <Row gap="xs" wrap>
                    <Link onPress={() => setChemin("")}>{cible.depot}</Link>
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
                          <Link onPress={() => setChemin(morceaux.slice(0, index + 1).join("/"))}>{morceau}</Link>
                        )}
                      </Row>
                    ))}
                  </Row>
                ) : null}
              </Row>
              <AllerAuFichier
                instance={compte}
                projet={cible.projet}
                depot={cible.depot}
                branche={brancheActive}
                onChoisir={(f) => setFenetre({ kind: "fichier", fichier: { ...f, dossier: false, taille: 0 } })}
              />
            </Row>
            <DernierCommit instance={compte} projet={cible.projet} depot={cible.depot} branche={brancheActive} chemin={chemin} />
            <ListeFichiers fichiers={liste} chemin={chemin} onDossier={setChemin} onFichier={(fichier) => setFenetre({ kind: "fichier", fichier })} />
            {fichiers.data?.tronque ? <Text size="meta">Liste partielle : ce dossier contient trop d’éléments.</Text> : null}
          </Stack>
        </PageSection>
        {readme ? (
          <PageSection title={readme.nom}>
            <Readme
              instance={compte}
              projet={cible.projet}
              depot={cible.depot}
              branche={brancheActive}
              chemin={readme.chemin}
              nom={readme.nom}
            />
          </PageSection>
        ) : null}
      </>
    );
  } else if (onglet === "prs") {
    contenu = (
      <PageSection title={`Pull requests (${prs.length})`}>
        <ListePrs prs={prs} risques={risques} onOuvrir={(pr) => setPrOuverte({ ...pr, projet: cible.projet, depot: cible.depot })} />
      </PageSection>
    );
  } else if (onglet === "branches") {
    contenu = (
      <PageSection title={`Branches (${branches.length})`} empty={branches.length === 0 ? { title: "Aucune branche" } : undefined}>
        <List
          label="Branches"
          selectionMode="none"
          items={branches.map((b) => ({
            id: b.nom,
            title: b.nom,
            subtitle: b.dernierCommit ? b.dernierCommit.slice(0, 11) : undefined,
            meta: b.nom === brancheActive ? "Affichée" : undefined,
            status: b.estDefaut ? { label: "par défaut", tone: "neutral" as const } : undefined,
          }))}
          onAction={(id) => {
            const branche = branches.find((element) => element.nom === id);
            if (branche) setFenetre({ kind: "branche", branche });
          }}
        />
      </PageSection>
    );
  } else {
    contenu = (
      <PageSection
        title="Commits"
        state={commits.error ? "error" : commits.data ? "ready" : "loading"}
        onRetry={commits.reload}
      >
        <ListeCommits commits={commits.data?.commits ?? []} />
      </PageSection>
    );
  }

  return (
    <Page state={info.error ? "error" : "ready"} onRetry={info.reload}>
      <PageSection
        title={`${cible.projet} / ${depotInfo?.nom ?? cible.depot}`}
        description={[depotInfo?.description || depotInfo?.projetNom, statut].filter(Boolean).join(" · ") || undefined}
        empty={
          !info.loading && !depotInfo && !info.error
            ? { title: "Dépôt introuvable", description: "Il a peut-être été renommé ou vous n’y avez plus accès." }
            : undefined
        }
      >
        <Row gap="sm" justify="between" wrap>
          <Tabs
            id="rubriques-depot"
            pageTitle={depotInfo?.nom ?? cible.depot}
            items={[
              { id: "code", label: "Code" },
              { id: "prs", label: `Pull requests (${prs.length})` },
              { id: "branches", label: `Branches (${branches.length})` },
              { id: "commits", label: "Commits" },
            ]}
            selectedId={onglet}
            onSelectionChange={(id) => setOnglet(id as OngletDepot)}
          />
          <ActionBar
            zone="toolbar"
            subject={`${cible.projet} / ${depotInfo?.nom ?? cible.depot}`}
            onError={notifyActionError}
            actions={[
              {
                id: "favori",
                label: estFavori ? "Retirer des favoris" : "Ajouter aux favoris",
                icon: <Star size={16} />,
                onPress: async () => {
                  if (!depotInfo) return;
                  await basculerFavori(depotInfo);
                  reussi(estFavori ? "Dépôt retiré des favoris" : "Dépôt ajouté aux favoris");
                },
              },
              {
                id: "cloner",
                label: "Cloner le dépôt",
                icon: <Download size={16} />,
                isHidden: !depotInfo?.clones?.length,
                onPress: () => setFenetre({ kind: "cloner", liens: depotInfo?.clones ?? [] }),
              },
              {
                id: "bitbucket",
                label: "Ouvrir dans Bitbucket",
                icon: <ExternalLink size={16} />,
                isHidden: !depotInfo?.url,
                onPress: () => shell.openExternal(depotInfo?.url ?? ""),
              },
              {
                id: "actualiser",
                label: "Actualiser",
                icon: <RefreshCw size={16} />,
                onPress: () => {
                  info.reload();
                  fichiers.reload();
                  prsDepot.reload();
                  commits.reload();
                },
              },
            ]}
          />
        </Row>
      </PageSection>
      <TabPanel tabs="rubriques-depot">{depotInfo || info.loading ? contenu : null}</TabPanel>
      {fichier ? (
        <Modal
          isOpen
          size="lg"
          title={fichier.nom}
          description={[fichier.chemin, brancheActive].filter(Boolean).join(" · ")}
          onOpenChange={(ouverte) => { if (!ouverte) setFenetre(null); }}
          footer={<Button onPress={() => setFenetre(null)}>Fermer</Button>}
        >
          <Stack gap="md">
            <ActionBar
              zone="section"
              subject={fichier.nom}
              onError={notifyActionError}
              actions={[{
                id: "expliquer",
                label: "Expliquer ce fichier",
                icon: <Lightbulb size={16} />,
                onPress: async () => {
                  if (texteFichier.error) throw texteFichier.error;
                  const contenu = texteFichier.data?.contenu;
                  if (contenu === undefined) throw new Error("Le fichier est encore en lecture : réessayez dans un instant.");
                  const { explication } = await expliquerFichier(fichier.chemin, contenu);
                  setFenetre((actuelle) => actuelle?.kind === "fichier" && actuelle.fichier === fichier
                    ? { kind: "explication", fichier, texte: explication }
                    : actuelle);
                },
              }]}
            />
            <ContenuFichier
              instance={compte}
              projet={cible.projet}
              depot={cible.depot}
              chemin={fichier.chemin}
              branche={brancheActive}
              nom={fichier.nom}
            />
          </Stack>
        </Modal>
      ) : null}
      {brancheOuverte ? (
        <Modal
          isOpen
          title={brancheOuverte.nom}
          description={brancheOuverte.estDefaut ? "Branche par défaut" : undefined}
          onOpenChange={(ouverte) => { if (!ouverte) setFenetre(null); }}
          footer={
            <>
              <Button onPress={() => setFenetre(null)}>Fermer</Button>
              <Button variant="primary" onPress={() => {
                setBranche(brancheOuverte.nom);
                setChemin("");
                setOnglet("code");
                setFenetre(null);
              }}>Afficher le code</Button>
            </>
          }
        >
          {brancheOuverte.dernierCommit ? (
            <Code block label="Dernier commit">{brancheOuverte.dernierCommit}</Code>
          ) : null}
        </Modal>
      ) : null}
      {prOuverte ? (
        <PullRequestModale
          instance={compte}
          cible={prOuverte}
          risque={risques.get(`${depotCle}/${prOuverte.id}`)}
          onClose={() => setPrOuverte(null)}
          onChange={prsDepot.reload}
        />
      ) : null}
      {modale}
    </Page>
  );
}
