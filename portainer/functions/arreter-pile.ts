import { type Entree, environnementDuCompte, pile, portainer, segment, verifier } from "../lib/portainer";

// Arrête une pile : ses conteneurs s’arrêtent, sa définition est gardée.
export default async function ({ instance, pile: id }: Entree & { pile: number }) {
  const environnement = await environnementDuCompte(instance);
  const brute = verifier<Parameters<typeof pile>[0]>(
    await portainer(instance).request({ method: "POST", path: `/api/stacks/${segment(id)}/stop`, query: { endpointId: environnement } }),
    "l’arrêt de la pile",
  );
  return pile(brute);
}
