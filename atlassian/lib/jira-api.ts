import { client } from "@alfred/sdk";

/** Réponse d’erreur d’un service Atlassian, traduite en une phrase lisible. */
export function erreurAtlassian(service: string, reponse: { status: number; body?: unknown }): never {
  const corps = reponse.body as Record<string, unknown> | string | undefined;
  let detail = "";
  if (typeof corps === "string") detail = corps.slice(0, 200);
  else if (corps) {
    const erreurs = corps.errorMessages;
    if (Array.isArray(erreurs) && erreurs.length > 0) detail = String(erreurs.join(" ; "));
    else if (typeof corps.message === "string") detail = corps.message;
    else if (typeof corps.errors === "object" && corps.errors) detail = Object.values(corps.errors as object).join(" ; ");
  }
  throw new Error(`${service} a répondu ${reponse.status}${detail ? ` : ${detail}` : ""}.`);
}

/** Texte d’une description Jira, qu’elle soit en texte simple ou en document ADF. */
export function texteJira(valeur: unknown): string {
  if (typeof valeur === "string") return valeur;
  if (!valeur || typeof valeur !== "object") return "";
  const noeud = valeur as { type?: string; text?: string; content?: unknown[]; attrs?: Record<string, unknown> };
  if (noeud.type === "text") return noeud.text ?? "";
  if (noeud.type === "hardBreak") return "\n";
  if (noeud.type === "mention") return `@${String(noeud.attrs?.text ?? "quelqu’un")}`;
  const enfants = Array.isArray(noeud.content) ? noeud.content.map(texteJira).join("") : "";
  if (noeud.type === "paragraph" || noeud.type === "heading" || noeud.type === "listItem") return `${enfants}\n`;
  if (noeud.type === "codeBlock") return `${enfants}\n`;
  return enfants;
}

/** Chemin d’une URL absolue du service, pour passer par le client. */
export function cheminDe(url: string): string {
  const chemin = new URL(url, "https://exemple.local").pathname;
  return chemin.startsWith("/") ? chemin : `/${chemin}`;
}

/** Adresse web d’un ticket, à partir de son adresse d’API. */
export function urlTicket(self: string | undefined, cle: string): string | null {
  if (!self) return null;
  return `${self.replace(/\/rest\/api\/.*$/, "")}/browse/${cle}`;
}

export function echapperJql(valeur: string): string {
  return `"${valeur.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function jiraClient(instance?: string) {
  return client("jira", { instance });
}
