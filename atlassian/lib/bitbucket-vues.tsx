import { Notice, Row, Stack, Text } from "@alfred/kit";
import { functions, shell, useAsync } from "@alfred/sdk";
import { FileText, Folder } from "lucide-react";
import { useState } from "react";
import { Avatar, Button, Code, ComboBox, Modal, DiffView, EmptyState, List, Skeleton, Badge, Table } from "socle-ui";
import { Markdown } from "socle-ui/markdown";
import { quand } from "./affichage";

export interface Fichier {
  nom: string;
  chemin: string;
  dossier: boolean;
  taille: number;
  commit?: { court: string; message: string; auteur: string; date: number | null } | null;
}

export interface Commit {
  id: string;
  court: string;
  message: string;
  auteur: string;
  date: number | null;
}

type Ton = "neutral" | "warning" | "success" | "danger";

export const ETATS_PR: Record<string, { label: string; tone: Ton }> = {
  OPEN: { label: "Ouverte", tone: "success" },
  MERGED: { label: "Fusionnée", tone: "neutral" },
  DECLINED: { label: "Refusée", tone: "danger" },
};

export const AVIS: Record<string, { label: string; tone: Ton }> = {
  APPROVED: { label: "Approuvé", tone: "success" },
  NEEDS_WORK: { label: "À retravailler", tone: "warning" },
  UNAPPROVED: { label: "En attente", tone: "neutral" },
  // Le connecteur rend « approuvé » quand l’évaluateur a validé.
  "approuvé": { label: "Approuvé", tone: "success" },
  "en attente": { label: "En attente", tone: "neutral" },
};

