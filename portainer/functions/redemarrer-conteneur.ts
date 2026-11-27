import { docker, type Entree, portainer, segment, verifier } from "../lib/portainer";

// Redémarre un conteneur.
export default async function ({ instance, conteneur }: Entree & { conteneur: string }) {
  verifier(await portainer(instance).post(docker(`/containers/${segment(conteneur)}/restart`)), "le redémarrage du conteneur");
  return { conteneur, redemarre: true };
}
