import { chemin, type Entree, metadonnees, openbao, verifier } from "../lib/openbao";

// Un niveau de l’arbre des secrets : sous-dossiers et secrets d’un dossier, sans aucune valeur.
export default async function ({ instance, chemin: dossier }: Entree & { chemin?: string }) {
  const cheminDossier = chemin(dossier);
  const reponse = await openbao(instance).get(metadonnees(cheminDossier ? `${cheminDossier}/` : ""), { list: true });
  if (reponse.status === 404) return { chemin: cheminDossier, dossiers: [], secrets: [] };
  const cles = verifier<{ data?: { keys?: string[] } }>(reponse, "le listage des secrets").data?.keys ?? [];
  const tri = (a: string, b: string) => a.localeCompare(b, "fr");
  return {
    chemin: decodeURIComponent(cheminDossier),
    dossiers: cles.filter((cle) => cle.endsWith("/")).map((cle) => cle.slice(0, -1)).sort(tri),
    secrets: cles.filter((cle) => !cle.endsWith("/")).sort(tri),
  };
}
