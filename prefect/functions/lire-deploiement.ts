import { decrireDeploiement, type DeploiementPrefect, erreurPrefect, filtrer, nomsFlows, prefect } from "../lib/prefect-api";

export default async function (input: { instance?: string; deploiement?: string }) {
  let id = input.deploiement;
  if (!id) {
    // Sans déploiement demandé : le premier par ordre alphabétique.
    const premiers = await filtrer<{ id: string }[]>(input.instance, "/deployments/filter", { sort: "NAME_ASC", limit: 1 }, "les déploiements");
    if (!premiers[0]) return { deploiement: null };
    id = premiers[0].id;
  }
  const reponse = await prefect(input.instance).get<DeploiementPrefect>(`/deployments/${encodeURIComponent(id)}`);
  if (reponse.status === 404) return { deploiement: null };
  if (!reponse.ok) throw erreurPrefect(reponse.status, "ce déploiement", reponse.body);
  const flows = await nomsFlows(input.instance, [reponse.body.flow_id]);
  return { deploiement: decrireDeploiement(reponse.body, flows) };
}
