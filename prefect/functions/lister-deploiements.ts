import { decrireDeploiement, type DeploiementPrefect, filtrer, nomsFlows, prefect } from "../lib/prefect-api";

export default async function (input: { instance?: string; texte?: string; limite?: number }) {
  const limite = Math.min(Math.max(input.limite ?? 100, 1), 200);
  const texte = (input.texte ?? "").trim();
  const filtre = texte ? { deployments: { name: { like_: texte } } } : {};

  const [deploiements, total] = await Promise.all([
    filtrer<DeploiementPrefect[]>(input.instance, "/deployments/filter", { ...filtre, sort: "NAME_ASC", limit: limite }, "les déploiements"),
    prefect(input.instance)
      .post<number>("/deployments/count", filtre)
      .then((r) => (r.ok && typeof r.body === "number" ? r.body : null))
      .catch(() => null),
  ]);
  const flows = await nomsFlows(input.instance, deploiements.map((d) => d.flow_id));

  return {
    total: total ?? deploiements.length,
    deploiements: deploiements.map((d) => decrireDeploiement(d, flows)),
  };
}
