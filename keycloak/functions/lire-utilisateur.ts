import { admin, type Entree, keycloak, segment, utilisateurDetail, verifier } from "../lib/keycloak";

type GroupeBrut = { id: string; name: string; path?: string; attributes?: Record<string, unknown> };
type Brut = Parameters<typeof utilisateurDetail>[0];

const attributs = (brut: unknown): Record<string, string[]> =>
  !brut || typeof brut !== "object" || Array.isArray(brut)
    ? {}
    : Object.fromEntries(
        Object.entries(brut as Record<string, unknown>).map(([cle, v]) => [cle, (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string")]),
      );

// Une personne, désignée par son identifiant interne, son identifiant de connexion exact ou son courriel exact, avec
// ses attributs ; `groupes: true` y joint tous ses groupes (attributs compris). Introuvable : `utilisateur` vaut null.
export default async function ({
  instance,
  utilisateur,
  identifiant,
  email,
  groupes,
}: Entree & { utilisateur?: string; identifiant?: string; email?: string; groupes?: boolean }) {
  const compte = keycloak(instance);
  let brut: Brut | undefined;
  if (utilisateur?.trim()) {
    const reponse = await compte.get(admin(`/users/${segment(utilisateur)}`));
    brut = reponse.status === 404 ? undefined : verifier<Brut>(reponse, "la personne");
  } else if (email?.trim() || identifiant?.trim()) {
    const requete: Record<string, string | boolean> = email?.trim()
      ? { email: email.trim(), exact: true, briefRepresentation: false }
      : { username: identifiant?.trim() ?? "", exact: true, briefRepresentation: false };
    const lot = verifier<Brut[]>(await compte.get(admin("/users"), requete), "la recherche de la personne");
    const cherche = (email ?? identifiant ?? "").trim().toLowerCase();
    brut = lot.find((u) => (email?.trim() ? u.email?.toLowerCase() : u.username.toLowerCase()) === cherche);
  } else throw new Error("Donnez l’identifiant, l’identifiant de connexion ou le courriel de la personne.");
  if (!brut) return { utilisateur: null, ...(groupes ? { groupes: [] } : {}) };
  if (!groupes) return { utilisateur: utilisateurDetail(brut) };
  const lot = verifier<GroupeBrut[]>(
    await compte.get(admin(`/users/${segment(brut.id)}/groups`), { briefRepresentation: false, max: 500 }),
    "les groupes de la personne",
  );
  return {
    utilisateur: utilisateurDetail(brut),
    groupes: lot.map((g) => ({ id: g.id, nom: g.name, chemin: g.path ?? `/${g.name}`, attributs: attributs(g.attributes) })),
  };
}
