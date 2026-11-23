import { Row, Stack, Text } from "@alfred/kit";
import { ai, db, functions, notifyActionError, shell, useAsync, usePageState, usePeerMessage } from "@alfred/sdk";
import {
  Bot,
  Check,
  Download,
  ExternalLink,
  GitMerge,
  Lightbulb,
  ListChecks,
  MessageSquare,
  RefreshCw,
  Send,
  ShieldAlert,
  Star,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  type Action,
  Button,
  Code,
  DetailPage,
  Dialog,
  Link,
  List,
  Page,
  PageSection,
  RadioGroup,
  Select,
  StatusBadge,
  useOpenForm,
} from "socle-ui";
import { Markdown } from "socle-ui/markdown";
import { quand } from "../lib/affichage";
import { analyserPr, type ContextePr, expliquerFichier, redigerDescriptionPr, revuePr } from "../lib/assistant";
import {
  type Branche,
  type CommentairePr,
  type Depot,
  ListePrs,
  lireOuverture,
  type Pr,
  RISQUES,
  separerDepot,
} from "../lib/bitbucket-commun";
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
import { useJugements } from "../lib/progressif";

/** Modale ouverte sur la page : l’explication d’un fichier, ou les adresses de clonage. */
type Fenetre = { kind: "explication"; titre: string; texte: string } | { kind: "cloner"; liens: Array<{ nom: string; url: string }> };

type OngletDepot = "code" | "prs" | "branches" | "commits";
type OngletPr = "conversation" | "commits" | "fichiers";

const DIFFS_AFFICHES = 25;

