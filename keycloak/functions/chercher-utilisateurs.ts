import { admin, type Entree, keycloak, utilisateur, verifier } from "../lib/keycloak";

// Personnes du royaume dont l’identifiant, le nom ou le courriel contient le texte cherché.
export default async function ({ instance, recherche, email }: Entree & { recherche?: string; email?: string }) {
  const requete = email?.trim()
    ? { email: email.trim(), exact: true }
    : { search: recherche?.trim() ?? "", max: 50, briefRepresentation: true };
  const lot = verifier<Parameters<typeof utilisateur>[0][]>(
    await keycloak(instance).get(admin("/users"), requete),
    "la recherche de personnes",
  );
  return { utilisateurs: lot.map(utilisateur) };
}
