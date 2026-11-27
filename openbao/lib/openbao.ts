// Accès commun au moteur KV v2 d’OpenBao, utilisé par les seules fonctions du connecteur.
// `{mount}` est le montage KV du compte (paramètre de la méthode) : Alfred le remplace dans chaque chemin.
// Les valeurs des secrets arrivent scellées (règle `sealed` du client) : des références, jamais la valeur.
import { client, type ClientResponse } from "@alfred/sdk";

export type Entree = { instance?: string };

export function openbao(instance?: string) {
  return client("openbao", instance ? { instance } : {});
}

/** Chemin d’un secret, segment par segment, sans barre au début ni à la fin. */
export function chemin(valeur: string | undefined): string {
  return (valeur ?? "")
    .split("/")
    .map((partie) => partie.trim())
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
}

export const donnees = (cheminSecret: string) => `/v1/{mount}/data/${cheminSecret}`;
export const metadonnees = (cheminSecret: string) => `/v1/{mount}/metadata/${cheminSecret}`;

function detail(corps: unknown): string {
  const erreurs = (corps as { errors?: unknown } | null)?.errors;
  return Array.isArray(erreurs) && erreurs.length ? ` : ${String(erreurs[0]).slice(0, 200)}` : "";
}

export function verifier<T>(reponse: ClientResponse<unknown>, action: string): T {
  if (reponse.ok) return reponse.body as T;
  if (reponse.status === 403)
    throw new Error(`OpenBao refuse ${action} (HTTP 403) : la politique du compte ne le permet pas${detail(reponse.body)}.`);
  throw new Error(`OpenBao a répondu ${reponse.status} pour ${action}${detail(reponse.body)}.`);
}

export type Document = { trouve: boolean; version: number; valeurs: Record<string, string> };

/** Lit un document KV : ses valeurs sont des références scellées. Absent (404), `trouve` vaut faux. */
export async function lireDocument(instance: string | undefined, cheminSecret: string): Promise<Document> {
  const reponse = await openbao(instance).get(donnees(cheminSecret));
  if (reponse.status === 404) return { trouve: false, version: 0, valeurs: {} };
  const corps = verifier<{ data?: { data?: Record<string, string> | null; metadata?: { version?: number } } }>(
    reponse,
    `la lecture de « ${decodeURIComponent(cheminSecret)} »`,
  );
  return {
    trouve: Boolean(corps.data?.data),
    version: corps.data?.metadata?.version ?? 0,
    valeurs: corps.data?.data ?? {},
  };
}

/**
 * Écrit un document entier. `sealed: true` : Alfred remplace les références de ce service par leurs valeurs, sans que
 * la fonction les voie ; `cas` protège d’une écriture concurrente (0 : le document ne doit pas exister).
 */
export async function ecrireDocument(
  instance: string | undefined,
  cheminSecret: string,
  valeurs: Record<string, string>,
  cas: number,
) {
  const reponse = await openbao(instance).request({
    method: "POST",
    path: donnees(cheminSecret),
    body: { data: valeurs, options: { cas } },
    sealed: true,
  });
  if (reponse.status === 400 && /check-and-set/i.test(detail(reponse.body)))
    throw new Error("Le secret a changé entre-temps chez OpenBao : relisez-le avant de recommencer.");
  const corps = verifier<{ data?: { version?: number } }>(reponse, `l’écriture de « ${decodeURIComponent(cheminSecret)} »`);
  return corps?.data?.version ?? cas + 1;
}
