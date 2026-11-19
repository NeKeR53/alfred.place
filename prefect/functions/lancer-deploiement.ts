import { erreurPrefect, type FlowRunPrefect, prefect } from "../lib/prefect-api";

export default async function (input: { instance?: string; deploiement: string; parametres?: Record<string, unknown> }) {
  if (!input.deploiement) throw new Error("Indiquez le déploiement à lancer.");
  const corps = input.parametres && Object.keys(input.parametres).length > 0 ? { parameters: input.parametres } : {};
  const reponse = await prefect(input.instance).post<FlowRunPrefect>(
    `/deployments/${encodeURIComponent(input.deploiement)}/create_flow_run`,
    corps,
  );
  if (!reponse.ok) throw erreurPrefect(reponse.status, "le lancement de ce déploiement", reponse.body);
  return {
    lance: true,
    execution: { id: reponse.body.id, nom: reponse.body.name, etat: reponse.body.state?.type ?? "SCHEDULED" },
  };
}
