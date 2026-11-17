import { functions } from "@alfred/sdk";
import { comptes, nouveaux, prevenir, releverComptes } from "../lib/releve";
import type { DemandeListe } from "../lib/support";

/** Compteur des délais dépassés sur l’entrée Support, et notifications des nouvelles demandes. */
export default async function ({ notifier = true }: { notifier?: boolean }) {
  let ouvertes = 0;
  let arrivees = 0;
  const { total, erreurs } = await releverComptes(await comptes("jira"), "support", async (compte) => {
    const { demandes } = await functions.call<{ demandes: DemandeListe[] }>("lister-demandes-ouvertes", {
      instance: compte.id,
      limite: 100,
    });
    ouvertes += demandes.length;
    const enRetard = demandes.filter((demande) => demande.sla?.depasse);

    const recues = await nouveaux("support", compte.id, demandes);
    const depassees = await nouveaux("support-retard", compte.id, enRetard);
    arrivees += recues.length;
    if (notifier) {
      const parCle = new Map(demandes.map((demande) => [demande.cle, demande]));
      await prevenir(recues, {
        un: (d) => `Nouvelle demande de support, ${d.cle}`,
        plusieurs: (n) => `${n} nouvelles demandes de support`,
        detail: (d) => `${parCle.get(d.cle)?.client ?? "Un client"} : ${d.titre}`,
      });
      await prevenir(depassees, {
        un: (d) => `Délai dépassé sur la demande ${d.cle}`,
        plusieurs: (n) => `${n} demandes ont dépassé leur délai`,
      });
    }
    return enRetard.length;
  });
  return { ouvertes, enRetard: total, nouvelles: arrivees, erreurs };
}
