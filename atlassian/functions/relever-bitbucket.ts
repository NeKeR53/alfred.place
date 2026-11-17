import { functions } from "@alfred/sdk";
import { comptes, nouveaux, prevenir, releverComptes } from "../lib/releve";

interface Pr {
  id: number;
  projet: string;
  depot: string;
  titre: string;
  auteur: string;
}

/** Compteur des pull requests qui attendent la relecture de l’utilisateur, et notification des nouvelles. */
export default async function ({ notifier = true }: { notifier?: boolean }) {
  let arrivees = 0;
  const { total, erreurs } = await releverComptes(await comptes("bitbucket"), "bitbucket", async (compte) => {
    const { prs } = await functions.call<{ prs: Pr[] }>("lister-prs", {
      instance: compte.id,
      etat: "OPEN",
      role: "INCOMING",
      limite: 50,
    });
    const elements = prs.map((pr) => ({ cle: `${pr.projet}/${pr.depot}#${pr.id}`, titre: pr.titre, auteur: pr.auteur }));
    const recues = await nouveaux("bitbucket-a-relire", compte.id, elements);
    arrivees += recues.length;
    if (notifier) {
      const parCle = new Map(elements.map((element) => [element.cle, element]));
      await prevenir(recues, {
        un: () => "Une pull request attend votre relecture",
        plusieurs: (n) => `${n} pull requests attendent votre relecture`,
        detail: (e) => `${parCle.get(e.cle)?.auteur ?? "Quelqu’un"} : ${e.titre}`,
      });
    }
    return prs.length;
  });
  return { aRelire: total, nouvelles: arrivees, erreurs };
}
