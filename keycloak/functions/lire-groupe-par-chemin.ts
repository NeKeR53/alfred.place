import { admin, type Entree, groupe, keycloak, verifier } from "../lib/keycloak";

// Groupe désigné par son chemin complet (/ATOM/Développeurs) ; absent, `groupe` vaut null.
export default async function ({ instance, chemin }: Entree & { chemin: string }) {
  const segments = chemin.split("/").map((partie) => partie.trim()).filter(Boolean);
  if (!segments.length) throw new Error("Le chemin du groupe est vide.");
  const reponse = await keycloak(instance).get(admin(`/group-by-path/${segments.map(encodeURIComponent).join("/")}`));
  if (reponse.status === 404) return { groupe: null };
  return { groupe: groupe(verifier<Parameters<typeof groupe>[0]>(reponse, "le groupe")) };
}
