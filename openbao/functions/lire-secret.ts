import { chemin, type Entree, lireDocument } from "../lib/openbao";

// Clés d’un secret et leurs valeurs scellées : chaque valeur est une référence (« Afficher », .env, copie).
export default async function ({ instance, chemin: cheminSecret }: Entree & { chemin: string }) {
  const propre = chemin(cheminSecret);
  if (!propre) throw new Error("Le chemin du secret est vide.");
  const document = await lireDocument(instance, propre);
  return {
    chemin: decodeURIComponent(propre),
    trouve: document.trouve,
    version: document.version,
    cles: Object.keys(document.valeurs).sort((a, b) => a.localeCompare(b, "fr")),
    valeurs: document.valeurs,
  };
}
