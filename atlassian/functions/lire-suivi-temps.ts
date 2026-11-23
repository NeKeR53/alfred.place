import { client } from "@alfred/sdk";
import { aucunCompte } from "../lib/comptes-api";
import { erreurAtlassian } from "../lib/jira-api";

/** Durée d’une journée de travail configurée dans Jira (suivi du temps), sans supposer qu’un jour vaut huit heures. */
export default async function ({ instance }: { instance?: string }) {
  if (await aucunCompte("jira")) return { heuresParJour: 8, configure: false };
  const reponse = await client("jira", { instance }).get<{ timeTrackingConfiguration?: { workingHoursPerDay?: number } }>(
    "/rest/api/2/configuration",
  );
  if (!reponse.ok) erreurAtlassian("Jira", reponse);
  const heures = reponse.body?.timeTrackingConfiguration?.workingHoursPerDay;
  if (typeof heures !== "number" || !Number.isFinite(heures) || heures <= 0 || heures > 24)
    throw new Error("La durée d’une journée de travail n’est pas disponible dans la configuration Jira.");
  return { heuresParJour: heures, configure: true };
}
