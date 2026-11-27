import { admin, type Entree, keycloak, segment, verifier } from "../lib/keycloak";

// Ajoute une personne à un groupe (sans effet si elle en est déjà membre).
export default async function ({ instance, utilisateur, groupe }: Entree & { utilisateur: string; groupe: string }) {
  verifier(
    await keycloak(instance).put(admin(`/users/${segment(utilisateur)}/groups/${segment(groupe)}`)),
    "l’ajout au groupe",
  );
  return { utilisateur, groupe, membre: true };
}
