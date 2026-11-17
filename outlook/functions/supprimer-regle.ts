import { db } from "@alfred/sdk";

export default async function (entree: { id: string }) {
  if (!entree.id) throw new Error("Aucune règle à supprimer.");
  const resultat = await db.execute("DELETE FROM outlook_regles WHERE id = ?", [entree.id]);
  if (resultat.changes === 0) throw new Error("Cette règle n’existe plus.");
  return { ok: true };
}
