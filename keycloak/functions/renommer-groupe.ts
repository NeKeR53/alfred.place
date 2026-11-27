import { admin, type Entree, keycloak, segment, verifier } from "../lib/keycloak";

// Renomme un groupe (ses membres et ses sous-groupes ne changent pas).
export default async function ({ instance, groupe, nom }: Entree & { groupe: string; nom: string }) {
  const propre = nom.trim();
  if (!propre) throw new Error("Le nouveau nom du groupe est vide.");
  const compte = keycloak(instance);
  const actuel = verifier<Record<string, unknown>>(await compte.get(admin(`/groups/${segment(groupe)}`)), "le groupe");
  verifier(await compte.put(admin(`/groups/${segment(groupe)}`), { ...actuel, name: propre }), "le renommage du groupe");
  return { id: groupe, nom: propre };
}
