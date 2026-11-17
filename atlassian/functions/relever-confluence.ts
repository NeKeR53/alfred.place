import { db, functions, shell } from "@alfred/sdk";
import { comptes, releverComptes } from "../lib/releve";

/** Compteur des notifications Confluence non lues, et notification quand il en arrive. */
export default async function ({ notifier = true }: { notifier?: boolean }) {
  let arrivees = 0;
  const { total, erreurs } = await releverComptes(await comptes("confluence"), "confluence", async (compte) => {
    const { nonLues } = await functions.call<{ nonLues: number | null }>("compter-notifications-confluence", {
      instance: compte.id,
    });
    const actuel = nonLues ?? 0;
    const marque = `releve.confluence.${compte.id}.nonLues`;
    const [avant] = await db.query<{ valeur: string }>("SELECT valeur FROM atlassian_reglages WHERE cle = ?", [marque]);
    await db.execute(
      "INSERT INTO atlassian_reglages (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur",
      [marque, String(actuel)],
    );
    const ecart = avant ? actuel - Number(avant.valeur) : 0;
    if (ecart > 0) {
      arrivees += ecart;
      if (notifier) {
        await shell.notify({
          title: ecart === 1 ? "Une nouvelle notification Confluence" : `${ecart} nouvelles notifications Confluence`,
          description: `${actuel} non lue${actuel > 1 ? "s" : ""} au total sur ${compte.label}.`,
          tone: "info",
        });
      }
    }
    return actuel;
  });
  return { nonLues: total, nouvelles: arrivees, erreurs };
}
