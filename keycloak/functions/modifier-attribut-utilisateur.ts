import { admin, type Entree, keycloak, segment, verifier } from "../lib/keycloak";

const ignore = (nom: string) =>
  `Keycloak a accepté la modification sans enregistrer l’attribut « ${nom} ». Déclarez-le dans Realm settings › User profile (lecture et écriture réservées aux administrateurs) ou réglez Unmanaged attributes sur « Admin can edit ».`;

// Remplace les valeurs d’un attribut d’une personne, sans toucher au reste de sa fiche, puis vérifie qu’il est bien
// enregistré (Keycloak peut accepter la modification et ignorer un attribut non déclaré dans le profil utilisateur).
export default async function ({
  instance,
  utilisateur,
  attribut,
  valeurs,
}: Entree & { utilisateur: string; attribut: string; valeurs: string[] }) {
  const nom = attribut.trim();
  if (!utilisateur.trim()) throw new Error("Le compte Keycloak de la personne est introuvable.");
  if (!nom) throw new Error("Le nom de l’attribut est vide.");
  const compte = keycloak(instance);
  const chemin = admin(`/users/${segment(utilisateur)}`);
  const fiche = verifier<Record<string, unknown>>(await compte.get(chemin), "la personne");
  const actuels = fiche.attributes && typeof fiche.attributes === "object" && !Array.isArray(fiche.attributes) ? (fiche.attributes as Record<string, unknown>) : {};
  const propres = [...new Set(valeurs.map((v) => v.trim()).filter(Boolean))];
  const reponse = await compte.put(chemin, { ...fiche, attributes: { ...actuels, [nom]: propres } });
  if (reponse.status === 400)
    throw new Error(`Keycloak refuse l’attribut « ${nom} ». Déclarez-le dans Realm settings › User profile (lecture et écriture réservées aux administrateurs), ou autorisez les attributs non gérés.`);
  if (reponse.status === 403)
    throw new Error("Keycloak refuse la mise à jour du compte (HTTP 403) : elle demande le rôle realm-management manage-users.");
  verifier(reponse, "la mise à jour de la personne");
  const relue = verifier<{ attributes?: Record<string, unknown> }>(await compte.get(chemin), "la personne");
  const enregistre = relue.attributes?.[nom];
  const lus = (Array.isArray(enregistre) ? enregistre.map(String) : []).sort();
  if (lus.join("\u0000") !== [...propres].sort().join("\u0000")) {
    // La fiche peut taire un attribut pourtant enregistré : la recherche par attribut, qui lit le stockage, tranche.
    const trouves = await Promise.all(
      propres.map(async (valeur) => {
        const lot = await compte.get(admin("/users"), { q: `${nom}:${valeur}`, briefRepresentation: true, max: 200 });
        return lot.ok && Array.isArray(lot.body) && (lot.body as { id: string }[]).some((u) => u.id === utilisateur);
      }),
    );
    if (!propres.length ? lus.length > 0 : !trouves.every(Boolean)) throw new Error(ignore(nom));
  }
  return { utilisateur, attribut: nom, valeurs: propres };
}
