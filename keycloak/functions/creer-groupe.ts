import { admin, type Entree, identifiantCree, keycloak, segment, verifier } from "../lib/keycloak";

// Crée un groupe à la racine du royaume, ou sous un groupe parent.
export default async function ({ instance, nom, parent }: Entree & { nom: string; parent?: string }) {
  const propre = nom.trim();
  if (!propre) throw new Error("Le nom du groupe est vide.");
  const chemin = parent ? admin(`/groups/${segment(parent)}/children`) : admin("/groups");
  const reponse = await keycloak(instance).post(chemin, { name: propre });
  verifier(reponse, `la création du groupe « ${propre} »`);
  return { id: identifiantCree(reponse) ?? (reponse.body as { id?: string } | null)?.id ?? null, nom: propre };
}
