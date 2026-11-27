import { admin, type Entree, keycloak, segment, verifier } from "../lib/keycloak";

// Retire à une personne un rôle du royaume.
export default async function ({ instance, utilisateur, role }: Entree & { utilisateur: string; role: string }) {
  const compte = keycloak(instance);
  const representation = verifier<Record<string, unknown>>(await compte.get(admin(`/roles/${segment(role)}`)), "le rôle");
  verifier(
    await compte.request({
      method: "DELETE",
      path: admin(`/users/${segment(utilisateur)}/role-mappings/realm`),
      body: [representation],
    }),
    "le retrait du rôle",
  );
  return { utilisateur, role, attribue: false };
}
