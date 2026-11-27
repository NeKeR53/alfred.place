import { conteneur, docker, type Entree, portainer, verifier } from "../lib/portainer";

// Conteneurs de l’environnement Portainer du compte, arrêtés compris, éventuellement ceux d’une seule pile.
export default async function ({ instance, pile: nomPile }: Entree & { pile?: string }) {
  const lot = verifier<Parameters<typeof conteneur>[0][]>(
    await portainer(instance).get(docker("/containers/json"), {
      all: 1,
      ...(nomPile?.trim() ? { filters: JSON.stringify({ label: [`com.docker.compose.project=${nomPile.trim()}`] }) } : {}),
    }),
    "la liste des conteneurs",
  );
  return { conteneurs: lot.map(conteneur).sort((a, b) => a.nom.localeCompare(b.nom, "fr")) };
}
