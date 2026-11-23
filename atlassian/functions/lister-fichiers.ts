import { aucunCompte } from "../lib/comptes-api";
import { bitbucketClient, cheminEncode, erreurBitbucket, liste } from "../lib/bitbucket-api";

interface CommitBrut {
  id?: string;
  displayId?: string;
  message?: string;
  author?: { name?: string; displayName?: string };
  authorTimestamp?: number;
}

function resumeCommit(commit: CommitBrut | undefined) {
  if (!commit?.id) return null;
  return {
    court: commit.displayId ?? commit.id.slice(0, 11),
    message: (commit.message ?? "").split("\n")[0],
    auteur: commit.author?.displayName ?? commit.author?.name ?? "",
    date: commit.authorTimestamp ?? null,
  };
}

interface Enfant { path?: { name?: string; toString?: string }; type?: string; size?: number }

/** Contenu d’un dossier d’un dépôt, à une branche donnée : l’ossature du projet. */
export default async function ({
  instance,
  projet,
  depot,
  chemin,
  branche,
}: {
  instance?: string;
  projet: string;
  depot: string;
  chemin?: string;
  branche?: string;
}) {
  if (await aucunCompte("bitbucket")) return { chemin: chemin ?? "", fichiers: [], tronque: false };
  if (!projet?.trim() || !depot?.trim()) return { chemin: chemin ?? "", fichiers: [], tronque: false };
  const propre = (chemin ?? "").replace(/^\/+|\/+$/g, "");
  const base = `/rest/api/1.0/projects/${encodeURIComponent(projet)}/repos/${encodeURIComponent(depot)}/browse`;
  const requete: Record<string, string | number> = { limit: 100 };
  if (branche) requete.at = branche;

  const reponse = await bitbucketClient(instance).get<{
    children?: Enfant[];
    isLastPage?: boolean;
  }>(`${base}${propre ? `/${cheminEncode(propre)}` : ""}`, requete);
  if (!reponse.ok) erreurBitbucket(reponse);

  // Comme sur GitHub : le dernier commit qui a touché chaque élément du dossier.
  const derniers: Record<string, CommitBrut> = {};
  const modifs = await bitbucketClient(instance).get<{ files?: Record<string, CommitBrut> }>(
    `/rest/api/1.0/projects/${encodeURIComponent(projet)}/repos/${encodeURIComponent(depot)}/last-modified${propre ? `/${cheminEncode(propre)}` : ""}`,
    branche ? { at: branche } : undefined,
  );
  if (modifs.ok) Object.assign(derniers, modifs.body?.files ?? {});

  const fichiers = liste(reponse.body?.children)
    .map((enfant) => ({
      nom: enfant.path?.name ?? "",
      chemin: enfant.path?.toString ?? enfant.path?.name ?? "",
      dossier: enfant.type === "DIRECTORY",
      taille: enfant.size ?? 0,
      commit: resumeCommit(derniers[enfant.path?.name ?? ""]),
    }))
    .sort((a, b) => Number(b.dossier) - Number(a.dossier) || a.nom.localeCompare(b.nom));

  return { chemin: propre, fichiers, tronque: reponse.body?.isLastPage === false };
}
