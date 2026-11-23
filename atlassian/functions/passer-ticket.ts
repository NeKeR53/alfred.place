import { client } from "@alfred/sdk";
import { erreurAtlassian } from "../lib/jira-api";

type Etape = "todo" | "doing" | "suspended" | "done";
type Champ = { required?: boolean; defaultValue?: unknown; schema?: { system?: string } };
type Transition = { id: string; name: string; to?: { name?: string; statusCategory?: { key?: string } }; fields?: Record<string, Champ> };

const sansAccents = (texte: string) => texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Étape d’un statut, avec la règle de OneApp : Suspendu, En cours, Résolu ou Clôturé d’après le nom, sinon la catégorie. */
function etapeDe(statut: string, categorie?: string): Etape {
  const nom = sansAccents(statut);
  if (/suspend/.test(nom)) return "suspended";
  if (/resol|solve|verif|livr|deliver|recette|ready.*test|test.*ready/.test(nom)) return "done";
  if (categorie === "done" || /clot|clos|closed|done|termine|complete|ferme/.test(nom)) return "done";
  if (/en cours|in progress|in-progress|start(?:ed)?(?: work)?|realisation|doing/.test(nom)) return "doing";
  return categorie === "indeterminate" ? "doing" : "todo";
}

/**
 * Fait passer un ticket dans une étape d’un tableau de projet (à faire, en cours, suspendu, terminé) par la
 * transition Jira qui y mène, avec un commentaire facultatif. Refuse, comme OneApp, une étape sans transition ou
 * une transition qui exige des champs.
 */
export default async function ({ instance, cle, etape, commentaire }: { instance?: string; cle: string; etape: Etape; commentaire?: string }) {
  const net = cle.trim();
  if (!net) throw new Error("La clé du ticket est vide.");
  const texte = commentaire?.trim();
  const jira = client("jira", { instance });
  const adresse = `/rest/api/2/issue/${encodeURIComponent(net)}/transitions`;
  const liste = await jira.get<{ transitions?: Transition[] }>(adresse, { expand: "transitions.fields" });
  if (!liste.ok) erreurAtlassian("Jira", liste);
  const transition = (liste.body?.transitions ?? []).find((item) => etapeDe(item.to?.name ?? item.name, item.to?.statusCategory?.key) === etape);
  if (!transition)
    throw new Error("Ce déplacement n’est pas autorisé par le workflow Jira. Ouvrez le ticket pour choisir une transition disponible.");
  const champs = Object.entries(transition.fields ?? {});
  if (champs.some(([id, champ]) => champ.required && champ.defaultValue === undefined && !(texte && (id === "comment" || champ.schema?.system === "comment"))))
    throw new Error("Cette transition Jira exige des champs supplémentaires. Complétez-la dans le ticket.");
  const valeurs = Object.fromEntries(champs.filter(([id, champ]) => champ.defaultValue !== undefined && id !== "comment").map(([id, champ]) => [id, champ.defaultValue]));
  const reponse = await jira.post(adresse, {
    transition: { id: transition.id },
    ...(Object.keys(valeurs).length ? { fields: valeurs } : {}),
    ...(texte ? { update: { comment: [{ add: { body: texte } }] } } : {}),
  });
  if (!reponse.ok) erreurAtlassian("Jira", reponse);
  return { transition: transition.name, vers: transition.to?.name ?? "" };
}
