import { admin, type Entree, keycloak, segment, utilisateur, verifier } from "../lib/keycloak";

// Membres directs d’un groupe, page par page.
export default async function ({ instance, groupe }: Entree & { groupe: string }) {
  const membres = [];
  for (let premier = 0; ; premier += 200) {
    const reponse = await keycloak(instance).get(admin(`/groups/${segment(groupe)}/members`), {
      first: premier,
      max: 200,
      briefRepresentation: true,
    });
    const lot = verifier<Parameters<typeof utilisateur>[0][]>(reponse, "les membres du groupe");
    membres.push(...lot.map(utilisateur));
    if (lot.length < 200) break;
  }
  return { membres };
}
