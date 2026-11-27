import { admin, type Entree, keycloak, segment, verifier } from "../lib/keycloak";

// Supprime un client applicatif du royaume.
export default async function ({ instance, client: id }: Entree & { client: string }) {
  verifier(await keycloak(instance).delete(admin(`/clients/${segment(id)}`)), "la suppression du client");
  return { id, supprime: true };
}
