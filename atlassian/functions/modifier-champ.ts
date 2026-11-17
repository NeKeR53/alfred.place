import { client } from "@alfred/sdk";
import { erreurAtlassian } from "../lib/jira-api";
import { choisirEditeur, type MetaChamp, valeurPourJira } from "../lib/jira-champs";

interface Entree {
  instance?: string;
  cle: string;
  champ: string;
  /** Texte, identifiant, ou liste d’identifiants ; vide pour effacer. */
  valeur: string | string[] | null;
}

/** Donne une nouvelle valeur à n’importe quel champ modifiable d’un ticket Jira, système ou personnalisé. */
export default async function (entree: Entree) {
  const cle = entree.cle?.trim();
  const champ = entree.champ?.trim();
  if (!cle || !champ) throw new Error("Précisez le ticket et le champ.");
  const jira = client("jira", { instance: entree.instance });
  const base = `/rest/api/2/issue/${encodeURIComponent(cle)}`;

  const meta = await jira.get<{ fields?: Record<string, MetaChamp> }>(`${base}/editmeta`);
  if (!meta.ok) erreurAtlassian("Jira", meta);
  const m = meta.body?.fields?.[champ];
  if (!m) throw new Error("Ce champ ne peut pas être modifié sur ce ticket.");

  const editeur = choisirEditeur(m.schema, m, champ);
  const valeur = valeurPourJira(editeur, m.schema, entree.valeur);
  if (m.required && (valeur === null || (Array.isArray(valeur) && valeur.length === 0))) {
    throw new Error(`Le champ « ${m.name ?? champ} » est obligatoire.`);
  }

  const reponse = await jira.put(base, { fields: { [champ]: valeur } });
  if (!reponse.ok) erreurAtlassian("Jira", reponse);
  return { modifie: true };
}
