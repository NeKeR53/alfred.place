// Accès commun à l’API d’administration Keycloak, utilisé par les seules fonctions du connecteur.
// `{realm}` est le royaume du compte : Alfred le remplace dans chaque chemin.
import { client, type ClientResponse } from "@alfred/sdk";

export type Entree = { instance?: string };

export function keycloak(instance?: string) {
  return client("keycloak", instance ? { instance } : {});
}

/** Chemin de l’API d’administration du royaume du compte. */
export const admin = (chemin = "") => `/admin/realms/{realm}${chemin}`;

export const segment = (valeur: string) => encodeURIComponent(valeur.trim());

function detail(corps: unknown): string {
  if (corps && typeof corps === "object") {
    const objet = corps as Record<string, unknown>;
    const texte = objet.errorMessage ?? objet.error_description ?? objet.error ?? objet.message;
    if (typeof texte === "string") return ` : ${texte.slice(0, 200)}`;
  }
  return "";
}

/** Rend le corps d’une réponse réussie, sinon une erreur en français. */
export function verifier<T>(reponse: ClientResponse<unknown>, action: string): T {
  if (reponse.ok) return reponse.body as T;
  if (reponse.status === 401 || reponse.status === 403)
    throw new Error(`Keycloak refuse ${action} (HTTP ${reponse.status}) : le compte n’a pas les droits d’administration du royaume.`);
  if (reponse.status === 404) throw new Error(`Keycloak ne trouve pas ${action.replace(/^(de |d’|la |le |les )/, "")} (HTTP 404).`);
  if (reponse.status === 409) throw new Error(`Keycloak refuse ${action} : l’élément existe déjà${detail(reponse.body)}.`);
  throw new Error(`Keycloak a répondu ${reponse.status} pour ${action}${detail(reponse.body)}.`);
}

/** Identifiant créé, lu dans l’en-tête `Location` d’une réponse 201. */
export function identifiantCree(reponse: ClientResponse<unknown>): string | null {
  const location = reponse.headers.location ?? reponse.headers.Location ?? "";
  const dernier = location.split("/").filter(Boolean).pop();
  return dernier ? decodeURIComponent(dernier) : null;
}

type UtilisateurKeycloak = {
  id: string;
  username: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  enabled?: boolean;
  createdTimestamp?: number;
};

export function utilisateur(brut: UtilisateurKeycloak) {
  return {
    id: brut.id,
    identifiant: brut.username,
    prenom: brut.firstName ?? "",
    nom: brut.lastName ?? "",
    email: brut.email ?? "",
    actif: brut.enabled !== false,
    creeLe: typeof brut.createdTimestamp === "number" ? new Date(brut.createdTimestamp).toISOString() : null,
  };
}

type GroupeKeycloak = { id: string; name: string; path?: string; subGroupCount?: number; subGroups?: unknown[] };

export function groupe(brut: GroupeKeycloak) {
  return {
    id: brut.id,
    nom: brut.name,
    chemin: brut.path ?? `/${brut.name}`,
    sousGroupes: typeof brut.subGroupCount === "number" ? brut.subGroupCount : (brut.subGroups?.length ?? 0),
  };
}

type RoleKeycloak = { id: string; name: string; description?: string; composite?: boolean; clientRole?: boolean };

export function role(brut: RoleKeycloak) {
  return { id: brut.id, nom: brut.name, description: brut.description ?? "", composite: brut.composite === true };
}

type ClientKeycloak = {
  id: string;
  clientId: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  publicClient?: boolean;
  redirectUris?: string[];
  webOrigins?: string[];
};

export function clientApplicatif(brut: ClientKeycloak) {
  return {
    id: brut.id,
    clientId: brut.clientId,
    nom: brut.name ?? "",
    description: brut.description ?? "",
    actif: brut.enabled !== false,
    public: brut.publicClient === true,
    redirections: brut.redirectUris ?? [],
    origines: brut.webOrigins ?? [],
  };
}

export type ClientSaisi = {
  clientId?: string;
  nom?: string;
  description?: string;
  actif?: boolean;
  public?: boolean;
  redirections?: string[];
  origines?: string[];
};

/** Représentation Keycloak d’un client applicatif saisi (champs absents laissés tels quels). */
export function representationClient(saisie: ClientSaisi, existant: Record<string, unknown> = {}) {
  const nettoyer = (liste?: string[]) => liste?.map((valeur) => valeur.trim()).filter(Boolean);
  return {
    ...existant,
    ...(saisie.clientId !== undefined ? { clientId: saisie.clientId.trim() } : {}),
    ...(saisie.nom !== undefined ? { name: saisie.nom.trim() } : {}),
    ...(saisie.description !== undefined ? { description: saisie.description.trim() } : {}),
    ...(saisie.actif !== undefined ? { enabled: saisie.actif } : {}),
    ...(saisie.public !== undefined ? { publicClient: saisie.public } : {}),
    ...(saisie.redirections !== undefined ? { redirectUris: nettoyer(saisie.redirections) } : {}),
    ...(saisie.origines !== undefined ? { webOrigins: nettoyer(saisie.origines) } : {}),
    protocol: "openid-connect",
  };
}

/** Une personne avec ses attributs (lecture `briefRepresentation=false`), en listes de textes. */
export function utilisateurDetail(brut: UtilisateurKeycloak & { attributes?: Record<string, unknown> }) {
  const attributs: Record<string, string[]> = {};
  if (brut.attributes && typeof brut.attributes === "object" && !Array.isArray(brut.attributes))
    for (const [cle, valeurs] of Object.entries(brut.attributes))
      attributs[cle] = (Array.isArray(valeurs) ? valeurs : [valeurs]).filter((v): v is string => typeof v === "string");
  return { ...utilisateur(brut), attributs };
}
