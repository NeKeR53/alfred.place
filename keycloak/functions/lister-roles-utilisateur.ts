import { admin, type Entree, keycloak, role, segment, verifier } from "../lib/keycloak";

// Rôles du royaume attribués directement à une personne.
export default async function ({ instance, utilisateur }: Entree & { utilisateur: string }) {
  const lot = verifier<Parameters<typeof role>[0][]>(
    await keycloak(instance).get(admin(`/users/${segment(utilisateur)}/role-mappings/realm`)),
    "les rôles de la personne",
  );
  return { roles: lot.map(role) };
}
