import { client } from "@alfred/sdk";

// Comptes Keycloak reliés à l’espace : identifiant et nom, sans adresse ni secret.
export default async function () {
  try {
    return { comptes: await client("keycloak").instances() };
  } catch (erreur) {
    return { comptes: [], probleme: (erreur as Error).message };
  }
}
