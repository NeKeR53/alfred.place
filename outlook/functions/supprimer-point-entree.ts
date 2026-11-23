import { db } from "@alfred/sdk";

/** Supprime un point d’entrée ; les classements qui le citaient seront refaits. */
export default async function ({ id }: { id: string }) {
  if (!id) throw new Error("Précisez le point d’entrée à supprimer.");
  const { changes } = await db.execute("DELETE FROM outlook_points_entree WHERE id = ?", [id]);
  return { supprime: changes > 0 };
}