/** Onglet « Dépôt ouvert » : le dépôt choisi dans « Dépôts », « Favoris » ou « À traiter », et ses pull requests. */
export default function DepotOuvert() {
  const openForm = useOpenForm();
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const [fichierOuvert, setFichierOuvert] = useState<Fichier | null>(null);
  const ouverture = useAsync(() => lireOuverture(), []);
  const o = ouverture.data ?? null;
  const compte = o?.instance ?? "";
  const depotCle = o?.depot ?? "";

  const [vu, setVu] = usePageState<number>("depot.ouvertLe", 0);
  const [vue, setVue] = usePageState<"depot" | "pr">("depot.vue", "depot");
  const [onglet, setOnglet] = usePageState<OngletDepot>("depot.onglet", "code");
  const [branche, setBranche] = usePageState<string>("depot.branche", "");
  const [chemin, setChemin] = usePageState<string>("depot.chemin", "");
  const [prCible, setPrCible] = usePageState<string>("depot.pr", "");
  const [ongletPr, setOngletPr] = usePageState<OngletPr>("depot.ongletPr", "conversation");
  const neuf = Boolean(o) && o!.ouvertLe !== vu;

  // Un dépôt (ou une pull request) qu’on vient d’ouvrir depuis un autre onglet : on repart de son début.
  useEffect(() => {
    if (!o || o.ouvertLe === vu) return;
    setBranche("");
    setChemin("");
    setOnglet(o.pr ? "prs" : "code");
    setOngletPr("conversation");
    setPrCible(o.pr ?? "");
    setVue(o.pr ? "pr" : "depot");
    setVu(o.ouvertLe);
    void shell.setPanelVisible(true);
  }, [o?.ouvertLe]);

  // La colonne « À propos » suit le dépôt ouvert.
  useEffect(() => {
    if (compte && depotCle) void shell.publish({ id: `${compte}|${depotCle}` });
  }, [compte, depotCle]);

  // Le panneau « À propos » demande d’ouvrir les branches ou les pull requests du dépôt.
  usePeerMessage((message) => {
    const aller = (message as { aller?: string } | null)?.aller;
    if (aller !== "branches" && aller !== "prs") return;
    setVue("depot");
    setOnglet(aller);
  });

  const favoris = useAsync(
    () =>
      compte
        ? db.query<{ cle: string }>("SELECT cle FROM atlassian_favoris WHERE service = 'bitbucket' AND instance = ?", [compte])
        : Promise.resolve([] as Array<{ cle: string }>),
    [compte],
  );
  const clesFavorites = new Set((Array.isArray(favoris.data) ? favoris.data : []).map((favori) => favori.cle));

  const cible = depotCle ? separerDepot(depotCle) : null;
  const info = useAsync(
    () =>
      compte && cible && !neuf
        ? functions.call<{ depot: Depot | null; branches: Branche[] }>("lire-depot", {
            instance: compte,
            projet: cible.projet,
            depot: cible.depot,
          })
        : Promise.resolve({ depot: null, branches: [] as Branche[] }),
    [compte, depotCle, neuf],
  );
  const depotInfo = info.data?.depot ?? null;
  const branches = info.data?.branches ?? [];
  const brancheActive = branche || depotInfo?.brancheDefaut || "";

  const fichiers = useAsync(
    () =>
      compte && cible && !neuf && vue === "depot"
        ? functions.call<{ chemin: string; fichiers: Fichier[]; tronque: boolean }>("lister-fichiers", {
            instance: compte,
            projet: cible.projet,
            depot: cible.depot,
            chemin,
            branche: brancheActive || undefined,
          })
        : Promise.resolve({ chemin: "", fichiers: [] as Fichier[], tronque: false }),
    [compte, depotCle, chemin, brancheActive, vue, neuf],
  );

  const prsDepot = useAsync(
    () =>
      compte && cible && !neuf
        ? functions.call<{ prs: Pr[] }>("lister-prs", {
            instance: compte,
            projet: cible.projet,
            depot: cible.depot,
            etat: "OPEN",
            role: "ALL",
            limite: 50,
          })
        : Promise.resolve({ prs: [] as Pr[] }),
    [compte, depotCle, neuf],
  );

  const commits = useAsync(
    () =>
      compte && cible && !neuf && vue === "depot" && onglet === "commits"
        ? functions.call<{ commits: Commit[] }>("lister-commits", {
            instance: compte,
            projet: cible.projet,
            depot: cible.depot,
            branche: brancheActive || undefined,
            limite: 50,
          })
        : Promise.resolve({ commits: [] as Commit[] }),
    [compte, depotCle, brancheActive, vue, onglet, neuf],
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
    [compte, vue, prCible, neuf],
  );

  const changements = useAsync(
    () =>
      compte && vue === "pr" && prNumero && ongletPr === "fichiers"
        ? functions.call<{ fichiers: Array<{ chemin: string; nature: string }> }>("lister-changements-pr", {
            instance: compte,
            pr: prCible,
          })
        : Promise.resolve({ fichiers: [] as Array<{ chemin: string; nature: string }> }),
    [compte, vue, prCible, ongletPr, neuf],
  );


  function ouvrirPr(pr: Pr) {
    setPrCible(`${pr.projet}/${pr.depot}/${pr.id}`);
    setOngletPr("conversation");
    setVue("pr");
  }

  function retour() {
    setVue("depot");
    setOnglet("prs");
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

  const entreePr = { instance: compte, projet: prProjet, depot: prDepot, id: prNumero };

  const reussi = (title: string) => shell.notify({ title, tone: "success" });

  const modale =
    fenetre?.kind === "explication" ? (
      <Dialog
        isOpen
        size="lg"
        title={fenetre.titre}
        onOpenChange={(ouverte) => {
          if (!ouverte) setFenetre(null);
        }}
        footer={<Button onPress={() => setFenetre(null)}>Fermer</Button>}
      >
        <Markdown>{fenetre.texte}</Markdown>
      </Dialog>
    ) : fenetre?.kind === "cloner" ? (
      <Dialog
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
      </Dialog>
    ) : null;

  if (ouverture.loading && !ouverture.data) return <Page state="loading">{null}</Page>;

  if (!o || !cible) {
    return (
      <Page width="text">
        <PageSection
          title="Dépôt ouvert"
          empty={{
            title: "Aucun dépôt ouvert",
            description:
              "Choisissez un dépôt dans l’onglet Dépôts ou Favoris, ou une pull request dans l’onglet À traiter : il s’ouvrira ici.",
          }}
        >
          {null}
        </PageSection>
      </Page>
    );
  }

  if (neuf) return <Page state="loading">{null}</Page>;

  // ——— Un fichier ouvert, à la place de la liste ———
  if (fichierOuvert) {
    const fichier = fichierOuvert;
    return (
      <DetailPage
        title={fichier.nom}
        back={{ label: `${cible.projet} / ${cible.depot}`, onPress: () => setFichierOuvert(null) }}
        meta={[fichier.chemin, brancheActive || "branche par défaut"]}
        width="full"
        actions={[
          {
            id: "expliquer",
            label: "Expliquer ce fichier",
            icon: <Lightbulb size={16} />,
            onPress: async () => {
              const { contenu } = await functions.call<{ contenu: string }>("lire-fichier", {
                instance: compte,
                projet: cible.projet,
                depot: cible.depot,
                chemin: fichier.chemin,
                branche: brancheActive || undefined,
              });
              const { explication } = await expliquerFichier(fichier.chemin, contenu);
              setFenetre({ kind: "explication", titre: `Explication de ${fichier.nom}`, texte: explication });
            },
          },
        ]}
        onActionError={notifyActionError}
      >
        <DetailPage.Section title="Contenu">
          <ContenuFichier
            instance={compte}
            projet={cible.projet}
            depot={cible.depot}
            chemin={fichier.chemin}
            branche={brancheActive}
            nom={fichier.nom}
          />
        </DetailPage.Section>
        {modale}
      </DetailPage>
    );
  }

  // ——— Une pull request : Conversation, Commits, Fichiers modifiés ———
  if (vue === "pr") {
    const pr = detail.data?.pr ?? null;
    const commentaires = detail.data?.commentaires ?? [];
    const commitsPr = detail.data?.commits ?? [];
    const fichiersPr = changements.data?.fichiers ?? [];
    const ouverte = pr?.etat === "OPEN";
    const risque = risques.get(prCible);

    async function contextePr(): Promise<ContextePr> {
      const { fichiers: liste } = await functions.call<{ fichiers: Array<{ chemin: string; nature: string }> }>(
        "lister-changements-pr",
        { instance: compte, pr: prCible },
      );
      const diffs = [];
      for (const f of liste.slice(0, 15)) {
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
        id: "risques",
        label: "Analyser les risques",
        icon: <ShieldAlert size={16} />,
        onPress: async () => setAnalysePr({ pr: prCible, ...(await analyserPr(await contextePr())) }),
      },
      {
        id: "revue",
        label: "Proposer une revue",
        icon: <ListChecks size={16} />,
        onPress: async () => setRevue({ pr: prCible, ...(await revuePr(await contextePr())) }),
      },
      {
        id: "description",
        label: "Rédiger la description",
        onPress: async () => {
          const { description } = await redigerDescriptionPr(await contextePr());
          await openForm({
            title: "Description proposée",
            description: "Relisez et ajustez avant de l’enregistrer sur la pull request.",
            fields: [{ name: "description", label: "Description", type: "textarea", minRows: 8 }],
            initialValues: { description },
            submitLabel: "Enregistrer",
            onSubmit: async (v) => {
              await functions.call("modifier-pr", { ...entreePr, version: pr?.version ?? 0, description: v.description });
              reussi("Description enregistrée");
              detail.reload();
            },
          });
        },
      },
      {
        id: "agent",
        label: "Confier la revue à l’assistant",
        icon: <Bot size={16} />,
        primary: true,
        onPress: () =>
          ai
            .startAgent({
              title: `Revue de ${pr?.titre ?? prCible}`,
              instruction: `Fais la revue de la pull request ${prCible} (compte « ${compte} ») : lis ses fichiers modifiés un par un, repère les bogues, les risques et les tests manquants, puis propose tes commentaires à l’utilisateur. Ne publie un commentaire, n’approuve ou ne fusionne qu’avec son accord. Passe toujours instance = « ${compte} » et pr = « ${prCible} » aux fonctions. Réponds en français.`,
              context: { titre: pr?.titre, description: pr?.description, source: pr?.source, cible: pr?.cible },
              functions: ["lire-pr", "lister-changements-pr", "lire-diff-pr", "commenter-pr", "approuver-pr", "lire-fichier", "lire-ticket"],
            })
            .then(() => detail.reload()),
      },
    ];

    const actionsPr: Action[] = [
      {
        id: "fusionner",
        label: "Fusionner",
        icon: <GitMerge size={16} />,
        primary: true,
        isHidden: !ouverte,
        confirm: {
          title: pr ? `Fusionner « ${pr.titre} » dans ${pr.cible} ?` : "Fusionner cette pull request ?",
          confirmLabel: "Fusionner",
        },
        onPress: async () => {
          await functions.call("fusionner-pr", { ...entreePr, version: pr?.version });
          reussi("Pull request fusionnée");
          detail.reload();
        },
      },
      {
        id: "approuver",
        label: "Approuver",
        icon: <Check size={16} />,
        isHidden: !ouverte,
        onPress: async () => {
          await functions.call("approuver-pr", { ...entreePr, action: "approuver" });
          reussi("Pull request approuvée");
          detail.reload();
        },
      },
      {
        id: "commenter",
        label: "Commenter",
        icon: <MessageSquare size={16} />,
        isHidden: !pr,
        onPress: () =>
          openForm({
            title: "Commenter la pull request",
            fields: [{ name: "texte", label: "Commentaire", type: "textarea", isRequired: true }],
            submitLabel: "Publier",
            onSubmit: async (valeurs) => {
              await functions.call("commenter-pr", { ...entreePr, texte: valeurs.texte });
              reussi("Commentaire ajouté");
              detail.reload();
            },
          }),
      },
      {
        id: "retirer-approbation",
        label: "Retirer mon approbation",
        isHidden: !ouverte,
        onPress: async () => {
          await functions.call("approuver-pr", { ...entreePr, action: "retirer" });
          reussi("Approbation retirée");
          detail.reload();
        },
      },
      {
        id: "bitbucket",
        label: "Ouvrir dans Bitbucket",
        icon: <ExternalLink size={16} />,
        isHidden: !pr?.url,
        onPress: () => shell.openExternal(pr?.url ?? ""),
      },
      {
        id: "refuser",
        label: "Refuser la pull request",
        icon: <X size={16} />,
        danger: true,
        isHidden: !ouverte,
        confirm: {
          title: pr ? `Refuser « ${pr.titre} » ?` : "Refuser cette pull request ?",
          message: "Elle sera fermée sans être fusionnée.",
          confirmLabel: "Refuser",
        },
        onPress: async () => {
          await functions.call("refuser-pr", { ...entreePr, version: pr?.version ?? 0 });
          reussi("Pull request refusée");
          detail.reload();
        },
      },
    ];

    const sections = !pr ? null : ongletPr === "conversation" ? (
      <>
        <DetailPage.Section
          title="Assistant"
          description="Je lis les fichiers modifiés pour vous aider ; rien n’est publié sans votre accord."
          actions={actionsAssistantPr}
        >
          <Stack gap="md">
            {risque ? (
              <Row gap="sm">
                <StatusBadge tone={RISQUES[risque.niveau]?.tone ?? "neutral"}>
                  {`${RISQUES[risque.niveau]?.label ?? "Risque"}${risque.aVerifier ? " (à vérifier)" : ""}`}
                </StatusBadge>
              </Row>
            ) : null}
            {analysePr?.pr === prCible ? (
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
            ) : null}
            {revue?.pr === prCible ? (
              <List
                label="Remarques de revue proposées"
                selectionMode="none"
                items={revue.commentaires.map((c, index) => ({ id: String(index), title: c.remarque, subtitle: c.fichier }))}
                itemActions={(item) => [
                  {
                    icon: <Send size={16} />,
                    label: "Publier la remarque",
                    onPress: async () => {
                      const index = Number(item.id);
                      const c = revue.commentaires[index];
                      if (!c) return;
                      await functions.call("commenter-pr", { ...entreePr, texte: `**${c.fichier}** : ${c.remarque}` });
                      setRevue({ ...revue, commentaires: revue.commentaires.filter((_, i) => i !== index) });
                      detail.reload();
                      reussi("Remarque publiée");
                    },
                  },
                ]}
              />
            ) : null}
          </Stack>
        </DetailPage.Section>
        <DetailPage.Section title={`${pr.auteur} · ${quand(pr.cree)}`}>
          {pr.description ? (
            <Markdown onLinkPress={(href) => void shell.openExternal(href)}>{pr.description}</Markdown>
          ) : (
            <Text tone="muted">Aucune description.</Text>
          )}
        </DetailPage.Section>
        {commentaires.length > 0 ? (
          <DetailPage.Section title={`Commentaires (${commentaires.length})`}>
            <Stack gap="lg">
              {commentaires.map((commentaire) => (
                <Stack key={commentaire.id} gap="xs">
                  <Row gap="sm">
                    <Text as="span" weight="strong">
                      {commentaire.auteur}
                    </Text>
                    <Text as="span" size="meta" tone="muted">
                      {quand(commentaire.cree)}
                    </Text>
                  </Row>
                  <Markdown onLinkPress={(href) => void shell.openExternal(href)}>{commentaire.texte || "(commentaire vide)"}</Markdown>
                </Stack>
              ))}
            </Stack>
          </DetailPage.Section>
        ) : null}
        <DetailPage.Section title="Évaluateurs">
          {pr.evaluateurs.length > 0 ? (
            <List
              label="Évaluateurs"
              selectionMode="none"
              leading="avatar"
              items={pr.evaluateurs.map((evaluateur) => ({
                id: evaluateur.nom,
                title: evaluateur.nom,
                status: {
                  label: AVIS[evaluateur.statut]?.label ?? evaluateur.statut,
                  tone: AVIS[evaluateur.statut]?.tone ?? "neutral",
                },
              }))}
            />
          ) : (
            <Text tone="muted">Aucun évaluateur.</Text>
          )}
        </DetailPage.Section>
      </>
    ) : ongletPr === "commits" ? (
      <DetailPage.Section title={`Commits (${commitsPr.length})`}>
        <ListeCommits commits={commitsPr} />
      </DetailPage.Section>
    ) : (
      <DetailPage.Section
        title="Fichiers modifiés"
        description={
          fichiersPr.length > 0
            ? `${fichiersPr.length} fichier${fichiersPr.length > 1 ? "s" : ""} modifié${fichiersPr.length > 1 ? "s" : ""}${
                fichiersPr.length > DIFFS_AFFICHES ? ` · les ${DIFFS_AFFICHES} premiers sont affichés` : ""
              }`
            : undefined
        }
        state={changements.loading && !changements.data ? "loading" : "ready"}
        empty={changements.data && fichiersPr.length === 0 ? { title: "Aucun fichier modifié" } : undefined}
      >
        <Stack gap="lg">
          {fichiersPr.slice(0, DIFFS_AFFICHES).map((fichier) => (
            <DiffFichier key={fichier.chemin} instance={compte} pr={prCible} chemin={fichier.chemin} nature={fichier.nature} />
          ))}
        </Stack>
      </DetailPage.Section>
    );

    return (
      <DetailPage
        title={pr ? `${pr.titre} #${pr.id}` : `Pull request #${prNumero}`}
        back={{ label: "Pull requests", onPress: retour }}
        status={pr ? { label: ETATS_PR[pr.etat]?.label ?? pr.etat, tone: ETATS_PR[pr.etat]?.tone ?? "neutral" } : undefined}
        meta={[
          pr
            ? `${pr.auteur} veut fusionner ${commitsPr.length} commit${commitsPr.length > 1 ? "s" : ""} de ${pr.source} vers ${pr.cible}`
            : null,
          `${prProjet} / ${prDepot}`,
        ].filter(Boolean)}
        width="full"
        actions={actionsPr}
        state={detail.error ? "error" : !pr ? (detail.loading ? "loading" : "not-found") : "ready"}
        onRetry={detail.reload}
        notFound={{ title: "Pull request introuvable", description: "Elle a peut-être été fusionnée ou supprimée." }}
        onActionError={notifyActionError}
      >
        {pr ? (
          <DetailPage.Section title="Rubriques">
            <RadioGroup
              label="Rubriques de la pull request"
              hideLabel
              orientation="horizontal"
              value={ongletPr}
              onChange={(id) => setOngletPr(id as OngletPr)}
            >
              <RadioGroup.Option value="conversation">{`Conversation (${commentaires.length})`}</RadioGroup.Option>
              <RadioGroup.Option value="commits">{`Commits (${commitsPr.length})`}</RadioGroup.Option>
              <RadioGroup.Option value="fichiers">Fichiers modifiés</RadioGroup.Option>
            </RadioGroup>
          </DetailPage.Section>
        ) : null}
        {sections}
        {modale}
      </DetailPage>
    );
  }

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
          state={fichiers.error ? "error" : fichiers.loading && !fichiers.data ? "loading" : "ready"}
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
                onChoisir={(f) => setFichierOuvert({ nom: f.nom, chemin: f.chemin, dossier: false, taille: 0 })}
              />
            </Row>
            <DernierCommit instance={compte} projet={cible.projet} depot={cible.depot} branche={brancheActive} chemin={chemin} />
            <ListeFichiers fichiers={liste} chemin={chemin} onDossier={setChemin} onFichier={setFichierOuvert} />
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
        <ListePrs prs={prs} risques={risques} onOuvrir={(pr) => ouvrirPr({ ...pr, projet: cible.projet, depot: cible.depot })} />
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
            setBranche(id);
            setChemin("");
            setOnglet("code");
          }}
        />
      </PageSection>
    );
  } else {
    contenu = (
      <PageSection title="Commits" state={commits.loading && !commits.data ? "loading" : "ready"}>
        <ListeCommits commits={commits.data?.commits ?? []} />
      </PageSection>
    );
  }

  return (
    <Page
      toolbar={
        <RadioGroup
          label="Rubriques du dépôt"
          hideLabel
          orientation="horizontal"
          value={onglet}
          onChange={(id) => setOnglet(id as OngletDepot)}
        >
          <RadioGroup.Option value="code">Code</RadioGroup.Option>
          <RadioGroup.Option value="prs">{`Pull requests (${prs.length})`}</RadioGroup.Option>
          <RadioGroup.Option value="branches">{`Branches (${branches.length})`}</RadioGroup.Option>
          <RadioGroup.Option value="commits">Commits</RadioGroup.Option>
        </RadioGroup>
      }
      actionsLabel={`${cible.projet} / ${depotInfo?.nom ?? cible.depot}`}
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
      onActionError={notifyActionError}
      state={info.error ? "error" : "ready"}
      onRetry={info.reload}
    >
      <PageSection
        title={`${cible.projet} / ${depotInfo?.nom ?? cible.depot}`}
        description={[depotInfo?.description || depotInfo?.projetNom, statut].filter(Boolean).join(" · ") || undefined}
        empty={
          !info.loading && !depotInfo && !info.error
            ? { title: "Dépôt introuvable", description: "Il a peut-être été renommé ou vous n’y avez plus accès." }
            : undefined
        }
      >
        {null}
      </PageSection>
      {depotInfo || info.loading ? contenu : null}
      {modale}
    </Page>
  );
}
