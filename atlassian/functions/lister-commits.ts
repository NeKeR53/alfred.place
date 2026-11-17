import { aucunCompte } from "../lib/comptes-api";
import { bitbucketClient, erreurBitbucket } from "../lib/bitbucket-api";

interface CommitBrut {
  id: string;
  displayId?: string;
  message?: string;
  author?: { name?: string; displayName?: string };
  authorTimestamp?: number;
}

/** Derniers commits d’une branche d’un dépôt Bitbucket (ou d’un chemin de ce dépôt). */
export default async function ({
  instance,
  projet,
  depot,
  branche,
  chemin,
  limite,
}: {
  instance?: string;
  projet: string;
  depot: string;
  branche?: string;
  chemin?: string;
  limite?: number;
}) {
  if ((await aucunCompte("bitbucket")) || !projet?.trim() || !depot?.trim()) return { commits: [] };
  const query: Record<string, string | number> = { limit: Math.min(100, Math.max(1, limite ?? 30)) };
  if (branche?.trim()) query.until = branche.trim();
  if (chemin?.trim()) query.path = chemin.trim();
  const reponse = await bitbucketClient(instance).get<{ values?: CommitBrut[] }>(
    `/rest/api/1.0/projects/${encodeURIComponent(projet)}/repos/${encodeURIComponent(depot)}/commits`,
    query,
  );
  if (!reponse.ok) erreurBitbucket(reponse);
  return {
    commits: (reponse.body?.values ?? []).map((c) => ({
      id: c.id,
      court: c.displayId ?? c.id.slice(0, 11),
      message: c.message ?? "",
      auteur: c.author?.displayName ?? c.author?.name ?? "",
      date: c.authorTimestamp ?? null,
    })),
  };
}
