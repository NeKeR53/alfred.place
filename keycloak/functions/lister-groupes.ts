import { admin, type Entree, groupe, keycloak, segment, verifier } from "../lib/keycloak";

// Un niveau de l’arbre des groupes : la racine du royaume, ou les sous-groupes d’un groupe.
export default async function ({ instance, parent, recherche }: Entree & { parent?: string; recherche?: string }) {
  const chemin = parent ? admin(`/groups/${segment(parent)}/children`) : admin("/groups");
  const groupes = [];
  for (let premier = 0; ; premier += 200) {
    const reponse = await keycloak(instance).get(chemin, {
      briefRepresentation: true,
      first: premier,
      max: 200,
      ...(recherche?.trim() && !parent ? { search: recherche.trim() } : {}),
    });
    const lot = verifier<Parameters<typeof groupe>[0][]>(reponse, "la liste des groupes");
    groupes.push(...lot.map(groupe));
    if (lot.length < 200) break;
  }
  return { groupes };
}
