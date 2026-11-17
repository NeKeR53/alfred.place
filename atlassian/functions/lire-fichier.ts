import { aucunCompte } from "../lib/comptes-api";
import { bitbucketClient, cheminEncode, erreurBitbucket } from "../lib/bitbucket-api";

/** Texte d’un fichier d’un dépôt, à une branche donnée. */
export default async function ({
  instance,
  projet,
  depot,
  chemin,
  branche,
}: {
  instance?: string;
  projet: string;
  depot: string;
  chemin: string;
  branche?: string;
}) {
  if (await aucunCompte("bitbucket")) return { contenu: "", lignes: 0, tronque: false };
  if (!projet?.trim() || !depot?.trim() || !chemin?.trim()) return { contenu: "", lignes: 0, tronque: false };
  const propre = chemin.replace(/^\/+|\/+$/g, "");
  const base = `/rest/api/1.0/projects/${encodeURIComponent(projet)}/repos/${encodeURIComponent(depot)}/browse`;
  const requete: Record<string, string | number> = {};
  if (branche) requete.at = branche;

  const reponse = await bitbucketClient(instance).get<{
    lines?: Array<{ text?: string }>;
    size?: number;
    isLastPage?: boolean;
  }>(`${base}/${cheminEncode(propre)}`, requete);
  if (!reponse.ok) erreurBitbucket(reponse);

  const lignes = reponse.body?.lines ?? [];
  return {
    contenu: lignes.map((ligne) => ligne.text ?? "").join("\n"),
    lignes: lignes.length,
    tronque: reponse.body?.isLastPage === false,
  };
}
