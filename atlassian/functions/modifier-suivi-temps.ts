import { client } from "@alfred/sdk";
import { erreurAtlassian } from "../lib/jira-api";

/**
 * Écrit le suivi du temps natif d’un ticket (estimation initiale, reste à faire), en secondes ; `null` vide la
 * valeur. Comme OneApp : refusé si le champ Suivi du temps n’est pas modifiable sur ce ticket.
 */
export default async function ({
  instance,
  cle,
  estimationSecondes,
  restantSecondes,
}: {
  instance?: string;
  cle: string;
  estimationSecondes?: number | null;
  restantSecondes?: number | null;
}) {
  const net = cle.trim();
  if (!net) throw new Error("La clé du ticket est vide.");
  const suivi: Record<string, string> = {};
  for (const [nom, valeur] of [["originalEstimate", estimationSecondes], ["remainingEstimate", restantSecondes]] as const) {
    if (valeur === undefined) continue;
    if (valeur !== null && (!Number.isFinite(valeur) || valeur < 0)) throw new Error("La durée Jira est invalide.");
    suivi[nom] = `${Math.round((valeur ?? 0) / 60)}m`;
  }
  if (!Object.keys(suivi).length) throw new Error("Aucune durée à écrire.");
  const jira = client("jira", { instance });
  const meta = await jira.get<{ fields?: Record<string, unknown> }>(`/rest/api/2/issue/${encodeURIComponent(net)}/editmeta`);
  if (!meta.ok) erreurAtlassian("Jira", meta);
  if (!meta.body?.fields || !("timetracking" in meta.body.fields))
    throw new Error("Le champ Suivi du temps n’est pas modifiable sur ce ticket Jira. Rendez-le disponible dans son écran de modification.");
  const reponse = await jira.put(`/rest/api/2/issue/${encodeURIComponent(net)}`, { fields: { timetracking: suivi } });
  if (!reponse.ok) erreurAtlassian("Jira", reponse);
  return { modifie: true };
}
