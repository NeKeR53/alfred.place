import { admin, type Entree, identifiantCree, keycloak, verifier } from "../lib/keycloak";

// Crée une personne dans le royaume, sans mot de passe : elle se connecte par le fournisseur d’identité du royaume.
export default async function ({
  instance,
  identifiant,
  email,
  prenom,
  nom,
}: Entree & { identifiant: string; email?: string; prenom?: string; nom?: string }) {
  const propre = identifiant.trim();
  if (!propre) throw new Error("L’identifiant de la personne est vide.");
  const reponse = await keycloak(instance).post(admin("/users"), {
    username: propre,
    enabled: true,
    ...(email?.trim() ? { email: email.trim() } : {}),
    ...(prenom?.trim() ? { firstName: prenom.trim() } : {}),
    ...(nom?.trim() ? { lastName: nom.trim() } : {}),
  });
  verifier(reponse, `la création de « ${propre} »`);
  return { id: identifiantCree(reponse), identifiant: propre };
}
