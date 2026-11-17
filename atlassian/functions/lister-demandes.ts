import { aucunCompte } from "../lib/comptes-api";
import { echapperJql } from "../lib/jira-api";
import { chercherDemandes, filesDuService, premierService } from "../lib/support-api";

interface Entree {
  instance?: string;
  service?: string;
  file?: string;
  texte?: string;
  debut?: number;
  limite?: number;
}

/** Demandes d’une file d’attente, dans l’ordre de la file. */
export default async function (entree: Entree) {
  const debut = Math.max(0, entree.debut ?? 0);
  const limite = Math.min(100, Math.max(1, entree.limite ?? 40));
  const vide = { demandes: [], total: 0, debut, limite };
  if (await aucunCompte("jira")) return vide;

  const service = entree.service || (await premierService(entree.instance));
  if (!service) return vide;
  const files = await filesDuService(service, entree.instance);
  const file = entree.file ? files.find((element) => String(element.id) === entree.file) : files[0];
  if (!file) return vide;

  // La requête de la file, avec la recherche par mots glissée avant son tri.
  const [filtre, ordre] = (file.jql ?? "").split(/\s+ORDER\s+BY\s+/i);
  const conditions = [filtre?.trim() ? `(${filtre.trim()})` : `project = ${echapperJql(service)}`];
  if (entree.texte?.trim()) conditions.push(`text ~ ${echapperJql(entree.texte.trim())}`);
  const jql = `${conditions.join(" AND ")} ORDER BY ${ordre?.trim() || "created DESC"}`;

  const { demandes, total } = await chercherDemandes(jql, debut, limite, entree.instance);
  return { demandes, total, debut, limite };
}
