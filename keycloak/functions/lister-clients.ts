import { admin, clientApplicatif, type Entree, keycloak, verifier } from "../lib/keycloak";

// Clients applicatifs (OpenID Connect) du royaume, triés par identifiant.
export default async function ({ instance }: Entree) {
  const lot = verifier<Parameters<typeof clientApplicatif>[0][]>(
    await keycloak(instance).get(admin("/clients"), { first: 0, max: 1000 }),
    "la liste des clients",
  );
  const clients = lot.map(clientApplicatif).sort((a, b) => a.clientId.localeCompare(b.clientId, "fr"));
  return { clients };
}
