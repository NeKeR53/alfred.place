import { admin, type Entree, keycloak, segment, utilisateurDetail, verifier } from "../lib/keycloak";

type GroupeBrut = { id: string; name: string; path?: string; attributes?: Record<string, unknown> };

/** Valeurs d’attributs Keycloak, toujours en listes de textes. */
function attributs(brut: unknown): Record<string, string[]> {
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return {};
  return Object.fromEntries(
    Object.entries(brut as Record<string, unknown>).map(([cle, valeurs]) => [
      cle,
      (Array.isArray(valeurs) ? valeurs : [valeurs]).filter((v): v is string => typeof v === "string"),
    ]),
  );
}

// Groupes désignés par leur chemin complet, avec leurs attributs et tous leurs membres directs (attributs compris).
// Un chemin absent du royaume rend `groupe: null` ; les chemins sont lus six à la fois.
export default async function ({ instance, chemins }: Entree & { chemins: string[] }) {
  const compte = keycloak(instance);
  const file = [...new Set(chemins.map((c) => c.trim()).filter(Boolean))];
  const resultats = new Map<string, unknown>();
  const lire = async (chemin: string) => {
    const segments = chemin.split("/").map((partie) => partie.trim()).filter(Boolean);
    const reponse = await compte.get(admin(`/group-by-path/${segments.map(encodeURIComponent).join("/")}`));
    if (reponse.status === 404) return { chemin, groupe: null, membres: [] };
    const brut = verifier<GroupeBrut>(reponse, `le groupe ${chemin}`);
    const membres = [];
    for (let premier = 0; ; premier += 200) {
      const lot = verifier<Parameters<typeof utilisateurDetail>[0][]>(
        await compte.get(admin(`/groups/${segment(brut.id)}/members`), { first: premier, max: 200, briefRepresentation: false }),
        `les membres du groupe ${chemin}`,
      );
      membres.push(...lot.map(utilisateurDetail));
      if (lot.length < 200) break;
    }
    return {
      chemin,
      groupe: { id: brut.id, nom: brut.name, chemin: brut.path ?? chemin, attributs: attributs(brut.attributes) },
      membres,
    };
  };
  const restants = [...file];
  await Promise.all(
    Array.from({ length: Math.min(6, restants.length) }, async () => {
      for (let chemin = restants.shift(); chemin; chemin = restants.shift()) resultats.set(chemin, await lire(chemin));
    }),
  );
  return { groupes: file.map((chemin) => resultats.get(chemin)) };
}
