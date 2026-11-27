import { admin, type Entree, keycloak, segment, verifier } from "../lib/keycloak";

// Retire une personne d’un groupe.
export default async function ({ instance, utilisateur, groupe }: Entree & { utilisateur: string; groupe: string }) {
  verifier(
    await keycloak(instance).delete(admin(`/users/${segment(utilisateur)}/groups/${segment(groupe)}`)),
    "le retrait du groupe",
  );
  return { utilisateur, groupe, membre: false };
}
