import { chemin, type Entree, metadonnees, openbao, verifier } from "../lib/openbao";

// Supprime un secret, toutes ses clés et toutes ses versions.
export default async function ({ instance, chemin: cheminSecret }: Entree & { chemin: string }) {
  const propre = chemin(cheminSecret);
  if (!propre) throw new Error("Le chemin du secret est vide.");
  verifier(await openbao(instance).delete(metadonnees(propre)), "la suppression du secret");
  return { chemin: decodeURIComponent(propre), supprime: true };
}
