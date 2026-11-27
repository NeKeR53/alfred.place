import { base64EnOctets, docker, type Entree, lignesDocker, portainer, segment, verifier } from "../lib/portainer";

// Dernières lignes du journal d’un conteneur, sorties standard et d’erreur.
export default async function ({ instance, conteneur, lignes }: Entree & { conteneur: string; lignes?: number }) {
  const nombre = Math.min(Math.max(Math.trunc(lignes ?? 200), 1), 5000);
  const reponse = await portainer(instance).request({
    path: docker(`/containers/${segment(conteneur)}/logs`),
    query: { stdout: 1, stderr: 1, tail: nombre, timestamps: 0 },
    responseType: "base64",
  });
  const corps = verifier<string>(reponse, "le journal du conteneur");
  return { conteneur, lignes: lignesDocker(base64EnOctets(corps)) };
}
