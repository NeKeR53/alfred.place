import { bitbucketClient, erreurBitbucket, resoudrePr } from "../lib/bitbucket-api";

/** Refuse (décline) une pull request Bitbucket, avec un commentaire facultatif. */
export default async function (entree: {
  instance?: string;
  projet?: string;
  depot?: string;
  id?: number;
  pr?: string;
  version: number;
  commentaire?: string;
}) {
  const cible = resoudrePr(entree);
  const reponse = await bitbucketClient(entree.instance).request({
    method: "POST",
    path: `/rest/api/1.0/projects/${encodeURIComponent(cible.projet)}/repos/${encodeURIComponent(cible.depot)}/pull-requests/${cible.id}/decline`,
    query: { version: Number(entree.version ?? 0) },
    body: entree.commentaire?.trim() ? { comment: entree.commentaire.trim() } : {},
  });
  if (!reponse.ok) erreurBitbucket(reponse);
  return { refusee: true };
}
