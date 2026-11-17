import { client } from "@alfred/sdk";
import { aucunCompte } from "../lib/comptes-api";

function urlDe(liens: { base?: string; webui?: string; self?: string } | undefined): string | null {
  if (!liens) return null;
  const base = liens.base ?? (liens.self ? liens.self.replace(/\/rest\/api\/.*$/, "") : "");
  if (!liens.webui) return base || null;
  return `${base}${liens.webui}`;
}

function echapperCql(valeur: string): string {
  return valeur.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

interface PageConfluence {
  id: string;
  title?: string;
  space?: { key?: string; name?: string };
  version?: { number?: number };
  history?: { lastUpdated?: { when?: string; by?: { displayName?: string } } };
  _links?: { base?: string; webui?: string; self?: string };
}

/** Recherche des pages Confluence par mots, espace ou titre. */
export default async function ({
  instance,
  texte,
  espace,
  titre,
  limite,
  debut,
}: {
  instance?: string;
  texte?: string;
  espace?: string;
  titre?: string;
  limite?: number;
  debut?: number;
}) {
  if (await aucunCompte("confluence")) return { pages: [], suivant: false };
  const clauses = ["type = page"];
  if (espace?.trim()) clauses.push(`space = "${echapperCql(espace.trim())}"`);
  if (titre?.trim()) clauses.push(`title ~ "${echapperCql(titre.trim())}"`);
  if (texte?.trim()) {
    const mots = echapperCql(texte.trim());
    clauses.push(`(title ~ "${mots}" OR text ~ "${mots}")`);
  }
  const cql = `${clauses.join(" AND ")} ORDER BY lastmodified DESC`;

  const reponse = await client("confluence", { instance }).get<{
    results?: PageConfluence[];
    _links?: { next?: string };
  }>("/rest/api/content/search", {
    cql,
    limit: Math.min(100, Math.max(1, limite ?? 25)),
    start: Math.max(0, debut ?? 0),
    expand: "space,version,history",
  });
  if (!reponse.ok) {
    const corps = reponse.body as { message?: string } | undefined;
    throw new Error(`Confluence a répondu ${reponse.status}${corps?.message ? ` : ${corps.message}` : ""}.`);
  }

  return {
    pages: (reponse.body?.results ?? []).map((page) => ({
      id: page.id,
      titre: page.title ?? "(sans titre)",
      espace: page.space?.name ?? "",
      espaceCle: page.space?.key ?? "",
      version: page.version?.number ?? 0,
      misAJour: page.history?.lastUpdated?.when ?? null,
      auteur: page.history?.lastUpdated?.by?.displayName ?? "",
      url: urlDe(page._links),
    })),
    suivant: Boolean(reponse.body?._links?.next),
  };
}
