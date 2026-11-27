import { admin, type Entree, groupe, keycloak, segment, verifier } from "../lib/keycloak";

// Groupes dont une personne est membre directe.
export default async function ({ instance, utilisateur }: Entree & { utilisateur: string }) {
  const lot = verifier<Parameters<typeof groupe>[0][]>(
    await keycloak(instance).get(admin(`/users/${segment(utilisateur)}/groups`), { briefRepresentation: true, max: 500 }),
    "les groupes de la personne",
  );
  return { groupes: lot.map(groupe) };
}
