import { client } from "@alfred/sdk";
import { erreurAtlassian } from "../lib/jira-api";

interface Entree {
  instance?: string;
  cle: string;
  resume?: string;
  description?: string;
  assigne?: string;
  priorite?: string;
  echeance?: string;
  etiquettes?: string;
}

function personne(identifiant: string) {
  const net = identifiant.trim();
  if (!net || net === "aucun") return null;
  const compteCloud = /^[0-9a-f]{24}$/i.test(net) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(net);
  return compteCloud ? { accountId: net } : { name: net };
}

/** Modifie les champs courants d’un ticket : résumé, description, assignation, priorité, échéance, étiquettes. */
export default async function (entree: Entree) {
  const cle = entree.cle.trim();
  if (!cle) throw new Error("La clé du ticket est vide.");
  const champs: Record<string, unknown> = {};
  if (entree.resume !== undefined) champs.summary = entree.resume.trim();
  if (entree.description !== undefined) champs.description = entree.description;
  if (entree.assigne !== undefined) champs.assignee = personne(entree.assigne);
  if (entree.priorite !== undefined) champs.priority = entree.priorite ? { name: entree.priorite } : null;
  if (entree.echeance !== undefined) champs.duedate = entree.echeance || null;
  if (entree.etiquettes !== undefined) {
    champs.labels = entree.etiquettes
      .split(",")
      .map((etiquette) => etiquette.trim())
      .filter(Boolean);
  }
  if (Object.keys(champs).length === 0) throw new Error("Aucun champ à modifier.");

  const reponse = await client("jira", { instance: entree.instance }).put(`/rest/api/2/issue/${encodeURIComponent(cle)}`, {
    fields: champs,
  });
  if (!reponse.ok) erreurAtlassian("Jira", reponse);
  return { modifie: true };
}
