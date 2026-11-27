import { docker, type Entree, portainer, segment } from "../lib/portainer";

// Ouvre le journal en direct d’un conteneur et rend le canal que la page lit (LogViewer).
// `horodatage` : chaque ligne commence par son heure Docker, que le LogViewer place dans sa colonne d’horodatage.
export default async function ({
  instance,
  conteneur,
  lignes,
  horodatage,
}: Entree & { conteneur: string; lignes?: number; horodatage?: boolean }) {
  const reponse = await portainer(instance).stream(docker(`/containers/${segment(conteneur)}/logs`), {
    query: {
      follow: 1,
      stdout: 1,
      stderr: 1,
      tail: Math.min(Math.max(Math.trunc(lignes ?? 200), 0), 10_000),
      ...(horodatage ? { timestamps: 1 } : {}),
    },
    format: "docker",
  });
  if (!reponse.ok || !reponse.channel) throw new Error(`Portainer a répondu ${reponse.status} pour le journal du conteneur.`);
  return { canal: reponse.channel };
}
