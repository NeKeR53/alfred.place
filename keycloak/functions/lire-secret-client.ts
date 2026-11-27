import { admin, type Entree, keycloak, segment, verifier } from "../lib/keycloak";

// Secret d’un client confidentiel, rendu scellé : une référence que la page affiche par « Afficher ».
export default async function ({ instance, client: id }: Entree & { client: string }) {
  const corps = verifier<{ value?: string }>(
    await keycloak(instance).get(admin(`/clients/${segment(id)}/client-secret`)),
    "le secret du client",
  );
  return { client: id, secret: corps.value ?? null };
}
