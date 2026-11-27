import { admin, type Entree, keycloak, utilisateurDetail, verifier } from "../lib/keycloak";

// Personnes dont l’attribut `attribut` contient exactement `valeur` (recherche q= de Keycloak), attributs compris.
export default async function ({ instance, attribut, valeur }: Entree & { attribut: string; valeur: string }) {
  const nom = attribut.trim();
  if (!nom) throw new Error("Le nom de l’attribut est vide.");
  const utilisateurs = [];
  for (let premier = 0; ; premier += 200) {
    const lot = verifier<Parameters<typeof utilisateurDetail>[0][]>(
      await keycloak(instance).get(admin("/users"), { q: `${nom}:${valeur.trim()}`, first: premier, max: 200, briefRepresentation: false }),
      "la recherche par attribut",
    );
    utilisateurs.push(...lot.map(utilisateurDetail));
    if (lot.length < 200) break;
  }
  return { utilisateurs };
}
