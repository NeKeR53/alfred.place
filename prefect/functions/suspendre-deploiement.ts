import { erreurPrefect, prefect } from "../lib/prefect-api";

export default async function (input: { instance?: string; deploiement: string; suspendre: boolean }) {
  if (!input.deploiement) throw new Error("Indiquez le déploiement.");
  const reponse = await prefect(input.instance).patch(`/deployments/${encodeURIComponent(input.deploiement)}`, {
    paused: Boolean(input.suspendre),
  });
  if (!reponse.ok) throw erreurPrefect(reponse.status, "ce déploiement", reponse.body);
  return { enPause: Boolean(input.suspendre) };
}
