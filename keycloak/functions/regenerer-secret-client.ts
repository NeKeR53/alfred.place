import { admin, type Entree, keycloak, segment, verifier } from "../lib/keycloak";

// Remplace le secret d’un client confidentiel ; l’ancien cesse aussitôt de fonctionner.
export default async function ({ instance, client: id }: Entree & { client: string }) {
  const corps = verifier<{ value?: string }>(
    await keycloak(instance).post(admin(`/clients/${segment(id)}/client-secret`)),
    "le renouvellement du secret",
  );
  return { client: id, secret: corps.value ?? null };
}
