import { admin, type Entree, keycloak, segment, verifier } from "../lib/keycloak";

// Attribue un rôle du royaume à une personne.
export default async function ({ instance, utilisateur, role }: Entree & { utilisateur: string; role: string }) {
  const compte = keycloak(instance);
  const representation = verifier<Record<string, unknown>>(await compte.get(admin(`/roles/${segment(role)}`)), "le rôle");
  verifier(
    await compte.post(admin(`/users/${segment(utilisateur)}/role-mappings/realm`), [representation]),
    "l’attribution du rôle",
  );
  return { utilisateur, role, attribue: true };
}
