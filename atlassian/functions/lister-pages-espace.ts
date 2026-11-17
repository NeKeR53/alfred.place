import { client } from "@alfred/sdk";
import { aucunCompte } from "../lib/comptes-api";

interface PageBrute {
  id: string;
  title?: string;
  version?: { number?: number; when?: string; by?: { displayName?: string } };
  history?: { lastUpdated?: { when?: string; by?: { displayName?: string } } };
  children?: { page?: { size?: number } };
}

/** Un espace Confluence : sa description, sa page d’accueil et ses pages de premier niveau. */
export default async function ({ instance, espace }: { instance?: string; espace: string }) {
  if ((await aucunCompte("confluence")) || !espace?.trim()) return { espace: null, pages: [] };
  const confluence = client("confluence", { instance });
  const cle = encodeURIComponent(espace.trim());
  const [rEspace, rPages] = await Promise.all([
    confluence.get<{ key?: string; name?: string; description?: { plain?: { value?: string } }; homepage?: { id?: string; title?: string } }>(
      `/rest/api/space/${cle}`,
      { expand: "description.plain,homepage" },
      { cache: 600 },
    ),
    confluence.get<{ results?: PageBrute[] }>(`/rest/api/space/${cle}/content/page`, {
      depth: "root",
      limit: 100,
      expand: "version,children.page",
    }),
  ]);
  if (rEspace.status === 404) return { espace: null, pages: [] };
  if (!rEspace.ok) throw new Error(`Confluence a répondu ${rEspace.status}.`);
  const accueil = rEspace.body?.homepage?.id ? { id: rEspace.body.homepage.id, titre: rEspace.body.homepage.title ?? "" } : null;
  const pages = (rPages.ok ? (rPages.body?.results ?? []) : []).map((p) => ({
    id: p.id,
    titre: p.title ?? "(sans titre)",
    misAJour: p.version?.when ?? p.history?.lastUpdated?.when ?? null,
    auteur: p.version?.by?.displayName ?? p.history?.lastUpdated?.by?.displayName ?? "",
    sousPages: p.children?.page?.size ?? 0,
  }));
  return {
    espace: {
      cle: rEspace.body?.key ?? espace,
      nom: rEspace.body?.name ?? espace,
      description: rEspace.body?.description?.plain?.value ?? "",
      accueil,
    },
    pages,
  };
}
