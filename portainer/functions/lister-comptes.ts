import { client } from "@alfred/sdk";

// Comptes Portainer reliés à l’espace : identifiant et nom, sans adresse ni secret.
export default async function () {
  try {
    return { comptes: await client("portainer").instances() };
  } catch (erreur) {
    return { comptes: [], probleme: (erreur as Error).message };
  }
}
