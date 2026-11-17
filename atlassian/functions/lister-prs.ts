import { aucunCompte } from "../lib/comptes-api";
import { bitbucketClient, erreurBitbucket, normaliserPr, type PrBrut } from "../lib/bitbucket-api";

interface Entree {
  instance?: string;
  projet?: string;
  depot?: string;
  etat?: "OPEN" | "MERGED" | "DECLINED" | "ALL";
  role?: "INCOMING" | "OUTGOING" | "ALL";
  limite?: number;
  debut?: number;
}

/** Pull requests d’un dépôt, ou toutes celles qui attendent l’utilisateur. */
export default async function (entree: Entree) {
  if (await aucunCompte("bitbucket")) return { prs: [], suivant: null };
  const requete: Record<string, string | number> = {
    state: entree.etat ?? "OPEN",
    direction: entree.role ?? "INCOMING",
    limit: Math.min(100, Math.max(1, entree.limite ?? 50)),
    start: Math.max(0, entree.debut ?? 0),
    order: "NEWEST",
  };
  const adresse =
    entree.projet && entree.depot
      ? `/rest/api/1.0/projects/${encodeURIComponent(entree.projet)}/repos/${encodeURIComponent(entree.depot)}/pull-requests`
      : "/rest/api/1.0/pull-requests";

  const reponse = await bitbucketClient(entree.instance).get<{
    values?: PrBrut[];
    isLastPage?: boolean;
    nextPageStart?: number;
  }>(adresse, requete);
  if (!reponse.ok) erreurBitbucket(reponse);

  return {
    prs: (reponse.body?.values ?? []).map((pr) => normaliserPr(pr)),
    suivant: reponse.body?.isLastPage === false ? reponse.body?.nextPageStart ?? null : null,
  };
}
