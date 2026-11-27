// Accès commun à l’API de Portainer, utilisé par les seules fonctions du connecteur.
// `{endpoint}` est l’environnement Portainer du compte (son numéro) : Alfred le remplace dans chaque chemin.
import { client, type ClientResponse } from "@alfred/sdk";

export type Entree = { instance?: string };

export function portainer(instance?: string) {
  return client("portainer", instance ? { instance } : {});
}

export const segment = (valeur: string | number) => encodeURIComponent(String(valeur).trim());
export const docker = (chemin: string) => `/api/endpoints/{endpoint}/docker${chemin}`;

export function verifier<T>(reponse: ClientResponse<unknown>, action: string): T {
  if (reponse.ok) return reponse.body as T;
  const corps = reponse.body as { message?: string; details?: string } | null;
  const message = corps?.details || corps?.message;
  const suite = typeof message === "string" && message ? ` : ${message.slice(0, 200)}` : "";
  if (reponse.status === 401 || reponse.status === 403)
    throw new Error(`Portainer refuse ${action} (HTTP ${reponse.status}) : vérifiez les droits du compte sur cet environnement${suite}.`);
  if (reponse.status === 404) throw new Error(`Portainer ne trouve pas ${action.replace(/^(le |la |les |l’)/, "")} (HTTP 404)${suite}.`);
  throw new Error(`Portainer a répondu ${reponse.status} pour ${action}${suite}.`);
}

/** Numéro de l’environnement Portainer du compte (paramètre `endpoint`). */
export async function environnementDuCompte(instance?: string): Promise<number> {
  const { params } = await portainer(instance).params();
  const numero = Number(params.endpoint);
  if (!Number.isInteger(numero) || numero <= 0)
    throw new Error("Le compte Portainer n’a pas de numéro d’environnement valide (réglage « Environnement »).");
  return numero;
}

type ConteneurDocker = {
  Id: string;
  Names?: string[];
  Image?: string;
  State?: string;
  Status?: string;
  Created?: number;
  Labels?: Record<string, string>;
};

export function conteneur(brut: ConteneurDocker) {
  return {
    id: brut.Id,
    nom: (brut.Names?.[0] ?? brut.Id.slice(0, 12)).replace(/^\/+/, ""),
    image: brut.Image ?? "",
    etat: brut.State ?? "",
    statut: brut.Status ?? "",
    pile: brut.Labels?.["com.docker.compose.project"] ?? null,
    service: brut.Labels?.["com.docker.compose.service"] ?? null,
    creeLe: typeof brut.Created === "number" ? new Date(brut.Created * 1000).toISOString() : null,
    url: adresseApplication(brut.Labels ?? {}),
  };
}

/**
 * Adresse de l’application servie par un conteneur, d’après ses étiquettes : `atom.url` si elle est posée, sinon la
 * première règle Traefik `Host(…)` (avec son `PathPrefix(…)`), en https sauf si le routeur n’écoute que sur `web`.
 */
export function adresseApplication(etiquettes: Record<string, string>): string | null {
  const posee = etiquettes["atom.url"]?.trim();
  if (posee && /^https?:\/\/[^\s]+$/i.test(posee)) return posee;
  for (const [cle, regle] of Object.entries(etiquettes)) {
    const routeur = /^traefik\.http\.routers\.([^.]+)\.rule$/.exec(cle)?.[1];
    if (!routeur) continue;
    const hote = /Host\(\s*`([^`]+)`/.exec(regle)?.[1];
    if (!hote || /[\s/]/.test(hote)) continue;
    const chemin = /PathPrefix\(\s*`([^`]*)`/.exec(regle)?.[1] ?? "";
    const entrees = etiquettes[`traefik.http.routers.${routeur}.entrypoints`] ?? "";
    const tls = etiquettes[`traefik.http.routers.${routeur}.tls`] === "true" || !/^\s*web\s*$/.test(entrees);
    return `${tls ? "https" : "http"}://${hote}${chemin.startsWith("/") ? chemin : chemin ? `/${chemin}` : "/"}`;
  }
  return null;
}

const ETATS_PILE: Record<number, string> = { 1: "active", 2: "arretee" };
const TYPES_PILE: Record<number, string> = { 1: "swarm", 2: "compose", 3: "kubernetes" };

type PileBrute = {
  Id: number;
  Name: string;
  Status?: number;
  Type?: number;
  EndpointId?: number;
  CreationDate?: number;
  UpdateDate?: number;
  Env?: { name: string; value: string }[];
};

export function pile(brute: PileBrute) {
  const date = (secondes?: number) => (secondes ? new Date(secondes * 1000).toISOString() : null);
  return {
    id: brute.Id,
    nom: brute.Name,
    etat: ETATS_PILE[brute.Status ?? 0] ?? "inconnu",
    type: TYPES_PILE[brute.Type ?? 0] ?? "inconnu",
    environnement: brute.EndpointId ?? null,
    creeLe: date(brute.CreationDate),
    modifieLe: date(brute.UpdateDate),
    // Noms des variables seulement : leurs valeurs peuvent être des secrets.
    variables: (brute.Env ?? []).map((variable) => variable.name),
  };
}

/** Démultiplexe un journal Docker (en-tête de 8 octets par trame) ; un conteneur avec TTY envoie du texte brut. */
export function lignesDocker(octets: Uint8Array): { texte: string; flux: "stdout" | "stderr" }[] {
  const lignes: { texte: string; flux: "stdout" | "stderr" }[] = [];
  const decodeur = new TextDecoder();
  const multiplexe = octets.length >= 8 && (octets[0] === 1 || octets[0] === 2) && octets[1] === 0 && octets[2] === 0 && octets[3] === 0;
  const ajouter = (texte: string, flux: "stdout" | "stderr") => {
    for (const ligne of texte.replace(/\r\n?/g, "\n").split("\n")) if (ligne) lignes.push({ texte: ligne, flux });
  };
  if (!multiplexe) {
    ajouter(decodeur.decode(octets), "stdout");
    return lignes;
  }
  let position = 0;
  while (position + 8 <= octets.length) {
    const flux = octets[position] === 2 ? "stderr" : "stdout";
    const taille = (octets[position + 4] << 24) | (octets[position + 5] << 16) | (octets[position + 6] << 8) | octets[position + 7];
    ajouter(decodeur.decode(octets.subarray(position + 8, position + 8 + taille)), flux);
    position += 8 + taille;
  }
  return lignes;
}

export function base64EnOctets(texte: string): Uint8Array {
  const binaire = atob(texte);
  const octets = new Uint8Array(binaire.length);
  for (let index = 0; index < binaire.length; index += 1) octets[index] = binaire.charCodeAt(index);
  return octets;
}
