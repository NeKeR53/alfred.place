import { admin, type ClientSaisi, type Entree, identifiantCree, keycloak, representationClient, verifier } from "../lib/keycloak";

// Crée un client applicatif OpenID Connect.
export default async function ({ instance, ...saisie }: Entree & ClientSaisi & { clientId: string }) {
  if (!saisie.clientId?.trim()) throw new Error("L’identifiant du client est vide.");
  const reponse = await keycloak(instance).post(admin("/clients"), representationClient({ actif: true, public: false, ...saisie }));
  verifier(reponse, `la création du client « ${saisie.clientId.trim()} »`);
  return { id: identifiantCree(reponse), clientId: saisie.clientId.trim() };
}
