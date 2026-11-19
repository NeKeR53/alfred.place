/**
 * Liste complète des déploiements d’un compte Prefect, page par page.
 *
 * Prefect ne rend jamais plus de 200 éléments par demande (`PREFECT_API_DEFAULT_LIMIT`) : la liste suit `offset`
 * jusqu’à la dernière page, et les noms des flows se lisent par lots de 200. Le parcours s’arrête à `maximum`
 * déploiements et le dit (`incomplet`).
 *
 * Ce fichier n’importe rien du SDK : l’envoi d’un filtre lui est passé, ce qui permet de le tester sur un faux
 * Prefect (`faux-prefect.ts`).
 */
import type { DeploiementPrefect } from "./prefect-api";

/** Envoie un filtre Prefect (POST) et rend sa réponse, ou lève une erreur en clair. */
export type Poste = <T>(chemin: string, corps: unknown, quoi: string) => Promise<T>;

export const PAGE = 200;

export async function tousLesDeploiements(
  poste: Poste,
  filtre: Record<string, unknown>,
  maximum: number,
): Promise<{ deploiements: DeploiementPrefect[]; incomplet: boolean }> {
  const deploiements: DeploiementPrefect[] = [];
  const vus = new Set<string>();
  for (let offset = 0; offset < maximum; offset += PAGE) {
    const limite = Math.min(PAGE, maximum - offset);
    const lot = await poste<DeploiementPrefect[]>(
      "/deployments/filter",
      { ...filtre, sort: "NAME_ASC", limit: limite, offset },
      "les déploiements",
    );
    for (const d of lot) {
      // Un déploiement créé pendant la lecture décale les pages : il ne compte qu’une fois.
      if (!vus.has(d.id)) {
        vus.add(d.id);
        deploiements.push(d);
      }
    }
    if (lot.length < limite) return { deploiements, incomplet: false };
  }
  return { deploiements, incomplet: true };
}

/** Noms des flows, par identifiant, lus par lots de 200. */
export async function nomsDesFlows(poste: Poste, ids: string[]): Promise<Map<string, string>> {
  const uniques = [...new Set(ids.filter(Boolean))];
  const noms = new Map<string, string>();
  for (let i = 0; i < uniques.length; i += PAGE) {
    const lot = uniques.slice(i, i + PAGE);
    const flows = await poste<{ id: string; name: string }[]>(
      "/flows/filter",
      { flows: { id: { any_: lot } }, limit: PAGE },
      "les flows",
    );
    for (const flow of flows) noms.set(flow.id, flow.name);
  }
  return noms;
}
