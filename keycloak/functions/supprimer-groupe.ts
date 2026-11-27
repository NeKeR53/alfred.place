import { admin, type Entree, keycloak, segment, verifier } from "../lib/keycloak";

// Supprime un groupe et ses sous-groupes ; les personnes restent dans le royaume.
export default async function ({ instance, groupe }: Entree & { groupe: string }) {
  verifier(await keycloak(instance).delete(admin(`/groups/${segment(groupe)}`)), "la suppression du groupe");
  return { supprime: true, id: groupe };
}
