import { client } from "@alfred/sdk";
import { erreurAtlassian } from "../lib/jira-api";

interface Entree {
  instance?: string;
  cle: string;
  autre: string;
  /** Nom du type de lien (« Blocks »). */
  type: string;
  /** « sortant » : ce ticket [bloque] l’autre ; « entrant » : ce ticket [est bloqué par] l’autre. */
  sens?: "sortant" | "entrant";
}

/** Relie deux tickets Jira par un type de lien. */
export default async function (entree: Entree) {
  const cle = entree.cle?.trim().toUpperCase();
  const autre = entree.autre?.trim().toUpperCase();
  if (!cle || !autre || !entree.type) throw new Error("Précisez les deux tickets et le type de lien.");
  const sortant = (entree.sens ?? "sortant") === "sortant";
  const reponse = await client("jira", { instance: entree.instance }).post("/rest/api/2/issueLink", {
    type: { name: entree.type },
    inwardIssue: { key: sortant ? autre : cle },
    outwardIssue: { key: sortant ? cle : autre },
  });
  if (!reponse.ok) erreurAtlassian("Jira", reponse);
  return { lie: true };
}
