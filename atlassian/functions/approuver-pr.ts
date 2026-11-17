import { bitbucketClient, erreurBitbucket, resoudrePr } from "../lib/bitbucket-api";

/** Approuve une pull request, ou retire l’approbation. */
export default async function ({
  instance,
  projet,
  depot,
  id,
  pr,
  action,
}: {
  instance?: string;
  projet?: string;
  depot?: string;
  id?: number;
  pr?: string;
  action?: "approuver" | "retirer";
}) {
  const cible = resoudrePr({ projet, depot, id, pr });
  const base = `/rest/api/1.0/projects/${encodeURIComponent(cible.projet)}/repos/${encodeURIComponent(cible.depot)}/pull-requests/${cible.id}/approve`;
  const clientBitbucket = bitbucketClient(instance);
  const reponse = action === "retirer" ? await clientBitbucket.delete(base) : await clientBitbucket.post(base);
  if (!reponse.ok) erreurBitbucket(reponse);
  return { approuve: action !== "retirer" };
}
