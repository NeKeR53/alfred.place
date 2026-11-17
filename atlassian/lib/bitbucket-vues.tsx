import { useEffect, useState } from "react";
import { FileText, Folder } from "lucide-react";
import { functions, shell, useAsync } from "@alfred/sdk";
import {
  Avatar,
  Code,
  DataTable,
  EmptyState,
  FeedbackBanner,
  List,
  ListItem,
  LoadingSkeleton,
  Markdown,
  Row,
  SearchCombobox,
  Stack,
  StatusBadge,
  Text,
} from "@alfred/ui";
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
  const lignes: Array<Fichier & { parent?: boolean }> = chemin
    ? [{ nom: "..", chemin: parent, dossier: true, taille: 0, commit: null, parent: true }, ...tries]
    : tries;
  return (
    <DataTable<Fichier & { parent?: boolean }>
      label="Fichiers du dépôt"
      rows={lignes}
      rowKey={(f) => (f.parent ? "..parent" : f.chemin || f.nom)}
      onRowClick={(f) => (f.dossier ? onDossier(f.chemin) : onFichier(f))}
      columns={[
        {
          key: "nom",
          header: "Nom",
          render: (f) => (
            <Row gap="sm">
              {f.dossier ? <Folder size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}
              <Text as="span">{f.nom}</Text>
            </Row>
          ),
        },
        {
          key: "commit",
          header: "Dernier commit",
          render: (f) => (
            <Text as="span" tone="muted">
              {f.commit?.message ?? ""}
            </Text>
          ),
        },
        {
          key: "date",
          header: "Date",
          align: "right",
          render: (f) => (
            <Text as="span" size="meta" tone="muted">
              {f.commit ? quand(f.commit.date) : f.dossier ? "" : tailleTexte(f.taille)}
            </Text>
          ),
        },
      ]}
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
  const [saisie, setSaisie] = useState("");
  const [resultats, setResultats] = useState<Array<{ chemin: string; nom: string }>>([]);
  const [cherche, setCherche] = useState(false);
  useEffect(() => {
    if (saisie.trim().length < 2) return;
    const minuteur = setTimeout(() => {
      setCherche(true);
      functions
        .call<{ fichiers: Array<{ chemin: string; nom: string }> }>("chercher-fichier", {
          instance,
          projet,
          depot,
          branche: branche || undefined,
          recherche: saisie,
        })
        .then((reponse) => setResultats(reponse.fichiers))
        .catch(() => setResultats([]))
        .finally(() => setCherche(false));
    }, 250);
    return () => clearTimeout(minuteur);
  }, [saisie, branche]);
  return (
    <SearchCombobox<{ chemin: string; nom: string }>
      label="Aller au fichier"
      value={saisie}
      options={resultats}
      loading={cherche}
      minQueryLength={2}
      onChange={setSaisie}
      onSelect={(fichier) => {
        setSaisie("");
        onChoisir(fichier);
      }}
      getOptionKey={(f) => f.chemin}
      getOptionLabel={(f) => f.chemin}
      placeholder="Aller au fichier…"
      emptyMessage="Aucun fichier ne correspond."
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
  if (fichier.loading && !fichier.data) return <LoadingSkeleton />;
  if (fichier.error) return <FeedbackBanner tone="danger">{fichier.error.message}</FeedbackBanner>;
  const contenu = fichier.data?.contenu ?? "";
  return (
    <Stack gap="md">
      {fichier.data?.tronque && (
        <FeedbackBanner tone="warning">Le fichier est long : seule une partie s’affiche ici.</FeedbackBanner>
      )}
      {!discret && (
        <Text size="meta" tone="muted">
          {`${fichier.data?.lignes ?? 0} lignes`}
        </Text>
      )}
      {estMarkdown(nom) && contenu ? (
        <Markdown onLink={(href) => void shell.openExternal(href)}>{contenu}</Markdown>
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
    <Row gap="sm" justify="between">
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
  if (commits.length === 0) return <EmptyState size="compact" title="Aucun commit" />;
  return (
    <List label="Commits">
      {commits.map((commit) => (
        <ListItem
          key={commit.id}
          leading={<Avatar name={commit.auteur} size="sm" />}
          title={commit.message.split("\n")[0] || "(sans message)"}
          description={`${commit.auteur} · ${quand(commit.date)}`}
          trailing={<Code>{commit.court}</Code>}
        />
      ))}
    </List>
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
      <Row gap="sm" justify="between">
        <Row gap="sm">
          <FileText size={16} aria-hidden="true" />
          <Code>{chemin}</Code>
          <StatusBadge size="compact" tone={nature === "ajouté" ? "success" : nature === "supprimé" ? "danger" : "neutral"}>
            {nature}
          </StatusBadge>
        </Row>
        {diff.data && !diff.data.binaire && (
          <Row gap="xs">
            <Text as="span" size="meta" tone="success">{`+${diff.data.ajouts}`}</Text>
            <Text as="span" size="meta" tone="danger">{`−${diff.data.retraits}`}</Text>
          </Row>
        )}
      </Row>
      {diff.error ? (
        <Text tone="danger">{diff.error.message}</Text>
      ) : !diff.data ? (
        <LoadingSkeleton />
      ) : diff.data.binaire ? (
        <Text tone="muted">Fichier binaire : pas d’aperçu des différences.</Text>
      ) : (
        <Code block label={`Différences de ${chemin}`}>
          {diff.data.texte || "(aucune différence)"}
        </Code>
      )}
    </Stack>
  );
}
