import { aucunCompte } from "../lib/comptes-api";
import { bitbucketClient, erreurBitbucket, resoudrePr, liste } from "../lib/bitbucket-api";

interface ChangementBrut {
  type?: string;
  path?: { toString?: string };
  srcPath?: { toString?: string };
}

const TYPES: Record<string, string> = {
  ADD: "ajouté",
  MODIFY: "modifié",
  DELETE: "supprimé",
  MOVE: "déplacé",
  COPY: "copié",
  RENAME: "renommé",
};

/** Fichiers modifiés par une pull request Bitbucket, avec la nature de chaque changement. */
export default async function (entree: { instance?: string; projet?: string; depot?: string; id?: number; pr?: string }) {
  if (await aucunCompte("bitbucket")) return { fichiers: [] };
  const cible = resoudrePr(entree);
  const reponse = await bitbucketClient(entree.instance).get<{ values?: ChangementBrut[] }>(
    `/rest/api/1.0/projects/${encodeURIComponent(cible.projet)}/repos/${encodeURIComponent(cible.depot)}/pull-requests/${cible.id}/changes`,
    { limit: 500 },
  );
  if (!reponse.ok) erreurBitbucket(reponse);
  return {
    fichiers: liste(reponse.body?.values).map((c) => ({
      chemin: c.path?.toString ?? "",
      ancien: c.srcPath?.toString ?? null,
      nature: TYPES[c.type ?? ""] ?? "modifié",
    })),
  };
}
