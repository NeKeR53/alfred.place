import { aucunCompte } from "../lib/comptes-api";
import { client } from "@alfred/sdk";

function urlDe(liens: { base?: string; webui?: string; self?: string } | undefined): string | null {
  if (!liens) return null;
  const base = liens.base ?? (liens.self ? liens.self.replace(/\/rest\/api\/.*$/, "") : "");
  if (!liens.webui) return base || null;
  return `${base}${liens.webui}`;
}

const clientConfluence = (instance?: string) => client("confluence", { instance });

function erreurConfluence(reponse: { status: number; body?: unknown }): never {
  const corps = reponse.body as { message?: string } | string | undefined;
  const detail = typeof corps === "string" ? corps.slice(0, 200) : corps?.message ?? "";
  throw new Error(`Confluence a répondu ${reponse.status}${detail ? ` : ${detail}` : ""}.`);
}

/** Espaces Confluence visibles par l’utilisateur. */
export default async function ({ instance }: { instance?: string }) {
  if (await aucunCompte("confluence")) return { espaces: [] };
  const reponse = await clientConfluence(instance).get<{
    results?: Array<{ key?: string; name?: string; _links?: { base?: string; webui?: string; self?: string } }>;
  }>("/rest/api/space", { limit: 100 });
  if (!reponse.ok) erreurConfluence(reponse);
  return {
    espaces: (reponse.body?.results ?? []).map((espace) => ({
      cle: espace.key ?? "",
      nom: espace.name ?? "",
      url: urlDe(espace._links),
    })),
  };
}
