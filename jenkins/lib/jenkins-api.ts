import { client } from "@alfred/sdk";

/** Client Jenkins de l’instance demandée (instance par défaut si vide). */
export function jenkins(instance?: string | null) {
  return client("jenkins", instance ? { instance } : undefined);
}

/** « dossier/sous-dossier/job » → « /job/dossier/job/sous-dossier/job/job ». */
export function cheminJob(nomComplet: string): string {
  const morceaux = nomComplet.split("/").filter(Boolean);
  if (morceaux.length === 0) throw new Error("Le nom du job est vide.");
  return morceaux.map((morceau) => `/job/${encodeURIComponent(morceau)}`).join("");
}

export function erreurJenkins(status: number, quoi: string): Error {
  if (status === 401) return new Error(`Jenkins refuse l’identifiant ou le jeton (${quoi}).`);
  if (status === 403) return new Error(`Ce compte n’a pas le droit d’accéder à ${quoi}.`);
  if (status === 404) return new Error(`Jenkins ne trouve pas ${quoi}.`);
  return new Error(`Jenkins a répondu ${status} pour ${quoi}.`);
}

/** Jeton anti-CSRF, utile seulement quand le compte se connecte par mot de passe. */
export async function enTeteCrumb(instance?: string | null): Promise<Record<string, string>> {
  try {
    const reponse = await jenkins(instance).get<{ crumb?: string; crumbRequestField?: string }>(
      "/crumbIssuer/api/json",
    );
    if (reponse.ok && reponse.body?.crumb && reponse.body.crumbRequestField)
      return { [reponse.body.crumbRequestField]: reponse.body.crumb };
  } catch {
    // Pas de jeton anti-CSRF : un jeton d’API n’en a pas besoin.
  }
  return {};
}

export type Resultat = "SUCCESS" | "FAILURE" | "UNSTABLE" | "ABORTED" | "NOT_BUILT" | null;
