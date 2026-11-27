import { useAlfredState } from "@alfred/sdk";

/** Ce qu’une page reçoit d’un état partagé du module : la valeur, et de quoi la relire. */
export interface Lecture<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  /** Relit la valeur auprès du service (après une écriture, ou sur « Actualiser »). */
  reload: () => void;
}

type Brut = {
  data?: unknown;
  loading?: boolean;
  error?: unknown;
  refresh?: (() => unknown) | null;
};

function enErreur(erreur: unknown): Error | null {
  if (!erreur) return null;
  if (erreur instanceof Error) return erreur;
  const message = (erreur as { message?: unknown })?.message;
  return new Error(typeof message === "string" ? message : String(erreur));
}

/** Les paramètres sans les champs vides, pour qu’une même lecture garde la même clé. */
function nettoyer(params: Record<string, unknown>): Record<string, unknown> {
  const propres: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(params)) {
    if (valeur === undefined || valeur === null || valeur === "") continue;
    propres[cle] = valeur;
  }
  return propres;
}

/**
 * S’abonne à un état partagé du module « atlassian » : la page reçoit la valeur courante, puis chaque changement.
 * `params` à `null` : rien n’est lu (pas de compte, pas d’élément ouvert…).
 */
export function useEtat<T>(etat: string, params: Record<string, unknown> | null = {}): Lecture<T> {
  const actif = params !== null;
  const lu = (useAlfredState as unknown as (nom: string | null, options?: { params?: Record<string, unknown> }) => Brut)(
    actif ? `atlassian/${etat}` : null,
    actif ? { params: nettoyer(params) } : undefined,
  );
  return {
    data: actif ? (lu.data as T | undefined) : undefined,
    loading: actif ? Boolean(lu.loading) : false,
    error: actif ? enErreur(lu.error) : null,
    reload: () => {
      if (actif && typeof lu.refresh === "function") void lu.refresh();
    },
  };
}
