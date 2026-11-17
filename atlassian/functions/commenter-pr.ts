import { bitbucketClient, erreurBitbucket, resoudrePr } from "../lib/bitbucket-api";

/** Ajoute un commentaire à une pull request. */
export default async function ({
  instance,
  projet,
  depot,
  id,
  pr,
  texte,
}: {
  instance?: string;
  projet?: string;
  depot?: string;
  id?: number;
  pr?: string;
  texte: string;
}) {
  if (!texte.trim()) throw new Error("Le commentaire est vide.");
  const cible = resoudrePr({ projet, depot, id, pr });
  const base = `/rest/api/1.0/projects/${encodeURIComponent(cible.projet)}/repos/${encodeURIComponent(cible.depot)}/pull-requests/${cible.id}`;
  const reponse = await bitbucketClient(instance).post(`${base}/comments`, { text: texte.trim() });
  if (!reponse.ok) erreurBitbucket(reponse);
  return { commente: true };
}
