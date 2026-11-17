import { client } from "@alfred/sdk";
import { aucunCompte } from "../lib/comptes-api";
import { erreurAtlassian, texteJira, urlTicket } from "../lib/jira-api";
import {
  CHAMPS_A_PART,
  type ChampTicket,
  choisirEditeur,
  formaterValeur,
  type MetaChamp,
  nomChamp,
  optionsDe,
  type SchemaJira,
} from "../lib/jira-champs";

interface Entree {
  instance?: string;
  cle: string;
}

type Objet = Record<string, any>;

function resumeTicket(issue: Objet | undefined) {
  const f = issue?.fields ?? {};
  return {
    cle: String(issue?.key ?? ""),
    titre: String(f.summary ?? ""),
    statut: String(f.status?.name ?? ""),
    categorie: String(f.status?.statusCategory?.key ?? "new"),
    type: String(f.issuetype?.name ?? ""),
  };
}

/** Un ticket Jira complet : tous ses champs (modifiables ou non), description, commentaires, liens, sous-tâches, temps passé, historique. */
export default async function (entree: Entree) {
  if (await aucunCompte("jira")) return { ticket: null };
  const jira = client("jira", { instance: entree.instance });
  const cle = entree.cle.trim();
  if (!cle) throw new Error("La clé du ticket est vide.");
  const base = `/rest/api/2/issue/${encodeURIComponent(cle)}`;

  const reponse = await jira.get<Objet>(base, { expand: "names,schema,editmeta,renderedFields,changelog" });
  if (reponse.status === 404) return { ticket: null };
  if (!reponse.ok) erreurAtlassian("Jira", reponse);

  const [rTransitions, rTravail] = await Promise.all([
    jira.get<Objet>(`${base}/transitions`, { expand: "transitions.fields" }),
    jira.get<Objet>(`${base}/worklog`),
  ]);

  const issue = reponse.body;
  const f: Objet = issue.fields ?? {};
  const rendu: Objet = issue.renderedFields ?? {};
  const noms: Record<string, string> = issue.names ?? {};
  const schemas: Record<string, SchemaJira> = issue.schema ?? {};
  const meta: Record<string, MetaChamp> = issue.editmeta?.fields ?? {};

  // Tous les champs : ceux qui ont une valeur, et ceux qu’on peut remplir.
  const ids = new Set([...Object.keys(f), ...Object.keys(meta)]);
  const champs: ChampTicket[] = [];
  for (const id of ids) {
    if (CHAMPS_A_PART.has(id)) continue;
    const m = meta[id];
    const schema = m?.schema ?? schemas[id];
    const editeur = choisirEditeur(schema, m, id);
    const { affichage, valeur } = formaterValeur(f[id], editeur);
    const modifiable = Boolean(m) && editeur !== "lecture" && (m?.operations?.includes("set") ?? true);
    if (!affichage && !modifiable) continue;
    champs.push({
      id,
      nom: nomChamp(id, m?.name ?? noms[id]),
      editeur: modifiable ? editeur : "lecture",
      modifiable,
      requis: m?.required === true,
      affichage,
      valeur,
      options: modifiable ? optionsDe(m) : [],
    });
  }
  // Champs remplis d’abord, puis par ordre alphabétique.
  champs.sort((a, b) => Number(!a.affichage) - Number(!b.affichage) || a.nom.localeCompare(b.nom, "fr"));

  const commentaires = ((f.comment?.comments ?? []) as Objet[]).map((c, index) => ({
    id: String(c.id),
    auteur: String(c.author?.displayName ?? "Quelqu’un"),
    cree: c.created ?? null,
    modifie: c.updated && c.updated !== c.created ? c.updated : null,
    corps: texteJira(c.body).trim(),
    html: String(rendu.comment?.comments?.[index]?.body ?? ""),
  }));

  const liens = ((f.issuelinks ?? []) as Objet[]).map((lien) => {
    const sortant = Boolean(lien.outwardIssue);
    const autre = sortant ? lien.outwardIssue : lien.inwardIssue;
    return {
      id: String(lien.id),
      relation: String(sortant ? (lien.type?.outward ?? lien.type?.name) : (lien.type?.inward ?? lien.type?.name)),
      ...resumeTicket(autre),
    };
  });

  const travail = rTravail.ok ? ((rTravail.body?.worklogs ?? []) as Objet[]) : [];
  const suivi: Objet = f.timetracking ?? {};

  const historique = ((issue.changelog?.histories ?? []) as Objet[])
    .map((h) => ({
      id: String(h.id),
      auteur: String(h.author?.displayName ?? "Quelqu’un"),
      quand: h.created ?? null,
      changements: ((h.items ?? []) as Objet[]).map((item) => ({
        champ: nomChamp(String(item.fieldId ?? item.field ?? ""), String(item.field ?? "")),
        de: String(item.fromString ?? item.from ?? ""),
        vers: String(item.toString ?? item.to ?? ""),
      })),
    }))
    .sort((a, b) => String(b.quand ?? "").localeCompare(String(a.quand ?? "")))
    .slice(0, 60);

  const ticket = {
    cle: issue.key,
    id: issue.id,
    instance: entree.instance ?? null,
    titre: f.summary ?? "(sans titre)",
    description: texteJira(f.description).trim(),
    descriptionHtml: String(rendu.description ?? ""),
    statut: f.status?.name ?? "",
    statutCategorie: f.status?.statusCategory?.key ?? "new",
    assigne: f.assignee?.displayName ?? "Non assigné",
    assigneId: f.assignee?.name ?? f.assignee?.accountId ?? null,
    rapporteur: f.reporter?.displayName ?? "",
    priorite: f.priority?.name ?? "",
    type: f.issuetype?.name ?? "",
    projet: f.project?.key ?? "",
    projetNom: f.project?.name ?? "",
    echeance: f.duedate ?? null,
    etiquettes: f.labels ?? [],
    cree: f.created ?? null,
    misAJour: f.updated ?? null,
    url: urlTicket(issue.self, issue.key),
    parent: f.parent ? resumeTicket(f.parent) : null,
    champs,
    pieces: ((f.attachment ?? []) as Objet[]).map((piece) => ({
      id: String(piece.id),
      nom: piece.filename ?? "Pièce jointe",
      taille: piece.size ?? 0,
      type: piece.mimeType ?? "",
      url: piece.content ?? null,
      cree: piece.created ?? null,
      auteur: piece.author?.displayName ?? "",
    })),
    commentaires,
    liens,
    sousTaches: ((f.subtasks ?? []) as Objet[]).map(resumeTicket),
    temps: {
      estimation: suivi.originalEstimate ?? "",
      restant: suivi.remainingEstimate ?? "",
      passe: suivi.timeSpent ?? "",
      entrees: travail
        .map((w) => ({
          id: String(w.id),
          auteur: String(w.author?.displayName ?? "Quelqu’un"),
          duree: String(w.timeSpent ?? ""),
          quand: w.started ?? null,
          commentaire: texteJira(w.comment).trim(),
        }))
        .reverse(),
    },
    observateurs: Number(f.watches?.watchCount ?? 0),
    jeSuis: Boolean(f.watches?.isWatching),
    votes: Number(f.votes?.votes ?? 0),
    historique,
    transitions: (rTransitions.ok ? ((rTransitions.body?.transitions ?? []) as Objet[]) : []).map((t) => ({
      id: String(t.id),
      nom: String(t.name),
      vers: String(t.to?.name ?? ""),
      categorie: String(t.to?.statusCategory?.key ?? "new"),
    })),
  };

  return { ticket };
}
