// Source des données d’Atom : la base du module et les connecteurs, ou la démonstration (lib/demo.ts) en mode
// « données d’exemple » d’Alfred. Les pages et les bibliothèques d’Atom passent toutes par ici, jamais par le SDK directement.
import { db as base, functions as fonctions, isExampleMode, secrets as coffre, type SqlValue, useTopBarSummary } from "@alfred/sdk";
import { DEMO_LECTURE_SEULE, lignesDemo, reponseDemo } from "./demo";

/**
 * La démonstration est-elle active ? C’est le mode « données d’exemple » d’Alfred pour le module Atom (page
 * d’attente, Réglages → Modules → Atom, pastille « Exemple » de la barre du haut).
 */
export async function enDemo(): Promise<boolean> {
  return isExampleMode();
}

export const db = {
  async query<T = Record<string, unknown>>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return (await enDemo()) ? (lignesDemo(sql) as T[]) : base.query<T>(sql, params);
  },
  async execute(sql: string, params: SqlValue[] = []) {
    if (await enDemo()) throw new Error(DEMO_LECTURE_SEULE);
    return base.execute(sql, params);
  },
};

export const functions = {
  async call<T = unknown>(nom: string, entree: unknown = {}): Promise<T> {
    return (await enDemo()) ? (reponseDemo(nom, (entree ?? {}) as Record<string, unknown>) as T) : fonctions.call<T>(nom, entree);
  },
};

export const secrets = {
  async reveal(...args: Parameters<typeof coffre.reveal>) {
    if (await enDemo()) throw new Error("Démonstration : aucune valeur de secret n’existe, seuls les noms des clés sont montrés.");
    return coffre.reveal(...args);
  },
  async writeEnvFile(...args: Parameters<typeof coffre.writeEnvFile>) {
    if (await enDemo()) throw new Error(DEMO_LECTURE_SEULE);
    return coffre.writeEnvFile(...args);
  },
};

/** Résumé de la page dans la barre du haut, précédé de « Démonstration » quand elle est active. */
export function useResumeAtom(texte: string | ((demo: boolean) => string)) {
  const demo = isExampleMode();
  const resume = typeof texte === "function" ? texte(demo) : texte;
  useTopBarSummary(demo ? ["Démonstration · données fictives", resume].filter(Boolean).join(" · ") : resume);
  return demo;
}
