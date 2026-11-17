import { aucunCompte } from "../lib/comptes-api";
import { bitbucketClient, erreurBitbucket, normaliserDepot, type DepotBrut } from "../lib/bitbucket-api";

interface Entree { instance?: string; recherche?: string; limite?: number; debut?: number }

/** Dépôts Bitbucket auxquels l’utilisateur a accès, filtrables par nom. */
export default async function (entree: Entree) {
  const debut = Math.max(0, entree.debut ?? 0);
  if (await aucunCompte("bitbucket")) return { depots: [], total: 0, suivant: null };
  const requete: Record<string, string | number | boolean> = {
    limit: Math.min(100, Math.max(1, entree.limite ?? 50)),
    start: debut,
  };
  if (entree.recherche?.trim()) requete.name = entree.recherche.trim();

  const reponse = await bitbucketClient(entree.instance).get<{
    values?: DepotBrut[];
    size?: number;
    isLastPage?: boolean;
    nextPageStart?: number;
  }>("/rest/api/1.0/repos", requete);
  if (!reponse.ok) erreurBitbucket(reponse);

  const depots = (reponse.body?.values ?? []).map((depot) => normaliserDepot(depot));
  return {
    depots,
    total: reponse.body?.size ?? depots.length,
    suivant: reponse.body?.isLastPage === false ? reponse.body?.nextPageStart ?? null : null,
  };
}
