import { aucunCompte } from "../lib/comptes-api";
import { bitbucketClient, erreurBitbucket, normaliserPr, type PrBrut, liste } from "../lib/bitbucket-api";

interface Activite {
  action?: string;
  createdDate?: number;
  user?: { displayName?: string };
  comment?: {
    id?: number;
    text?: string;
    author?: { displayName?: string };
    createdDate?: number;
    comments?: Array<{ id?: number; text?: string; author?: { displayName?: string }; createdDate?: number }>;
  };
}

/** Une pull request en détail : description, évaluateurs, commentaires et commits. */
export default async function ({
  instance,
  projet,
  depot,
  id,
}: {
  instance?: string;
  projet: string;
  depot: string;
  id: number;
}) {
  if (await aucunCompte("bitbucket")) return { pr: null, commentaires: [], commits: [] };
  if (!projet?.trim() || !depot?.trim() || !id) return { pr: null, commentaires: [], commits: [] };
  const base = `/rest/api/1.0/projects/${encodeURIComponent(projet)}/repos/${encodeURIComponent(depot)}/pull-requests/${id}`;
  const clientBitbucket = bitbucketClient(instance);

  const [rPr, rActivites, rCommits] = await Promise.all([
    clientBitbucket.get<PrBrut>(base),
    clientBitbucket.get<{ values?: Activite[] }>(`${base}/activities`, { limit: 100 }),
    clientBitbucket.get<{ values?: Array<{ id?: string; displayId?: string; message?: string; author?: { displayName?: string }; authorTimestamp?: number }> }>(
      `${base}/commits`,
      { limit: 50 },
    ),
  ]);
  if (rPr.status === 404) return { pr: null, commentaires: [], commits: [] };
  if (!rPr.ok) erreurBitbucket(rPr);
  if (!rActivites.ok) erreurBitbucket(rActivites);
  if (!rCommits.ok) erreurBitbucket(rCommits);

  const commentaires: Array<{ id: string; auteur: string; texte: string; cree: number | null }> = [];
  for (const activite of liste<NonNullable<typeof rActivites.body?.values>[number]>(rActivites.body?.values)) {
    if (!activite.comment) continue;
    const commentaire = activite.comment;
    commentaires.push({
      id: String(commentaire.id ?? commentaires.length),
      auteur: commentaire.author?.displayName ?? activite.user?.displayName ?? "Quelqu’un",
      texte: commentaire.text ?? "",
      cree: commentaire.createdDate ?? activite.createdDate ?? null,
    });
    for (const reponse of liste<NonNullable<typeof commentaire.comments>[number]>(commentaire.comments)) {
      commentaires.push({
        id: String(reponse.id ?? commentaires.length),
        auteur: reponse.author?.displayName ?? "Quelqu’un",
        texte: reponse.text ?? "",
        cree: reponse.createdDate ?? null,
      });
    }
  }

  const commits = liste(rCommits.body?.values).map((commit) => ({
    id: commit.displayId ?? commit.id ?? "",
    message: commit.message ?? "",
    auteur: commit.author?.displayName ?? "",
    date: commit.authorTimestamp ?? null,
  }));

  return { pr: normaliserPr(rPr.body), commentaires, commits };
}
