import { chemin, ecrireDocument, type Entree, lireDocument, metadonnees, openbao, verifier } from "../lib/openbao";

// Retire une clé d’un secret ; la dernière clé retirée supprime le secret et son historique.
export default async function ({ instance, chemin: cheminSecret, cle }: Entree & { chemin: string; cle: string }) {
  const propre = chemin(cheminSecret);
  const document = await lireDocument(instance, propre);
  if (!document.trouve || !(cle in document.valeurs)) return { chemin: decodeURIComponent(propre), cle, supprime: false };
  const { [cle]: _retiree, ...restantes } = document.valeurs;
  if (Object.keys(restantes).length) {
    await ecrireDocument(instance, propre, restantes, document.version);
  } else {
    verifier(await openbao(instance).delete(metadonnees(propre)), "la suppression du secret");
  }
  return { chemin: decodeURIComponent(propre), cle, supprime: true };
}
