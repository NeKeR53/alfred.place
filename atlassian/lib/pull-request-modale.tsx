import { Row, Stack, Text } from "@alfred/kit";
import { ai, functions, notifyActionError, shell, useAsync } from "@alfred/sdk";
import { Bot, Check, ExternalLink, GitMerge, ListChecks, MessageSquare, Send, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { type Action, ActionBar, Button, Modal, List, PageSection, Badge, Tabs, useOpenForm } from "socle-ui";
import { Markdown } from "socle-ui/markdown";
import { quand } from "./affichage";
import { analyserPr, type ContextePr, redigerDescriptionPr, revuePr } from "./assistant";
import { type CommentairePr, type Pr, RISQUES } from "./bitbucket-commun";
import { AVIS, type Commit, DiffFichier, ETATS_PR, ListeCommits } from "./bitbucket-vues";

type OngletPr = "conversation" | "commits" | "fichiers";
const DIFFS_AFFICHES = 25;

export function PullRequestModale({
  instance: compte,
  cible,
  risque,
  onClose,
  onChange,
}: {
  instance: string;
  cible: Pick<Pr, "projet" | "depot" | "id">;
  risque?: { niveau: string; aVerifier: boolean };
  onClose: () => void;
  onChange: () => void;
}) {
  const { projet: prProjet, depot: prDepot, id: prNumero } = cible;
  const prCible = `${prProjet}/${prDepot}/${prNumero}`;
  const entreePr = { instance: compte, projet: prProjet, depot: prDepot, id: prNumero };
  const openForm = useOpenForm();
  const [ongletPr, setOngletPr] = useState<OngletPr>("conversation");
  const [analysePr, setAnalysePr] = useState<{
    pr: string;
    resume: string;
    risques: Array<{ fichier: string; risque: string; gravite: string }>;
    conseil: string;
  } | null>(null);
  const [revue, setRevue] = useState<{ pr: string; commentaires: Array<{ fichier: string; remarque: string }> } | null>(
    null,
  );

  const detail = useAsync(
    () => functions.call<{ pr: Pr | null; commentaires: CommentairePr[]; commits: Commit[] }>("lire-pr", entreePr),
    [compte, prProjet, prDepot, prNumero],
  );

  const changements = useAsync(
    () =>
      ongletPr === "fichiers"
        ? functions.call<{ fichiers: Array<{ chemin: string; nature: string }> }>("lister-changements-pr", {
            instance: compte,
            pr: prCible,
          })
        : Promise.resolve({ fichiers: [] as Array<{ chemin: string; nature: string }> }),
    [compte, prCible, ongletPr],
  );


  function actualiser() {
    detail.reload();
    onChange();
  }

  const reussi = (title: string) => shell.notify({ title, tone: "success" });

  const pr = detail.data?.pr ?? null;
  const commentaires = detail.data?.commentaires ?? [];
  const commitsPr = detail.data?.commits ?? [];
  const fichiersPr = changements.data?.fichiers ?? [];
  const ouverte = pr?.etat === "OPEN";

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
            actualiser();
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
          .then(() => actualiser()),
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
        actualiser();
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
        actualiser();
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
            actualiser();
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
        actualiser();
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
        actualiser();
      },
    },
  ];

  const sections = !pr ? null : ongletPr === "conversation" ? (
    <>
      <PageSection
        title="Assistant"
        description="Je lis les fichiers modifiés pour vous aider ; rien n’est publié sans votre accord."
        actions={actionsAssistantPr}
      >
        <Stack gap="md">
          {risque ? (
            <Row gap="sm">
              <Badge tone={RISQUES[risque.niveau]?.tone ?? "neutral"}>
                {`${RISQUES[risque.niveau]?.label ?? "Risque"}${risque.aVerifier ? " (à vérifier)" : ""}`}
              </Badge>
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
                    actualiser();
                    reussi("Remarque publiée");
                  },
                },
              ]}
            />
          ) : null}
        </Stack>
      </PageSection>
      <PageSection title={`${pr.auteur} · ${quand(pr.cree)}`}>
        {pr.description ? (
          <Markdown onLinkPress={(href) => void shell.openExternal(href)}>{pr.description}</Markdown>
        ) : (
          <Text tone="muted">Aucune description.</Text>
        )}
      </PageSection>
      {commentaires.length > 0 ? (
        <PageSection title={`Commentaires (${commentaires.length})`}>
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
        </PageSection>
      ) : null}
      <PageSection title="Évaluateurs">
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
      </PageSection>
    </>
  ) : ongletPr === "commits" ? (
    <PageSection title={`Commits (${commitsPr.length})`}>
      <ListeCommits commits={commitsPr} />
    </PageSection>
  ) : (
    <PageSection
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
    </PageSection>
  );

  const titre = pr ? `#${pr.id} · ${pr.titre}` : `Pull request #${prNumero}`;
  return (
    <Modal
      isOpen
      size="lg"
      title={titre}
      description={`${prProjet} / ${prDepot}`}
      onOpenChange={(ouverte) => {
        if (!ouverte) onClose();
      }}
      footer={<Button onPress={onClose}>Fermer</Button>}
    >
      {detail.error || !pr ? (
        <PageSection
          title="Détails"
          state={detail.error ? "error" : detail.loading ? "loading" : "ready"}
          onRetry={detail.reload}
          empty={!detail.loading && !detail.error ? { title: "Pull request introuvable" } : undefined}
        />
      ) : (
        <Stack gap="md">
            <Row gap="sm" justify="between" wrap>
              <Row gap="sm" wrap>
                <Badge tone={ETATS_PR[pr.etat]?.tone ?? "neutral"}>
                  {ETATS_PR[pr.etat]?.label ?? pr.etat}
                </Badge>
                <Text size="meta" tone="muted">{`${pr.auteur} · ${pr.source} → ${pr.cible}`}</Text>
              </Row>
              <ActionBar actions={actionsPr} zone="header" subject={titre} onError={notifyActionError} />
            </Row>
            <Tabs
              pageTitle={titre}
              items={[
                { id: "conversation", label: `Conversation (${commentaires.length})` },
                { id: "commits", label: `Commits (${commitsPr.length})` },
                { id: "fichiers", label: "Fichiers modifiés" },
              ]}
              selectedId={ongletPr}
              onSelectionChange={(id) => setOngletPr(id as OngletPr)}
            />
          {sections}
        </Stack>
      )}
    </Modal>
  );
}
