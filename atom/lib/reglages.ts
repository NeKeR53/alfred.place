// Réglages d’Atom gardés en base (compte Jira du projet, projets suivis…).
import { db, functions } from "./source";

export async function lireReglages(): Promise<Record<string, string>> {
  const lignes = await db.query<{ cle: string; valeur: string }>("SELECT cle, valeur FROM atom_reglages");
  return Object.fromEntries(lignes.map((ligne) => [ligne.cle, ligne.valeur]));
}

export function ecrireReglage(cle: string, valeur: string) {
  return valeur
    ? db.execute(
        "INSERT INTO atom_reglages (cle, valeur) VALUES (?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur",
        [cle, valeur],
      )
    : db.execute("DELETE FROM atom_reglages WHERE cle = ?", [cle]);
}

/** Comptes Jira de l’espace (module atlassian) ; injoignable, une liste vide. */
export async function comptesJira(): Promise<{ id: string; label: string }[]> {
  try {
    return (await functions.call<{ comptes: { id: string; label: string }[] }>("atlassian/comptes-jira", {})).comptes;
  } catch {
    return [];
  }
}

/** Projets Jira suivis : clés séparées par des virgules ou des espaces (« ATOM, SUP »). */
export const projetsSuivis = (valeur: string | undefined) =>
  (valeur ?? "")
    .split(/[\s,;]+/)
    .map((cle) => cle.trim().toUpperCase())
    .filter(Boolean);
