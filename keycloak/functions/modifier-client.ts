import { admin, type ClientSaisi, type Entree, keycloak, representationClient, segment, verifier } from "../lib/keycloak";

// Modifie un client applicatif ; seuls les champs fournis changent.
export default async function ({ instance, client: id, ...saisie }: Entree & ClientSaisi & { client: string }) {
  const compte = keycloak(instance);
  const chemin = admin(`/clients/${segment(id)}`);
  const actuel = verifier<Record<string, unknown>>(await compte.get(chemin), "le client");
  verifier(await compte.put(chemin, representationClient(saisie, actuel)), "la modification du client");
  return { id, modifie: true };
}
