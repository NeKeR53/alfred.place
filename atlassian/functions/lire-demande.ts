import { client } from "@alfred/sdk";
import { aucunCompte } from "../lib/comptes-api";
import { erreurAtlassian, urlTicket } from "../lib/jira-api";
import { categorieEtat, resumerSla, valeurEnTexte, type SlaJsm, type SlaResume } from "../lib/support-api";

interface DemandeJsm {
  issueKey?: string;
  reporter?: { displayName?: string; emailAddress?: string };
  createdDate?: { iso8601?: string };
  requestFieldValues?: Array<{ fieldId?: string; label?: string; value?: unknown }>;
  currentStatus?: { status?: string; statusCategory?: string; statusDate?: { iso8601?: string } };
  participants?: { values?: Array<{ displayName?: string }> };
  sla?: { values?: SlaJsm[] };
  requestType?: { name?: string };
  _links?: { web?: string };
}

interface CommentaireJsm {
  id: string | number;
  body?: string;
  public?: boolean;
  author?: { displayName?: string };
  created?: { iso8601?: string };
}

/** Une demande de support en entier : client, délais et échanges. */
export default async function ({ instance, cle }: { instance?: string; cle: string }) {
  const code = (cle ?? "").trim();
  if (!code) throw new Error("La clé de la demande est vide.");
  if (await aucunCompte("jira")) return { demande: null };
  const jira = client("jira", { instance });
  const chemin = `/rest/servicedeskapi/request/${encodeURIComponent(code)}`;

  const requete = await jira.get<DemandeJsm>(chemin, { expand: "participant,sla,requestType,status" });
  if (requete.status === 404) return { demande: null };
  if (!requete.ok) erreurAtlassian("Jira Service Management", requete);
  const d = requete.body ?? {};

  const [echanges, ticket] = await Promise.all([
    jira.get<{ values?: CommentaireJsm[] }>(`${chemin}/comment`, { start: 0, limit: 100 }),
    jira.get<{
      self?: string;
      fields?: {
        assignee?: { displayName?: string; name?: string; accountId?: string } | null;
        priority?: { name?: string } | null;
        project?: { key?: string };
        status?: { statusCategory?: { key?: string } };
      };
    }>(`/rest/api/2/issue/${encodeURIComponent(code)}`, { fields: "assignee,priority,project,status" }),
  ]);
  if (!echanges.ok) erreurAtlassian("Jira Service Management", echanges);
  if (!ticket.ok) erreurAtlassian("Jira", ticket);
  const f = ticket.body?.fields ?? {};

  const valeurs = d.requestFieldValues ?? [];
  const titre = valeurEnTexte(valeurs.find((v) => v.fieldId === "summary")?.value);
  const description = valeurEnTexte(valeurs.find((v) => v.fieldId === "description")?.value);
  const champs = valeurs
    .filter((v) => v.fieldId !== "summary" && v.fieldId !== "description" && v.fieldId !== "attachment")
    .map((v) => ({ libelle: v.label ?? v.fieldId ?? "Champ", valeur: valeurEnTexte(v.value) }))
    .filter((v) => v.valeur);

  return {
    demande: {
      cle: d.issueKey ?? code,
      instance: instance ?? null,
      titre: titre || "(sans titre)",
      client: d.reporter?.displayName ?? "Client inconnu",
      clientEmail: d.reporter?.emailAddress ?? null,
      typeDemande: d.requestType?.name ?? null,
      statut: d.currentStatus?.status ?? "",
      statutCategorie: f.status?.statusCategory?.key ?? categorieEtat(d.currentStatus?.statusCategory),
      statutDepuis: d.currentStatus?.statusDate?.iso8601 ?? null,
      assigne: f.assignee?.displayName ?? "Non assigné",
      assigneId: f.assignee?.name ?? f.assignee?.accountId ?? null,
      priorite: f.priority?.name ?? "",
      projet: f.project?.key ?? code.split("-")[0],
      creee: d.createdDate?.iso8601 ?? null,
      description,
      champs,
      participants: (d.participants?.values ?? []).map((p) => p.displayName ?? "").filter(Boolean),
      sla: (d.sla?.values ?? []).map(resumerSla).filter((sla): sla is SlaResume => sla !== null),
      commentaires: (echanges.body?.values ?? []).map((c) => ({
        id: String(c.id),
        auteur: c.author?.displayName ?? "Inconnu",
        texte: c.body ?? "",
        public: c.public !== false,
        date: c.created?.iso8601 ?? null,
      })),
      url: urlTicket(ticket.body?.self, code),
      urlPortail: d._links?.web ?? null,
    },
  };
}
