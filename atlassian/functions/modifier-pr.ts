import { bitbucketClient, erreurBitbucket, resoudrePr } from "../lib/bitbucket-api";

/** Modifie le titre ou la description d’une pull request Bitbucket. */
export default async function (entree: {
  instance?: string;
  projet?: string;
  depot?: string;
  id?: number;
  pr?: string;
  version: number;
  titre?: string;
  description?: string;
}) {
  const cible = resoudrePr(entree);
  const clientBitbucket = bitbucketClient(entree.instance);
  const adresse = `/rest/api/1.0/projects/${encodeURIComponent(cible.projet)}/repos/${encodeURIComponent(cible.depot)}/pull-requests/${cible.id}`;
  const actuelle = await clientBitbucket.get<{ title?: string; version?: number }>(adresse);
  if (!actuelle.ok) erreurBitbucket(actuelle);
  const reponse = await clientBitbucket.put(adresse, {
    version: actuelle.body?.version ?? entree.version,
    title: entree.titre?.trim() || actuelle.body?.title,
    description: entree.description ?? undefined,
  });
  if (!reponse.ok) erreurBitbucket(reponse);
  return { modifiee: true };
}
