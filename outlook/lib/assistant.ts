import { ai } from "@alfred/sdk";

const FRANCAIS = "Réponds en français, de façon concise et concrète.";

function objet(proprietes: Record<string, unknown>) {
  return { type: "object", properties: proprietes, required: Object.keys(proprietes), additionalProperties: false };
}

/** Texte lisible du corps HTML d’un message. */
export function texteMessage(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim()
    .slice(0, 40000);
}

export function resumerMessage(message: { objet: string; expediteur: string; corps: string }) {
  return ai.oneShot<{ resume: string; actions: string[] }>({
    instruction: `Résume ce courriel (et le fil cité dessous s’il y en a un) : ce qui est dit, ce qui est demandé. Liste ensuite les actions attendues de moi. ${FRANCAIS}`,
    context: { objet: message.objet, expediteur: message.expediteur, texte: texteMessage(message.corps) },
    schema: objet({ resume: { type: "string" }, actions: { type: "array", items: { type: "string" } } }),
  });
}

export function redigerReponse(message: { objet: string; expediteur: string; corps: string }, intention: string) {
  return ai.oneShot<{ reponse: string }>({
    instruction: `Rédige ma réponse à ce courriel, prête à envoyer, sans signature. Ton professionnel, direct et cordial. ${intention ? `Ce que je veux dire : ${intention}.` : "Réponds à ce qui est demandé."} ${FRANCAIS}`,
    context: { objet: message.objet, expediteur: message.expediteur, texte: texteMessage(message.corps) },
    schema: objet({ reponse: { type: "string" } }),
  });
}
