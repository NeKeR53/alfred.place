import { aucunCompte } from "../lib/comptes-api";
import { echapperJql } from "../lib/jira-api";
import { chercherDemandes, tousLesServices } from "../lib/support-api";

/** Toutes les demandes encore ouvertes des centres de services du compte. */
export default async function ({ instance, limite }: { instance?: string; limite?: number }) {
  const taille = Math.min(100, Math.max(1, limite ?? 100));
  if (await aucunCompte("jira")) return { demandes: [], total: 0 };
  const projets = (await tousLesServices(instance)).map((s) => s.projetCle).filter(Boolean);
  if (projets.length === 0) return { demandes: [], total: 0 };
  const jql = `project IN (${projets.map(echapperJql).join(", ")}) AND resolution = EMPTY ORDER BY created DESC`;
  return chercherDemandes(jql, 0, taille, instance);
}
