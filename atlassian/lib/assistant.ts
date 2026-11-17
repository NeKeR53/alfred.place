import { ai } from "@alfred/sdk";

/** Schéma d’objet strict, comme `ai.oneShot` le demande. */
function objet(proprietes: Record<string, unknown>) {
  return { type: "object", properties: proprietes, required: Object.keys(proprietes), additionalProperties: false };
}
const texte = { type: "string" };
const listeDe = (items: unknown) => ({ type: "array", items });

const FRANCAIS = "Réponds en français, de façon concise et concrète, sans formule de politesse.";

// ——— Jira ———

export interface ContexteTicket {
  cle: string;
  titre: string;
  type: string;
  statut: string;
  priorite: string;
  assigne: string;
  description: string;
  commentaires: Array<{ auteur: string; corps: string }>;
  champs?: Array<{ nom: string; affichage: string }>;
}

function contexteTicket(ticket: ContexteTicket) {
  return {
    ...ticket,
    description: ticket.description.slice(0, 20000),
    commentaires: ticket.commentaires.slice(-25).map((c) => ({ auteur: c.auteur, texte: c.corps.slice(0, 2000) })),
  };
}

export function resumerTicket(ticket: ContexteTicket) {
  return ai.oneShot<{ resume: string; pointsCles: string[]; prochaineEtape: string }>({
    instruction: `Résume ce ticket Jira et son fil de commentaires : ce qui est demandé, où on en est, ce qui bloque. ${FRANCAIS}`,
    context: contexteTicket(ticket),
    schema: objet({ resume: texte, pointsCles: listeDe(texte), prochaineEtape: texte }),
  });
}

export function redigerCommentaire(ticket: ContexteTicket, intention: string) {
  return ai.oneShot<{ commentaire: string }>({
    instruction: `Rédige un commentaire à publier sur ce ticket Jira. Intention de l’auteur : « ${intention || "faire le point et proposer la suite"} ». Ton professionnel et direct. ${FRANCAIS}`,
    context: contexteTicket(ticket),
    schema: objet({ commentaire: texte }),
  });
}

export function proposerSousTaches(ticket: ContexteTicket) {
  return ai.oneShot<{ sousTaches: Array<{ titre: string; description: string }> }>({
    instruction: `Découpe ce ticket Jira en 2 à 6 sous-tâches concrètes, chacune réalisable en moins d’une journée. Titres courts à l’infinitif. ${FRANCAIS}`,
    context: contexteTicket(ticket),
    schema: objet({ sousTaches: listeDe(objet({ titre: texte, description: texte })) }),
  });
}

export function suggererTriage(ticket: ContexteTicket, priorites: string[], personnes: Array<{ id: string; nom: string }>) {
  return ai.oneShot<{ priorite: string; assigne: string; justification: string }>({
    instruction: `Propose la priorité la plus juste parmi la liste fournie, et la personne la mieux placée parmi celles proposées (son identifiant, ou une chaîne vide si aucune ne convient). Justifie en deux phrases. ${FRANCAIS}`,
    context: { ticket: contexteTicket(ticket), priorites, personnes },
    schema: objet({ priorite: texte, assigne: texte, justification: texte }),
  });
}

// ——— Bitbucket ———

export interface ContextePr {
  titre: string;
  description: string;
  source: string;
  cible: string;
  commits: string[];
  diffs: Array<{ chemin: string; nature: string; texte: string }>;
}

function contextePr(pr: ContextePr) {
  let reste = 90000;
  return {
    ...pr,
    diffs: pr.diffs.map((d) => {
      const extrait = d.texte.slice(0, Math.max(0, Math.min(reste, 12000)));
      reste -= extrait.length;
      return { ...d, texte: extrait };
    }),
  };
}

export function analyserPr(pr: ContextePr) {
  return ai.oneShot<{
    resume: string;
    risques: Array<{ fichier: string; risque: string; gravite: string }>;
    conseil: string;
  }>({
    instruction: `Résume cette pull request (ce qu’elle change et pourquoi), puis liste les risques concrets repérés dans les différences : régressions, sécurité, données, cas oubliés. gravite vaut « faible », « moyenne » ou « élevée ». Termine par un conseil : fusionner, demander des changements ou tester d’abord. ${FRANCAIS}`,
    context: contextePr(pr),
    schema: objet({
      resume: texte,
      risques: listeDe(objet({ fichier: texte, risque: texte, gravite: { type: "string", enum: ["faible", "moyenne", "élevée"] } })),
      conseil: texte,
    }),
  });
}

export function revuePr(pr: ContextePr) {
  return ai.oneShot<{ commentaires: Array<{ fichier: string; remarque: string }> }>({
    instruction: `Fais la revue de code de cette pull request comme un relecteur exigeant et bienveillant : au plus 10 remarques utiles (bogue, lisibilité, test manquant, sécurité), chacune liée à un fichier et rédigée comme un commentaire prêt à publier. Pas de remarque de pure forme. ${FRANCAIS}`,
    context: contextePr(pr),
    schema: objet({ commentaires: listeDe(objet({ fichier: texte, remarque: texte })) }),
  });
}

export function redigerDescriptionPr(pr: ContextePr) {
  return ai.oneShot<{ description: string }>({
    instruction: `Rédige la description de cette pull request en Markdown : contexte en une phrase, liste des changements, comment tester. ${FRANCAIS}`,
    context: contextePr(pr),
    schema: objet({ description: texte }),
  });
}

export function expliquerFichier(chemin: string, contenu: string) {
  return ai.oneShot<{ explication: string }>({
    instruction: `Explique ce fichier à un développeur qui le découvre : son rôle, ses parties principales, ses dépendances, les points d’attention. Réponds en Markdown. ${FRANCAIS}`,
    context: { chemin, contenu: contenu.slice(0, 60000) },
    schema: objet({ explication: texte }),
  });
}

// ——— Confluence ———

export function resumerPage(titre: string, contenu: string) {
  return ai.oneShot<{ resume: string; pointsCles: string[] }>({
    instruction: `Résume cette page Confluence en un paragraphe, puis ses points clés. ${FRANCAIS}`,
    context: { titre, contenu: contenu.slice(0, 80000) },
    schema: objet({ resume: texte, pointsCles: listeDe(texte) }),
  });
}

export function questionnerPage(titre: string, contenu: string, question: string) {
  return ai.oneShot<{ reponse: string; trouve: boolean }>({
    instruction: `Réponds à la question en t’appuyant uniquement sur cette page Confluence. Si la page ne contient pas la réponse, dis-le (trouve = false). Réponds en Markdown. ${FRANCAIS}\nQuestion : ${question}`,
    context: { titre, contenu: contenu.slice(0, 80000) },
    schema: objet({ reponse: texte, trouve: { type: "boolean" } }),
  });
}
