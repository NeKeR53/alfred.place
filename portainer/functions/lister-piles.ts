import { type Entree, environnementDuCompte, pile, portainer, verifier } from "../lib/portainer";

// Piles (stacks) de l’environnement Portainer du compte.
export default async function ({ instance }: Entree) {
  const environnement = await environnementDuCompte(instance);
  const lot = verifier<Parameters<typeof pile>[0][]>(
    await portainer(instance).get("/api/stacks", { filters: JSON.stringify({ EndpointID: environnement }) }),
    "la liste des piles",
  );
  return { piles: lot.map(pile).sort((a, b) => a.nom.localeCompare(b.nom, "fr")) };
}
