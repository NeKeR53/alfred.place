import { chemin, ecrireDocument, type Entree, lireDocument } from "../lib/openbao";

// Ajoute ou remplace une clé d’un secret (créé s’il n’existe pas) ; les autres clés sont gardées sans être lues en clair.
export default async function ({
  instance,
  chemin: cheminSecret,
  cle,
  valeur,
}: Entree & { chemin: string; cle: string; valeur: string }) {
  const propre = chemin(cheminSecret);
  const nom = cle.trim();
  if (!propre || !nom) throw new Error("Le chemin et la clé sont obligatoires.");
  if (!valeur) throw new Error("La valeur est vide.");
  const document = await lireDocument(instance, propre);
  const version = await ecrireDocument(instance, propre, { ...document.valeurs, [nom]: valeur }, document.version);
  return { chemin: decodeURIComponent(propre), cle: nom, version };
}
