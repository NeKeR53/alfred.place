import { db } from "@alfred/sdk";

interface Entree {
  id?: string;
  nom: string;
  description?: string;
  dossier?: string;
  actif?: boolean;
}

/** Crée ou modifie un point d’entrée. Deux points ne peuvent pas porter le même nom. */
export default async function (entree: Entree) {
  const nom = (entree.nom ?? "").trim();
  if (!nom) throw new Error("Donnez un nom au point d’entrée.");
  const description = (entree.description ?? "").trim();
  const dossier = (entree.dossier ?? "").trim();

  const homonymes = await db.query<{ id: string }>(
    "SELECT id FROM outlook_points_entree WHERE nom = ? COLLATE NOCASE AND id <> ?",
    [nom, entree.id ?? ""],
  );
  if (homonymes.length > 0) throw new Error(`Un point d’entrée s’appelle déjà « ${nom} ».`);

  if (entree.id) {
    const [existant] = await db.query<{ actif: number }>("SELECT actif FROM outlook_points_entree WHERE id = ?", [
      entree.id,
    ]);
    if (!existant) throw new Error("Ce point d’entrée n’existe plus.");
    const actif = entree.actif ?? existant.actif === 1;
    await db.execute(
      `UPDATE outlook_points_entree SET nom = ?, description = ?, dossier = ?, actif = ?, maj_le = datetime('now')
       WHERE id = ?`,
      [nom, description, dossier, actif ? 1 : 0, entree.id],
    );
    return { id: entree.id };
  }

  const id = crypto.randomUUID();
  await db.execute(
    "INSERT INTO outlook_points_entree (id, nom, description, dossier, actif) VALUES (?, ?, ?, ?, ?)",
    [id, nom, description, dossier, entree.actif === false ? 0 : 1],
  );
  return { id };
}
