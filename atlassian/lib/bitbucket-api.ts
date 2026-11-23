import { client } from "@alfred/sdk";

/**
 * Une liste venue de Bitbucket, toujours un tableau : un serveur, une version ou un proxy
 * qui répond autre chose (objet, texte, rien) donne une liste vide au lieu de faire planter la page.
 */
export function liste<T>(valeur: T[] | null | undefined): T[] {
  return Array.isArray(valeur) ? (valeur as T[]) : [];
}

export function erreurBitbucket(reponse: { status: number; body?: unknown }): never {
  const corps = reponse.body as { errors?: Array<{ message?: string }>; message?: string } | string | undefined;
  let detail = "";
  if (typeof corps === "string") detail = corps.slice(0, 200);
  else if (corps && Array.isArray(corps.errors) && corps.errors.length > 0) {
    detail = corps.errors.map((erreur) => erreur.message ?? "").filter(Boolean).join(" ; ");
  } else if (corps && typeof corps.message === "string") detail = corps.message;
  throw new Error(`Bitbucket a répondu ${reponse.status}${detail ? ` : ${detail}` : ""}.`);
}

/** Adresse web d’une ressource Bitbucket, à partir de son adresse d’API. */
export function urlBitbucket(href: string | undefined): string | null {
  if (!href) return null;
  return href.replace(/\/rest\/api\/1\.0\/?/, "/");
}

export function cheminEncode(chemin: string): string {
  return chemin
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** Retrouve un dépôt et une pull request depuis « PROJET/dépôt/numéro ». */
export function resoudrePr(entree: { projet?: string; depot?: string; id?: number; pr?: string }) {
  if (entree.projet?.trim() && entree.depot?.trim() && entree.id) {
    return { projet: entree.projet.trim(), depot: entree.depot.trim(), id: Number(entree.id) };
  }
  const brut = (entree.pr ?? "").trim().replace(/^#/, "");
  const morceaux = brut.split(/[/#]/);
  if (morceaux.length < 3) {
    throw new Error("Indiquez la pull request sous la forme « PROJET/dépôt/numéro ».");
  }
  const numero = Number(morceaux[morceaux.length - 1]);
  if (!Number.isFinite(numero) || numero <= 0) throw new Error("Le numéro de la pull request est invalide.");
  return {
    projet: morceaux[0],
    depot: morceaux.slice(1, -1).join("/"),
    id: numero,
  };
}

export function bitbucketClient(instance?: string) {
  return client("bitbucket", { instance });
}

export interface DepotBrut {
  slug: string;
  name: string;
  description?: string;
  archived?: boolean;
  public?: boolean;
  project?: { key?: string; name?: string };
  links?: { self?: Array<{ href?: string }>; clone?: Array<{ href?: string; name?: string }> };
}

export interface PrBrut {
  id: number;
  version?: number;
  title?: string;
  description?: string;
  state?: string;
  createdDate?: number;
  updatedDate?: number;
  author?: { user?: { displayName?: string; name?: string } };
  fromRef?: { displayId?: string; repository?: { slug?: string; project?: { key?: string } } };
  toRef?: { displayId?: string };
  reviewers?: Array<{ user?: { displayName?: string }; status?: string; approved?: boolean }>;
  links?: { self?: Array<{ href?: string }> };
  properties?: { commentCount?: number };
}

export function normaliserPr(pr: PrBrut) {
  return {
    id: pr.id,
    version: pr.version ?? 0,
    titre: pr.title ?? "(sans titre)",
    description: pr.description ?? "",
    etat: pr.state ?? "OPEN",
    auteur: pr.author?.user?.displayName ?? "",
    source: pr.fromRef?.displayId ?? "",
    cible: pr.toRef?.displayId ?? "",
    projet: pr.fromRef?.repository?.project?.key ?? "",
    depot: pr.fromRef?.repository?.slug ?? "",
    cree: pr.createdDate ?? null,
    misAJour: pr.updatedDate ?? null,
    commentaires: pr.properties?.commentCount ?? null,
    evaluateurs: liste<NonNullable<PrBrut["reviewers"]>[number]>(pr.reviewers).map((evaluateur) => ({
      nom: evaluateur.user?.displayName ?? "",
      statut: evaluateur.approved ? "approuvé" : evaluateur.status ?? "en attente",
    })),
    url: urlBitbucket(liste<{ href?: string }>(pr.links?.self)[0]?.href),
  };
}

export function normaliserDepot(depot: DepotBrut, brancheDefaut?: string | null) {
  return {
    slug: depot.slug,
    nom: depot.name,
    description: depot.description ?? "",
    projet: depot.project?.key ?? "",
    projetNom: depot.project?.name ?? "",
    archive: depot.archived === true,
    public: depot.public === true,
    brancheDefaut: brancheDefaut ?? null,
    url: urlBitbucket(liste<{ href?: string }>(depot.links?.self)[0]?.href),
    clones: liste<{ href?: string; name?: string }>(depot.links?.clone)
      .filter((lien) => lien.href)
      .map((lien) => ({ nom: lien.name === "ssh" ? "SSH" : "HTTPS", url: lien.href ?? "" })),
  };
}
