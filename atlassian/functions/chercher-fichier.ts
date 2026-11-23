import { aucunCompte } from "../lib/comptes-api";
import { bitbucketClient, erreurBitbucket, liste } from "../lib/bitbucket-api";

function simplifier(texte: string): string {
  return texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** « Aller au fichier » : cherche un fichier par son nom ou son chemin dans tout un dépôt Bitbucket. */
export default async function ({
  instance,
  projet,
  depot,
  branche,
  recherche,
}: {
  instance?: string;
  projet: string;
  depot: string;
  branche?: string;
  recherche: string;
}) {
  const mots = simplifier(recherche ?? "").split(/[\s/]+/).filter(Boolean);
  if ((await aucunCompte("bitbucket")) || !projet?.trim() || !depot?.trim() || mots.length === 0) return { fichiers: [] };
  const requete: Record<string, string | number> = { limit: 5000 };
  if (branche?.trim()) requete.at = branche.trim();
  const reponse = await bitbucketClient(instance).get<{ values?: string[] }>(
    `/rest/api/1.0/projects/${encodeURIComponent(projet)}/repos/${encodeURIComponent(depot)}/files`,
    requete,
    { cache: 120 },
  );
  if (!reponse.ok) erreurBitbucket(reponse);
  const trouves = liste(reponse.body?.values)
    .filter((chemin) => {
      const cible = simplifier(chemin);
      return mots.every((mot) => cible.includes(mot));
    })
    // Les fichiers dont le nom correspond passent avant ceux dont seul le dossier correspond.
    .sort((a, b) => {
      const nomA = simplifier(a.split("/").pop() ?? "");
      const nomB = simplifier(b.split("/").pop() ?? "");
      const scoreA = mots.every((m) => nomA.includes(m)) ? 0 : 1;
      const scoreB = mots.every((m) => nomB.includes(m)) ? 0 : 1;
      return scoreA - scoreB || a.length - b.length;
    })
    .slice(0, 30);
  return { fichiers: trouves.map((chemin) => ({ chemin, nom: chemin.split("/").pop() ?? chemin })) };
}
