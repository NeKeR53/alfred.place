import { db } from "@alfred/sdk";

export interface Conditions {
  expediteur?: string;
  objet?: string;
  /** Sujet en langage courant (« factures fournisseurs ») : le message est lu et compris sur l’ordinateur. */
  sujet?: string;
  nonLu?: boolean;
}

export interface Actions {
  marquerLu?: boolean;
  deplacerVers?: string;
}

export interface Regle {
  id: string;
  nom: string;
  actif: boolean;
  conditions: Conditions;
  actions: Actions;
}

export const REGLAGES_DEFAUT: Record<string, string> = {
  signature: "",
  releve_active: "1",
  notifier: "1",
  marquer_lu_ouverture: "1",
  tri_points: "1",
  dossier_douteux: "",
};

function objetJson<T>(texte: string, defaut: T): T {
  try {
    const valeur = JSON.parse(texte) as T;
    return valeur && typeof valeur === "object" ? valeur : defaut;
  } catch {
    return defaut;
  }
}

export async function lireReglages(): Promise<Record<string, string>> {
  const lignes = await db.query<{ cle: string; valeur: string }>("SELECT cle, valeur FROM outlook_reglages");
  const valeurs: Record<string, string> = { ...REGLAGES_DEFAUT };
  for (const ligne of lignes) valeurs[ligne.cle] = ligne.valeur;
  return valeurs;
}

export async function lireReglage(cle: string): Promise<string> {
  const lignes = await db.query<{ valeur: string }>("SELECT valeur FROM outlook_reglages WHERE cle = ?", [cle]);
  return lignes[0]?.valeur ?? REGLAGES_DEFAUT[cle] ?? "";
}

export async function ecrireReglage(cle: string, valeur: string): Promise<void> {
  await db.execute(
    `INSERT INTO outlook_reglages (cle, valeur) VALUES (?, ?)
     ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`,
    [cle, valeur],
  );
}

export async function lireRegles(): Promise<Regle[]> {
  const lignes = await db.query<{
    id: string;
    nom: string;
    actif: number;
    conditions: string;
    actions: string;
  }>("SELECT id, nom, actif, conditions, actions FROM outlook_regles ORDER BY nom COLLATE NOCASE");
  return lignes.map((ligne) => ({
    id: ligne.id,
    nom: ligne.nom,
    actif: ligne.actif === 1,
    conditions: objetJson<Conditions>(ligne.conditions, {}),
    actions: objetJson<Actions>(ligne.actions, {}),
  }));
}

export function resumerConditions(conditions: Conditions): string {
  const morceaux: string[] = [];
  if (conditions.expediteur?.trim()) morceaux.push(`De : ${conditions.expediteur.trim()}`);
  if (conditions.objet?.trim()) morceaux.push(`Objet : ${conditions.objet.trim()}`);
  if (conditions.sujet?.trim()) morceaux.push(`Parle de : ${conditions.sujet.trim()}`);
  if (conditions.nonLu) morceaux.push("Non lu");
  return morceaux.length > 0 ? morceaux.join(" · ") : "Tous les messages";
}

export function resumerActions(actions: Actions, dossiers: Record<string, string> = {}): string {
  const morceaux: string[] = [];
  if (actions.marquerLu) morceaux.push("Marquer comme lu");
  if (actions.deplacerVers) morceaux.push(`Déplacer vers ${dossiers[actions.deplacerVers] ?? "un dossier"}`);
  return morceaux.length > 0 ? morceaux.join(" · ") : "Aucune action";
}
