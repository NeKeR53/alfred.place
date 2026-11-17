import { db } from "@alfred/sdk";
import { jugerPr } from "../lib/ia";

interface PrAJuger {
  cle: string;
  titre: string;
  description?: string;
  source?: string;
  cible?: string;
  misAJour?: number | null;
}

/** Risque de pull requests Bitbucket (faible, moyen, élevé), jugé sur l’ordinateur ; gardé tant qu’elles ne changent pas. */
export default async function ({ instance = "", prs = [] }: { instance?: string; prs?: PrAJuger[] }) {
  const resultats = [];
  for (const pr of prs.slice(0, 5)) {
    const empreinte = `${pr.titre}|${pr.misAJour ?? ""}`;
    const [connu] = await db.query<{ empreinte: string; niveau: string; confiance: number }>(
      "SELECT empreinte, niveau, confiance FROM atlassian_risque_pr WHERE instance = ? AND cle = ?",
      [instance, pr.cle],
    );
    let jugement;
    if (connu && connu.empreinte === empreinte) {
      jugement = { niveau: connu.niveau, confiance: connu.confiance };
    } else {
      jugement = await jugerPr(pr);
      await db.execute(
        `INSERT INTO atlassian_risque_pr (instance, cle, empreinte, niveau, confiance, evalue_le)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(instance, cle) DO UPDATE SET empreinte = excluded.empreinte, niveau = excluded.niveau,
           confiance = excluded.confiance, evalue_le = excluded.evalue_le`,
        [instance, pr.cle, empreinte, jugement.niveau, jugement.confiance],
      );
    }
    resultats.push({ cle: pr.cle, ...jugement, aVerifier: jugement.confiance < 0.8 });
  }
  return { resultats };
}
