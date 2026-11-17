import { bitbucketClient, erreurBitbucket, resoudrePr, type PrBrut } from "../lib/bitbucket-api";

/** Fusionne une pull request, en respectant la version lue (protection contre les conflits). */
export default async function ({
  instance,
  projet,
  depot,
  id,
  pr,
  version,
  message,
}: {
  instance?: string;
  projet?: string;
  depot?: string;
  id?: number;
  pr?: string;
  version?: number;
  message?: string;
}) {
  const cible = resoudrePr({ projet, depot, id, pr });
  const base = `/rest/api/1.0/projects/${encodeURIComponent(cible.projet)}/repos/${encodeURIComponent(cible.depot)}/pull-requests/${cible.id}`;
  const clientBitbucket = bitbucketClient(instance);
  let numero = version ?? 0;
  if (!numero) {
    const rPr = await clientBitbucket.get<PrBrut>(base);
    if (!rPr.ok) erreurBitbucket(rPr);
    numero = rPr.body?.version ?? 0;
  }
  const reponse = await clientBitbucket.post(`${base}/merge?version=${numero}`, {
    message: message?.trim() || undefined,
  });
  if (!reponse.ok) erreurBitbucket(reponse);
  return { fusionnee: true };
}
