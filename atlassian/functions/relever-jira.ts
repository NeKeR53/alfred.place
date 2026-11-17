import { functions } from "@alfred/sdk";
import { comptes, nouveaux, prevenir, releverComptes } from "../lib/releve";

/** Compteur des tickets ouverts assignés à l’utilisateur, et notification des nouveaux. */
export default async function ({ notifier = true }: { notifier?: boolean }) {
  let arrives = 0;
  const { total, erreurs } = await releverComptes(await comptes("jira"), "jira", async (compte) => {
    const { tickets, total } = await functions.call<{ tickets: Array<{ cle: string; titre: string }>; total: number }>(
      "lister-tickets",
      { instance: compte.id, vue: "mes", tri: "maj", debut: 0, limite: 100 },
    );
    const recus = await nouveaux("jira-assignes", compte.id, tickets);
    arrives += recus.length;
    if (notifier) {
      await prevenir(recus, {
        un: (t) => `Ticket ${t.cle} assigné à vous`,
        plusieurs: (n) => `${n} nouveaux tickets vous sont assignés`,
      });
    }
    return total;
  });
  return { assignes: total, nouveaux: arrives, erreurs };
}
