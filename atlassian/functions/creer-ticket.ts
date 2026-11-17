import { client } from "@alfred/sdk";
import { erreurAtlassian, urlTicket } from "../lib/jira-api";

interface Entree {
  instance?: string;
  projet: string;
  resume: string;
  description?: string;
  type?: string;
  priorite?: string;
  /** Clé du ticket parent : le ticket est alors créé en sous-tâche. */
  parent?: string;
}

/** Crée un ticket dans un projet Jira. */
export default async function (entree: Entree) {
  if (!entree.projet.trim()) throw new Error("Le projet est vide.");
  if (!entree.resume.trim()) throw new Error("Le résumé est vide.");
  const champs: Record<string, unknown> = {
    project: { key: entree.projet.trim() },
    summary: entree.resume.trim(),
    issuetype: { name: entree.type?.trim() || "Task" },
  };
  const jira = client("jira", { instance: entree.instance });
  if (entree.parent?.trim()) {
    // Le type « sous-tâche » porte un nom différent selon la langue de l’instance : on le cherche.
    const meta = await jira.get<{ projects?: Array<{ issuetypes?: Array<{ name: string; subtask?: boolean }> }> }>(
      "/rest/api/2/issue/createmeta",
      { projectKeys: entree.projet.trim() },
      { cache: 3600 },
    );
    const sousTache = meta.body?.projects?.[0]?.issuetypes?.find((t) => t.subtask)?.name;
    if (!sousTache) throw new Error("Ce projet n’accepte pas de sous-tâches.");
    champs.issuetype = { name: sousTache };
    champs.parent = { key: entree.parent.trim() };
  }
  if (entree.description?.trim()) champs.description = entree.description.trim();
  if (entree.priorite?.trim()) champs.priority = { name: entree.priorite.trim() };

  const reponse = await jira.post<{ key?: string; id?: string; self?: string }>(
    "/rest/api/2/issue",
    { fields: champs },
  );
  if (!reponse.ok) erreurAtlassian("Jira", reponse);
  const cle = reponse.body?.key ?? "";
  return { cle, url: urlTicket(reponse.body?.self, cle) };
}
