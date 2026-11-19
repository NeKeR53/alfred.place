import { posteFauxPrefect } from "../lib/faux-prefect";
import { nomsDesFlows, type Poste, tousLesDeploiements } from "../lib/liste-deploiements";
import { decrireDeploiement, filtrer } from "../lib/prefect-api";

/** Filtre envoyé au compte Prefect. */
const posteCompte =
  (instance?: string): Poste =>
  (chemin, corps, quoi) =>
    filtrer(instance, chemin, corps, quoi);

export default async function (input: { instance?: string; texte?: string; limite?: number; simulation?: boolean }) {
  const maximum = Math.min(Math.max(input.limite ?? 2000, 1), 2000);
  const texte = (input.texte ?? "").trim();
  const filtre = texte ? { deployments: { name: { like_: texte } } } : {};
  const poste = input.simulation ? posteFauxPrefect : posteCompte(input.instance);

  const [{ deploiements, incomplet }, total] = await Promise.all([
    tousLesDeploiements(poste, filtre, maximum),
    poste<number>("/deployments/count", filtre, "le nombre de déploiements").catch(() => null),
  ]);
  const flows = await nomsDesFlows(poste, deploiements.map((d) => d.flow_id));

  return {
    total: typeof total === "number" ? total : deploiements.length,
    incomplet,
    deploiements: deploiements.map((d) => decrireDeploiement(d, flows)),
  };
}
