import { db } from "@alfred/sdk";
import type { Actions, Conditions } from "../lib/regles";

interface Entree {
  id?: string;
  nom: string;
  actif?: boolean;
  conditions: Conditions;
  actions: Actions;
}

/** Enregistre une règle de tri. */
export default async function (entree: Entree) {
  const nom = entree.nom?.trim();
  if (!nom) throw new Error("Donnez un nom à la règle.");

  const conditions: Conditions = {
    expediteur: entree.conditions?.expediteur?.trim() || undefined,
    objet: entree.conditions?.objet?.trim() || undefined,
    sujet: entree.conditions?.sujet?.trim() || undefined,
    nonLu: entree.conditions?.nonLu === true || undefined,
  };
  if (!conditions.expediteur && !conditions.objet && !conditions.sujet && !conditions.nonLu) {
    throw new Error("Précisez au moins une condition (expéditeur, objet, sujet ou message non lu).");
  }

  const actions: Actions = {
    marquerLu: entree.actions?.marquerLu === true || undefined,
    deplacerVers: entree.actions?.deplacerVers?.trim() || undefined,
  };
  if (!actions.marquerLu && !actions.deplacerVers) {
    throw new Error("Choisissez au moins une action (marquer comme lu ou déplacer).");
  }

  const id = entree.id?.trim() || crypto.randomUUID();
  const actif = entree.actif === false ? 0 : 1;
  const existante = await db.query<{ id: string }>("SELECT id FROM outlook_regles WHERE id = ?", [id]);

  if (existante.length > 0) {
    await db.execute(
      "UPDATE outlook_regles SET nom = ?, actif = ?, conditions = ?, actions = ?, maj_le = datetime('now') WHERE id = ?",
      [nom, actif, JSON.stringify(conditions), JSON.stringify(actions), id],
    );
  } else {
    await db.execute(
      "INSERT INTO outlook_regles (id, nom, actif, conditions, actions) VALUES (?, ?, ?, ?, ?)",
      [id, nom, actif, JSON.stringify(conditions), JSON.stringify(actions)],
    );
  }
  return { id };
}
