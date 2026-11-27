import { client } from "@alfred/sdk";

// Comptes OpenBao reliés à l’espace : identifiant et nom, sans adresse ni secret.
export default async function () {
  try {
    return { comptes: await client("openbao").instances() };
  } catch (erreur) {
    return { comptes: [], probleme: (erreur as Error).message };
  }
}
