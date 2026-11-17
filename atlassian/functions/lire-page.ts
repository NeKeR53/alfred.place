import { client } from "@alfred/sdk";
import { aucunCompte } from "../lib/comptes-api";

interface PageBrute {
  id: string;
  title?: string;
  space?: { key?: string; name?: string };
  version?: { number?: number; message?: string };
  history?: { lastUpdated?: { when?: string; by?: { displayName?: string } } };
  metadata?: { labels?: { results?: Array<{ name?: string }> } };
  body?: { view?: { value?: string } };
  children?: {
    page?: { results?: Array<{ id: string; title?: string }> };
    attachment?: {
      results?: Array<{
        id?: string;
        title?: string;
        extensions?: { fileSize?: number; mediaType?: string };
        _links?: { download?: string; base?: string };
      }>;
    };
  };
  ancestors?: Array<{ id: string; title?: string }>;
  _links?: { base?: string; webui?: string; self?: string };
}

/** Rend absolues les adresses relatives d’un HTML Confluence. */
function absolutiser(html: string, base: string): string {
  if (!base) return html;
  return html.replace(/(href|src)="(\/(?!\/)[^"]*)"/g, (_tout, attribut: string, chemin: string) => `${attribut}="${base}${chemin}"`);
}

/** Une page Confluence en lecture : son contenu rendu, ses métadonnées et ses pièces jointes. */
export default async function ({ instance, id }: { instance?: string; id: string }) {
  if (await aucunCompte("confluence")) return { page: null };
  const reponse = await client("confluence", { instance }).get<PageBrute>(`/rest/api/content/${encodeURIComponent(id)}`, {
    expand: "body.view,space,version,history,history.createdBy,metadata.labels,children.attachment,children.page,ancestors",
  });
  if (reponse.status === 404) return { page: null };
  if (!reponse.ok) {
    const corps = reponse.body as unknown as { message?: string };
    throw new Error(`Confluence a répondu ${reponse.status}${corps?.message ? ` : ${corps.message}` : ""}.`);
  }

  const page = reponse.body;
  const base = page._links?.base ?? (page._links?.self ? page._links.self.replace(/\/rest\/api\/.*$/, "") : "");
  const html = absolutiser(page.body?.view?.value ?? "", base);

  return {
    page: {
      id: page.id,
      titre: page.title ?? "(sans titre)",
      espace: page.space?.name ?? "",
      espaceCle: page.space?.key ?? "",
      version: page.version?.number ?? 0,
      messageVersion: page.version?.message ?? "",
      misAJour: page.history?.lastUpdated?.when ?? null,
      auteur: page.history?.lastUpdated?.by?.displayName ?? "",
      url: page._links?.webui ? `${base}${page._links.webui}` : null,
      html,
      ancetres: (page.ancestors ?? []).map((a) => ({ id: a.id, titre: a.title ?? "" })),
      enfants: (page.children?.page?.results ?? []).map((e) => ({ id: e.id, titre: e.title ?? "" })),
      etiquettes: (page.metadata?.labels?.results ?? []).map((etiquette) => etiquette.name ?? "").filter(Boolean),
      pieces: (page.children?.attachment?.results ?? []).map((piece) => ({
        id: piece.id ?? "",
        nom: piece.title ?? "Pièce jointe",
        taille: piece.extensions?.fileSize ?? 0,
        type: piece.extensions?.mediaType ?? "",
        url: piece._links?.download ? `${piece._links.base ?? base}${piece._links.download}` : null,
      })),
    },
  };
}