export function tailleTexte(octets: number): string {
  if (!octets) return "";
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${Math.round(octets / 1024)} ko`;
  return `${(octets / (1024 * 1024)).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;
}

const estMarkdown = (nom: string) => /\.(md|markdown)$/i.test(nom);

/** Liste des fichiers d’un dossier, comme sur GitHub : nom, dernier commit, date. Dossiers d’abord. */
export function ListeFichiers({
  fichiers,
  chemin,
  onDossier,
  onFichier,
}: {
  fichiers: Fichier[];
  chemin: string;
  onDossier: (chemin: string) => void;
  onFichier: (fichier: Fichier) => void;
}) {
  const tries = [...fichiers].sort(
    (a, b) => Number(b.dossier) - Number(a.dossier) || a.nom.localeCompare(b.nom, "fr", { sensitivity: "base" }),
  );
  const parent = chemin.split("/").slice(0, -1).join("/");
  const lignes: Array<Fichier & { id: string; parent?: boolean }> = [
    ...(chemin ? [{ id: "..parent", nom: "..", chemin: parent, dossier: true, taille: 0, commit: null, parent: true }] : []),
    ...tries.map((f) => ({ ...f, id: f.chemin || f.nom })),
  ];
  const ouvrir = (id: string) => {
    const fichier = lignes.find((f) => f.id === id);
    if (!fichier) return;
    if (fichier.dossier) onDossier(fichier.chemin);
    else onFichier(fichier);
  };
  return (
    <Table
      label="Fichiers du dépôt"
      rows={lignes}
      density="compact"
      selectionMode="single"
      selectedKeys={[]}
      onSelectionChange={(cles) => {
        const id = [...cles][0];
        if (id !== undefined) ouvrir(String(id));
      }}
      onAction={ouvrir}
      rowIcon={(f) => (f.dossier ? <Folder size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />)}
      columns={[
        { id: "nom", label: "Nom" },
        { id: "commit", label: "Dernier commit" },
        { id: "date", label: "Date", align: "end", width: 120 },
      ]}
      renderCell={(f, colonne) =>
        colonne === "nom"
          ? f.nom
          : colonne === "commit"
            ? (f.commit?.message ?? "")
            : f.commit
              ? quand(f.commit.date)
              : f.dossier
                ? ""
                : tailleTexte(f.taille)
      }
    />
  );
}

/** « Aller au fichier » : recherche d’un fichier dans tout le dépôt, comme la touche T de GitHub. */
export function AllerAuFichier({
  instance,
  projet,
  depot,
  branche,
  onChoisir,
}: {
  instance: string;
  projet: string;
  depot: string;
  branche: string;
  onChoisir: (fichier: { chemin: string; nom: string }) => void;
}) {
  return (
    <ComboBox
      label="Aller au fichier"
      hideLabel
      width="md"
      placeholder="Aller au fichier…"
      value={null}
      loadItems={async (recherche) => {
        const reponse = await functions.call<{ fichiers: Array<{ chemin: string; nom: string }> }>("chercher-fichier", {
          instance,
          projet,
          depot,
          branche: branche || undefined,
          recherche,
        });
        return reponse.fichiers.map((f) => ({ id: f.chemin, label: f.chemin, description: f.nom }));
      }}
      onChange={(chemin) => {
        if (chemin) onChoisir({ chemin, nom: chemin.split("/").pop() ?? chemin });
      }}
    />
  );
}

/** Contenu d’un fichier : rendu pour un Markdown, en code pour le reste. */
export function ContenuFichier({
  instance,
  projet,
  depot,
  chemin,
  branche,
  nom,
  discret,
}: {
  instance: string;
  projet: string;
  depot: string;
  chemin: string;
  branche: string;
  nom: string;
  discret?: boolean;
}) {
  const fichier = useAsync(
    () =>
      functions.call<{ contenu: string; lignes: number; tronque: boolean }>("lire-fichier", {
        instance,
        projet,
        depot,
        chemin,
        branche: branche || undefined,
      }),
    [instance, projet, depot, chemin, branche],
  );
  if (fichier.loading && !fichier.data) return <Skeleton shape="rect" width="100%" height={160} />;
  if (fichier.error) return <Notice tone="danger">{fichier.error.message}</Notice>;
  const contenu = fichier.data?.contenu ?? "";
  return (
    <Stack gap="md">
      {fichier.data?.tronque ? <Notice tone="warning">Le fichier est long : seule une partie s’affiche ici.</Notice> : null}
      {!discret ? (
        <Text size="meta" tone="muted">
          {`${fichier.data?.lignes ?? 0} lignes`}
        </Text>
      ) : null}
      {estMarkdown(nom) && contenu ? (
        <Markdown onLinkPress={(href) => void shell.openExternal(href)}>{contenu}</Markdown>
      ) : (
        <Code block label={nom}>
          {contenu || "(fichier vide)"}
        </Code>
      )}
    </Stack>
  );
}

/** Dernier commit qui a touché le dossier affiché, en tête de la liste des fichiers. */
export function DernierCommit({
  instance,
  projet,
  depot,
  branche,
  chemin,
}: {
  instance: string;
  projet: string;
  depot: string;
  branche: string;
  chemin: string;
}) {
  const commits = useAsync(
    () =>
      functions.call<{ commits: Commit[] }>("lister-commits", {
        instance,
        projet,
        depot,
        branche: branche || undefined,
        chemin: chemin || undefined,
        limite: 1,
      }),
    [instance, projet, depot, branche, chemin],
  );
  const dernier = commits.data?.commits[0];
  if (!dernier) return null;
  return (
    <Row gap="sm" justify="between" wrap>
      <Row gap="sm">
        <Avatar name={dernier.auteur} size="sm" />
        <Text as="span" weight="strong">
          {dernier.auteur}
        </Text>
        <Text as="span">{dernier.message.split("\n")[0]}</Text>
      </Row>
      <Row gap="sm">
        <Code>{dernier.court}</Code>
        <Text as="span" size="meta" tone="muted">
          {quand(dernier.date)}
        </Text>
      </Row>
    </Row>
  );
}

/** Le README du dossier affiché, rendu sous la liste des fichiers. */
export function Readme(props: { instance: string; projet: string; depot: string; branche: string; chemin: string; nom: string }) {
  return <ContenuFichier {...props} discret />;
}

export function ListeCommits({ commits }: { commits: Commit[] }) {
  const [ouvert, setOuvert] = useState<Commit | null>(null);
  if (commits.length === 0) return <EmptyState size="compact" title="Aucun commit" />;
  return (
    <>
      <List
        label="Commits"
        selectionMode="none"
        leading="avatar"
        items={commits.map((commit) => ({
          id: commit.id,
          title: commit.message.split("\n")[0] || "(sans message)",
          subtitle: `${commit.auteur} · ${quand(commit.date)}`,
          meta: commit.court,
        }))}
        onAction={(id) => setOuvert(commits.find((commit) => commit.id === id) ?? null)}
      />
      {ouvert ? (
        <Modal
          isOpen
          title={`Commit ${ouvert.court}`}
          description={`${ouvert.auteur} · ${quand(ouvert.date)}`}
          onOpenChange={(visible) => { if (!visible) setOuvert(null); }}
          footer={<Button onPress={() => setOuvert(null)}>Fermer</Button>}
        >
          <Stack gap="sm">
            <Code block label="Identifiant du commit">{ouvert.id}</Code>
            <Text>{ouvert.message || "Aucun message."}</Text>
          </Stack>
        </Modal>
      ) : null}
    </>
  );
}

/** Différences d’un fichier d’une pull request. */
export function DiffFichier({
  instance,
  pr,
  chemin,
  nature,
}: {
  instance: string;
  pr: string;
  chemin: string;
  nature: string;
}) {
  const diff = useAsync(
    () =>
      functions.call<{ texte: string; ajouts: number; retraits: number; binaire: boolean; tronque: boolean }>(
        "lire-diff-pr",
        { instance, pr, chemin },
      ),
    [instance, pr, chemin],
  );
  return (
    <Stack gap="xs">
      <Row gap="sm">
        <Code>{chemin}</Code>
        <Badge tone={nature === "ajouté" ? "success" : nature === "supprimé" ? "danger" : "neutral"}>{nature}</Badge>
      </Row>
      {diff.error ? (
        <Text tone="danger">{diff.error.message}</Text>
      ) : !diff.data ? (
        <Skeleton shape="rect" width="100%" height={120} />
      ) : diff.data.binaire ? (
        <Text tone="muted">Fichier binaire : pas d’aperçu des différences.</Text>
      ) : diff.data.texte ? (
        <DiffView label={`Modifications de ${chemin}`} patch={diff.data.texte} truncated={diff.data.tronque} defaultMode="unified" />
      ) : (
        <Text tone="muted">Aucune différence.</Text>
      )}
    </Stack>
  );
}
