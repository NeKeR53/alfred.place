import { type Entree, environnementDuCompte, pile, portainer, segment, verifier } from "../lib/portainer";

// Démarre une pile arrêtée.
export default async function ({ instance, pile: id }: Entree & { pile: number }) {
  const environnement = await environnementDuCompte(instance);
  const brute = verifier<Parameters<typeof pile>[0]>(
    await portainer(instance).request({ method: "POST", path: `/api/stacks/${segment(id)}/start`, query: { endpointId: environnement } }),
    "le démarrage de la pile",
  );
  return pile(brute);
}
