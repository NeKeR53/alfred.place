import { admin, type Entree, keycloak, role, segment, verifier } from "../lib/keycloak";

// Rôles du royaume, ou rôles d’un client applicatif.
export default async function ({ instance, client: id }: Entree & { client?: string }) {
  const chemin = id ? admin(`/clients/${segment(id)}/roles`) : admin("/roles");
  const lot = verifier<Parameters<typeof role>[0][]>(
    await keycloak(instance).get(chemin, { first: 0, max: 1000, briefRepresentation: true }),
    "la liste des rôles",
  );
  return { roles: lot.map(role).sort((a, b) => a.nom.localeCompare(b.nom, "fr")) };
}
