import { useEffect, useState } from "react";
import { functions } from "@alfred/sdk";

/**
 * Jugements locaux (criticité, risque) demandés par petits lots successifs : la liste s’affiche tout de suite
 * et chaque pastille arrive dès qu’elle est prête, sans engorger le modèle de décision.
 */
export function useJugements<Resultat extends { cle: string }>(
  fonction: string,
  entreeCommune: Record<string, unknown>,
  champListe: string,
  elements: Array<{ cle: string } & Record<string, unknown>>,
  taille = 2,
) {
  const [resultats, setResultats] = useState<Map<string, Resultat>>(new Map());
  const [erreur, setErreur] = useState<Error | null>(null);
  const [enCours, setEnCours] = useState(false);
  const signature = JSON.stringify([entreeCommune, elements.map((e) => [e.cle, e.misAJour ?? ""])]);

  useEffect(() => {
    if (elements.length === 0) return;
    let annule = false;
    setEnCours(true);
    setErreur(null);
    (async () => {
      for (let debut = 0; debut < elements.length && !annule; debut += taille) {
        const lot = elements.slice(debut, debut + taille);
        try {
          const reponse = await functions.call<{ resultats: Resultat[] }>(fonction, { ...entreeCommune, [champListe]: lot });
          if (annule) return;
          setResultats((avant) => {
            const suite = new Map(avant);
            for (const r of reponse.resultats) suite.set(r.cle, r);
            return suite;
          });
        } catch (e) {
          if (!annule) setErreur(e as Error);
          break;
        }
      }
      if (!annule) setEnCours(false);
    })();
    return () => {
      annule = true;
    };
  }, [signature]);

  return { resultats, erreur, enCours };
}
