// Accès commun à l’API HTTP de Grafana, utilisé par les seules fonctions du connecteur.
import { client, type ClientResponse } from "@alfred/sdk";

export type Entree = { instance?: string };

export function grafana(instance?: string) {
  return client("grafana", instance ? { instance } : {});
}

export const segment = (valeur: string | number) => encodeURIComponent(String(valeur).trim());

/** Rend le corps d’une réponse réussie, sinon une erreur en français. */
export function verifier<T>(reponse: ClientResponse<unknown>, action: string): T {
  if (reponse.ok) return reponse.body as T;
  const message =
    reponse.body && typeof reponse.body === "object" && typeof (reponse.body as { message?: unknown }).message === "string"
      ? ` : ${(reponse.body as { message: string }).message.slice(0, 200)}`
      : "";
  if (reponse.status === 401 || reponse.status === 403)
    throw new Error(
      `Grafana refuse ${action} (HTTP ${reponse.status}) : le compte doit pouvoir administrer les équipes de l’organisation${message}.`,
    );
  throw new Error(`Grafana a répondu ${reponse.status} pour ${action}${message}.`);
}

type UtilisateurGrafana = { userId?: number; id?: number; login: string; email?: string; name?: string; role?: string };

export function utilisateur(brut: UtilisateurGrafana) {
  return {
    id: brut.userId ?? brut.id ?? 0,
    login: brut.login,
    email: brut.email ?? "",
    nom: brut.name ?? "",
    role: brut.role ?? "",
  };
}

type EquipeGrafana = { id: number; name: string; email?: string; memberCount?: number };

export function equipe(brut: EquipeGrafana) {
  return { id: brut.id, nom: brut.name, email: brut.email ?? "", membres: brut.memberCount ?? 0 };
}

export const LIBELLES_DROITS: Record<number, string> = { 1: "Lecture", 2: "Modification", 4: "Administration" };
