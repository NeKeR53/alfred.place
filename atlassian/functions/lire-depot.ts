import { aucunCompte } from "../lib/comptes-api";
import { bitbucketClient, erreurBitbucket, normaliserDepot, type DepotBrut } from "../lib/bitbucket-api";

interface BrancheBrute { id?: string; displayId?: string; isDefault?: boolean; latestCommit?: string }

/** Un dépôt Bitbucket : ses branches et sa branche par défaut. */
export default async function ({ instance, projet, depot }: { instance?: string; projet: string; depot: string }) {
  if (await aucunCompte("bitbucket")) return { depot: null, branches: [] };
  if (!projet?.trim() || !depot?.trim()) return { depot: null, branches: [] };
  const clientBitbucket = bitbucketClient(instance);
  const base = `/rest/api/1.0/projects/${encodeURIComponent(projet)}/repos/${encodeURIComponent(depot)}`;

  const [rDepot, rBranches] = await Promise.all([
    clientBitbucket.get<DepotBrut>(base),
    clientBitbucket.get<{ values?: BrancheBrute[]; isLastPage?: boolean }>(`${base}/branches`, {
      limit: 100,
      orderBy: "MODIFICATION",
    }),
  ]);
  if (rDepot.status === 404) return { depot: null, branches: [] };
  if (!rDepot.ok) erreurBitbucket(rDepot);
  if (!rBranches.ok) erreurBitbucket(rBranches);

  const branches = (rBranches.body?.values ?? []).map((branche) => ({
    nom: branche.displayId ?? branche.id ?? "",
    estDefaut: branche.isDefault === true,
    dernierCommit: branche.latestCommit ?? null,
  }));
  const defaut = branches.find((branche) => branche.estDefaut)?.nom ?? null;

  return {
    depot: normaliserDepot(rDepot.body, defaut),
    branches,
  };
}
