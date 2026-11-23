import { badge, db, functions, shell } from "@alfred/sdk";
import { lireReglage } from "../lib/regles";

/** Relève le nombre de messages non lus dans Outlook et prévient des nouveaux. */
export default async function () {
  if ((await lireReglage("releve_active")) === "0") {
    return { nonLus: 0, nouveaux: 0, ignore: true };
  }

  const comptes = await functions.call<{ pret: boolean }>("comptes-outlook", {});
  if (!comptes.pret) {
    return { nonLus: 0, nouveaux: 0 };
  }

  // Trier d’abord les messages arrivés depuis le dernier relevé, avec les règles actives.
  const traces = await db.query<{ valeur: string }>("SELECT valeur FROM outlook_etat WHERE cle = 'dernier_tri'");
  const depuis = traces[0]?.valeur ?? new Date(Date.now() - 3600_000).toISOString();
  const debutTri = new Date().toISOString();
  let tries = 0;
  try {
    const tri = await functions.call<{ appliques: number }>("appliquer-regles", { depuis, limite: 50 });
    tries = tri.appliques;
    // Puis les points d’entrée, sur ce qui reste dans la boîte de réception.
    if ((await lireReglage("tri_points")) !== "0") {
      try {
        const parPoint = await functions.call<{ ranges: number }>("trier-points-entree", { depuis, limite: 50 });
        tries += parPoint.ranges;
      } catch (erreur) {
        console.warn("Tri par point d’entrée non effectué", erreur);
      }
    }
    await db.execute(
      `INSERT INTO outlook_etat (cle, valeur, maj_le) VALUES ('dernier_tri', ?, datetime('now'))
       ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le`,
      [debutTri],
    );
  } catch (erreur) {
    console.warn("Tri automatique non effectué", erreur);
  }

  const dossiers = await functions.call<{
    boite: string;
    dossiers: Array<{ id: string; nonLus: number }>;
  }>("lister-dossiers", {});
  const boite = dossiers.dossiers.find((dossier) => dossier.id === dossiers.boite);
  const nonLus = boite?.nonLus ?? 0;

  const precedents = await db.query<{ valeur: string }>(
    "SELECT valeur FROM outlook_etat WHERE cle = 'dernier_non_lus'",
  );
  const precedent = precedents[0] ? Number(precedents[0].valeur) : null;
  const nouveaux =
    precedent === null || Number.isNaN(precedent) ? 0 : Math.max(0, nonLus - precedent);

  await db.execute(
    `INSERT INTO outlook_etat (cle, valeur, maj_le) VALUES ('dernier_non_lus', ?, datetime('now'))
     ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur, maj_le = excluded.maj_le`,
    [String(nonLus)],
  );
  await badge.set(nonLus, { page: "boite-de-reception" });

  if (nouveaux > 0 && (await lireReglage("notifier")) !== "0") {
    await shell.notify({
      title:
        nouveaux === 1
          ? "Un nouveau message dans Outlook"
          : `${nouveaux} nouveaux messages dans Outlook`,
      description:
        nouveaux === 1
          ? "Il vous attend dans la boîte de réception."
          : "Ils vous attendent dans la boîte de réception.",
      tone: "info",
    });
  }

  return { nonLus, nouveaux, tries };
}
