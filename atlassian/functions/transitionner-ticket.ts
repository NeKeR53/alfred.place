import { client } from "@alfred/sdk";
import { erreurAtlassian } from "../lib/jira-api";

/** Fait passer un ticket par une de ses transitions ; sans transition choisie, liste celles qui sont disponibles. */
export default async function ({
  instance,
  cle,
  transition,
}: {
  instance?: string;
  cle: string;
  transition?: string;
}) {
  if (!cle.trim()) throw new Error("La clé du ticket est vide.");
  const jira = client("jira", { instance });
  const adresse = `/rest/api/2/issue/${encodeURIComponent(cle.trim())}/transitions`;

  if (!transition?.trim()) {
    const reponse = await jira.get<{
      transitions?: Array<{ id: string; name: string; to?: { name?: string } }>;
    }>(adresse);
    if (!reponse.ok) erreurAtlassian("Jira", reponse);
    return {
      transitionne: false,
      transitions: (reponse.body?.transitions ?? []).map((element) => ({
        id: element.id,
        nom: element.name,
        vers: element.to?.name ?? "",
      })),
    };
  }

  const reponse = await jira.post(adresse, { transition: { id: transition.trim() } });
  if (!reponse.ok) erreurAtlassian("Jira", reponse);
  return { transitionne: true, transitions: [] };
}
