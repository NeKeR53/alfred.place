// Projet : lecture et écriture, comme la page Projets de OneApp. Les tickets, leurs responsables, colonnes, durées
// et leur ordre (Rank) vivent dans Jira (module atlassian) ; les équipes, personnes, absences et le reste de l’état
// du tableau vivent dans la base du module (atom_equipes, atom_equipe_membres, atom_reglages « projet.* »).
import { lireReglages, projetsSuivis } from "./reglages";
import { db, functions } from "./source";
import {
  addProjectDays,
  freeBusyAbsences,
  outlookDays,
  type PlanTicket,
  type ProjectManagementState,
  type ProjectMember,
  type ProjectRankMove,
  type ProjectTicketPatch,
  projectNameKey,
  projectTicketStage,
  replaceCalendarAbsences,
  type SourcedTicket,
  type ProjectTicket,
  type WorkflowEvent,
} from "./planning";

/** Le seul fournisseur des tickets d’Atom : la connexion Jira du projet. */
export const JIRA = "jira";
export const PROVIDER_TEAM = "project-provider-members";
const COULEURS = ["violet", "blue", "teal", "orange", "green", "pink", "red", "steel"];

export type Produit = { id: string; name: string; color: string };
export type TicketJira = {
  cle: string;
  titre: string;
  projet: string;
  projetNom: string;
  type?: string;
  priorite?: string;
  statut: string;
  statutCategorie: string;
  assigne: string | null;
  assigneId: string | null;
  assigneLogin?: string | null;
  assigneEmail?: string | null;
  echeance?: string | null;
  estimationSecondes?: number | null;
  restantSecondes?: number | null;
  rang?: string | null;
  url?: string | null;
  instance?: string | null;
  historique?: { le: string; statut?: string; statutCategorie?: string; assigneId?: string | null }[];
};

const categorie = (cle?: string): "todo" | "doing" | "done" => (cle === "done" ? "done" : cle === "indeterminate" ? "doing" : "todo");

function versPlan(ticket: TicketJira): PlanTicket {
  const sansResponsable = !ticket.assigneId || /^(non assign|unassigned)/i.test(ticket.assigne ?? "");
  return {
    id: ticket.cle,
    productId: ticket.projet,
    ...(ticket.projetNom ? { productName: ticket.projetNom } : {}),
    title: ticket.titre,
    status: ticket.statut,
    done: ticket.statutCategorie === "done",
    statusCategory: categorie(ticket.statutCategorie),
    type: ticket.type,
    priority: ticket.priorite,
    dueDate: ticket.echeance,
    assignee: sansResponsable ? "Non assigné" : (ticket.assigne ?? ""),
    ...(sansResponsable ? {} : { assigneeId: ticket.assigneId ?? undefined }),
    ...(ticket.assigneLogin ? { assigneeLogin: ticket.assigneLogin } : {}),
    ...(ticket.assigneEmail ? { assigneeEmail: ticket.assigneEmail } : {}),
    ...(typeof ticket.estimationSecondes === "number" ? { estimateSeconds: ticket.estimationSecondes } : {}),
    ...(typeof ticket.restantSecondes === "number" ? { remainingSeconds: ticket.restantSecondes } : {}),
    ...(ticket.rang ? { boardRank: ticket.rang } : {}),
    ...(ticket.historique
      ? {
          workflowHistory: ticket.historique.map(
            (evenement): WorkflowEvent => ({
              at: evenement.le,
              ...(evenement.statut !== undefined ? { status: evenement.statut } : {}),
              ...(evenement.statutCategorie ? { statusCategory: categorie(evenement.statutCategorie) } : {}),
              ...(evenement.assigneId !== undefined ? { assigneeId: evenement.assigneId } : {}),
            }),
          ),
        }
      : {}),
    url: ticket.url,
    instance: ticket.instance,
  };
}

// ------------------------------------------------------------------------------------------------ Source des tickets
export type SourceJira = { compte: string; projets: string[]; workdaySeconds?: number; dureesIndisponibles: boolean };

/** Compte Jira, projets suivis et journée de travail Jira (8 h si la configuration est illisible, durées alors neutralisées). */
export async function lireSourceJira(): Promise<SourceJira> {
  const reglages = await lireReglages();
  const compte = reglages["jira.compte"] ?? "";
  const projets = projetsSuivis(reglages["jira.projets"]);
  try {
    const { heuresParJour } = await functions.call<{ heuresParJour: number }>("atlassian/lire-suivi-temps", compte ? { instance: compte } : {});
    return { compte, projets, workdaySeconds: heuresParJour * 3600, dureesIndisponibles: false };
  } catch {
    return { compte, projets, dureesIndisponibles: true };
  }
}

/** Tickets actifs (tout sauf Terminé), ou une page de 25 tickets terminés. */
export async function lireTickets(source: SourceJira, page: { mode: "actifs" } | { mode: "termines"; debut: number; limite: number }) {
  const { tickets } = await functions.call<{ tickets: TicketJira[] }>("atlassian/lister-tickets-projet", {
    ...(source.compte ? { instance: source.compte } : {}),
    ...(source.projets.length ? { projets: source.projets } : {}),
    mode: page.mode,
    ...(page.mode === "termines" ? { debut: page.debut, limite: page.limite } : { limite: 100 }),
    historique: true,
  });
  return tickets.map(
    (ticket): SourcedTicket => ({
      ticket: versPlan(ticket),
      connectionId: JIRA,
      key: ticket.cle,
      workdaySeconds: source.workdaySeconds,
      timeTrackingUnavailable: source.dureesIndisponibles,
    }),
  );
}

/** Produits du tableau : les projets Jira des tickets, dans l’ordre des projets suivis. */
export function produitsDe(sources: readonly SourcedTicket[], suivis: readonly string[]): Produit[] {
  const ids = [...new Set([...suivis, ...sources.map((source) => source.ticket.productId)])].filter(Boolean);
  const noms = new Map(sources.filter((source) => source.ticket.productName).map((source) => [source.ticket.productId, source.ticket.productName as string]));
  return ids.map((id, index) => ({ id, name: noms.get(id) ?? id, color: COULEURS[index % COULEURS.length] }));
}

// ------------------------------------------------------------------------------------------------ État du tableau
type LigneMembre = {
  equipe: string;
  identifiant: string;
  nom: string;
  email: string;
  keycloak?: string;
  debut?: string;
  fin?: string;
  jours?: string;
  absences?: string;
  comptes?: string;
};
const lireJson = <T,>(texte: string | undefined, defaut: T): T => {
  try {
    return texte ? (JSON.parse(texte) as T) : defaut;
  } catch {
    return defaut;
  }
};

/** Équipes, personnes et réglages du tableau. */
export async function chargerEtat(): Promise<ProjectManagementState> {
  const [equipes, membres, reglages] = await Promise.all([
    db.query<{ id: string; nom: string }>("SELECT id, nom FROM atom_equipes ORDER BY nom"),
    db.query<LigneMembre>("SELECT * FROM atom_equipe_membres ORDER BY nom"),
    lireReglages(),
  ]);
  return {
    version: 1,
    teams: equipes.map((equipe) => ({ id: equipe.id, name: equipe.nom })),
    members: membres.map(
      (ligne): ProjectMember => ({
        id: ligne.identifiant,
        name: ligne.nom || ligne.identifiant,
        teamId: ligne.equipe,
        from: ligne.debut || "1970-01-01",
        ...(ligne.fin ? { to: ligne.fin } : {}),
        weekdays: lireJson(ligne.jours, [1, 2, 3, 4, 5]),
        absences: lireJson(ligne.absences, []),
        accounts: lireJson(ligne.comptes, {}),
        ...(ligne.email ? { outlookEmail: ligne.email } : {}),
        ...((ligne.keycloak ?? ligne.identifiant) ? { keycloakUsername: ligne.keycloak ?? ligne.identifiant } : {}),
      }),
    ),
    tickets: [],
    ...(reglages["projet.debut"] ? { startDate: reglages["projet.debut"] } : {}),
    ...(reglages["projet.equipe"] ? { activeTeamId: reglages["projet.equipe"] } : {}),
    ...(reglages["projet.ordre"] ? { ticketOrder: lireJson<string[]>(reglages["projet.ordre"], []) } : {}),
    ...(reglages["projet.historique"] ? { planningHistory: lireJson(reglages["projet.historique"], {}) } : {}),
    ...(reglages["projet.base"] ? { planningBaseline: reglages["projet.base"] } : {}),
    ...(reglages["projet.ignores"] ? { ignoredMemberAccounts: lireJson<string[]>(reglages["projet.ignores"], []) } : {}),
  };
}

const reglage = (cle: string, valeur: string | undefined) =>
  valeur
    ? db.execute("INSERT INTO atom_reglages (cle, valeur) VALUES (?, ?) ON CONFLICT (cle) DO UPDATE SET valeur = excluded.valeur", [cle, valeur])
    : db.execute("DELETE FROM atom_reglages WHERE cle = ?", [cle]);

/** Écrit ce qui a changé entre deux états : équipes, personnes (hors « À répartir ») et réglages du tableau. */
export async function enregistrerEtat(avant: ProjectManagementState, apres: ProjectManagementState) {
  const equipes = apres.teams.filter((team) => team.id !== PROVIDER_TEAM);
  for (const team of equipes) {
    const ancienne = avant.teams.find((item) => item.id === team.id);
    if (!ancienne) await db.execute("INSERT INTO atom_equipes (id, nom) VALUES (?, ?)", [team.id, team.name]);
    else if (ancienne.name !== team.name) await db.execute("UPDATE atom_equipes SET nom = ? WHERE id = ?", [team.name, team.id]);
  }
  for (const team of avant.teams)
    if (team.id !== PROVIDER_TEAM && !equipes.some((item) => item.id === team.id)) await db.execute("DELETE FROM atom_equipes WHERE id = ?", [team.id]);
  const membres = apres.members.filter((member) => !member.id.startsWith("provider:"));
  for (const member of membres) {
    const ancien = avant.members.find((item) => item.id === member.id);
    if (ancien && JSON.stringify(ancien) === JSON.stringify(member)) continue;
    if (ancien && ancien.teamId !== member.teamId)
      await db.execute("DELETE FROM atom_equipe_membres WHERE equipe = ? AND identifiant = ?", [ancien.teamId, member.id]);
    await db.execute(
      `INSERT INTO atom_equipe_membres (equipe, identifiant, nom, email, keycloak, debut, fin, jours, absences, comptes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (equipe, identifiant) DO UPDATE SET nom = excluded.nom, email = excluded.email, keycloak = excluded.keycloak,
         debut = excluded.debut, fin = excluded.fin, jours = excluded.jours, absences = excluded.absences, comptes = excluded.comptes`,
      [
        member.teamId,
        member.id,
        member.name,
        member.outlookEmail ?? "",
        member.keycloakUsername ?? "",
        member.from,
        member.to ?? "",
        JSON.stringify(member.weekdays),
        JSON.stringify(member.absences),
        JSON.stringify(member.accounts ?? {}),
      ],
    );
  }
  for (const member of avant.members)
    if (!member.id.startsWith("provider:") && !membres.some((item) => item.id === member.id))
      await db.execute("DELETE FROM atom_equipe_membres WHERE equipe = ? AND identifiant = ?", [member.teamId, member.id]);
  const valeurs: [string, string | undefined, string | undefined][] = [
    ["projet.debut", avant.startDate, apres.startDate],
    ["projet.equipe", avant.activeTeamId, apres.activeTeamId],
    ["projet.ordre", JSON.stringify(avant.ticketOrder ?? []), JSON.stringify(apres.ticketOrder ?? [])],
    ["projet.historique", JSON.stringify(avant.planningHistory ?? {}), JSON.stringify(apres.planningHistory ?? {})],
    ["projet.base", avant.planningBaseline, apres.planningBaseline],
    ["projet.ignores", JSON.stringify(avant.ignoredMemberAccounts ?? []), JSON.stringify(apres.ignoredMemberAccounts ?? [])],
  ];
  for (const [cle, ancienne, nouvelle] of valeurs) if (ancienne !== nouvelle) await reglage(cle, nouvelle && nouvelle !== "[]" && nouvelle !== "{}" ? nouvelle : undefined);
}

// ------------------------------------------------------------------------------------------------ Écritures Jira
const instance = (source: SourcedTicket) => (source.ticket.instance ? { instance: source.ticket.instance } : {});

type Compte = { id: string; nom: string; email?: string };
/** Comptes Jira assignables d’un projet qui répondent à une recherche (identifiant, nom ou e-mail). */
export async function chercherComptes(compte: string, projet: string, recherche: string): Promise<Compte[]> {
  const { utilisateurs } = await functions.call<{ utilisateurs: Compte[] }>("atlassian/lister-assignables", {
    ...(compte ? { instance: compte } : {}),
    projet,
    recherche,
  });
  return utilisateurs;
}

/** Compte Jira de la personne : compte relié, sinon un seul assignable du ticket du même nom. */
async function compteDe(source: SourcedTicket, member: ProjectMember): Promise<string> {
  const relie = member.accounts?.[JIRA];
  if (relie) return relie;
  const trouves = (await chercherComptes(source.ticket.instance ?? "", source.ticket.productId, member.name)).filter(
    (compte) => [compte.id, compte.nom].some((nom) => projectNameKey(nom) === projectNameKey(member.name)),
  );
  if (trouves.length !== 1) throw new Error(`Associez le compte Jira de ${member.name} dans son panneau Équipes avant de lui attribuer ce ticket.`);
  return trouves[0].id;
}

/** Écrit dans Jira un changement du tableau : responsable, durées, puis colonne (transition, avec le commentaire). */
export async function ecrireTicket(
  source: SourcedTicket,
  patch: ProjectTicketPatch,
  members: ProjectMember[],
  justification?: string,
): Promise<{ account?: { memberId: string; id: string } }> {
  const commentaire = justification?.trim();
  const member = patch.assigneeId ? members.find((item) => item.id === patch.assigneeId) : undefined;
  if (patch.assigneeId && !member) throw new Error("La personne choisie n’existe plus.");
  const compte = "assigneeId" in patch && member ? await compteDe(source, member) : null;
  if (compte && members.some((other) => other.id !== member?.id && other.accounts?.[JIRA] === compte))
    throw new Error("Ce compte Jira est déjà associé à une autre personne dans les équipes.");
  const parJour = source.workdaySeconds ?? 8 * 3600;
  const secondes = (jours: number | undefined) => {
    if (jours === undefined) return null;
    if (!Number.isFinite(jours) || jours < 0 || jours > 365) throw new Error("La durée du ticket est invalide.");
    return Math.round(jours * parJour);
  };
  const temps = {
    ...("estimateDays" in patch ? { estimationSecondes: secondes(patch.estimateDays) } : {}),
    ...("remainingDays" in patch ? { restantSecondes: secondes(patch.remainingDays) } : {}),
  };
  if ("assigneeId" in patch) await functions.call("atlassian/modifier-ticket", { ...instance(source), cle: source.ticket.id, assigne: compte ?? "aucun" });
  if (Object.keys(temps).length) await functions.call("atlassian/modifier-suivi-temps", { ...instance(source), cle: source.ticket.id, ...temps });
  if (patch.stage)
    await functions.call("atlassian/passer-ticket", { ...instance(source), cle: source.ticket.id, etape: patch.stage, ...(commentaire ? { commentaire } : {}) });
  else if (commentaire) await functions.call("atlassian/commenter-ticket", { ...instance(source), cle: source.ticket.id, texte: commentaire });
  return compte && member ? { account: { memberId: member.id, id: compte } } : {};
}

/** Commentaire seul (justification d’un déplacement sans changement de champ). */
export function commenterTicket(source: SourcedTicket, texte: string) {
  return functions.call("atlassian/commenter-ticket", { ...instance(source), cle: source.ticket.id, texte: texte.trim() });
}

/** Place le ticket dans le Rank partagé : après le précédent, ou avant le suivant en tête. */
export async function classerTicket(move: ProjectRankMove) {
  const voisin = move.previous ? { apres: move.previous.ticket.id } : move.next ? { avant: move.next.ticket.id } : undefined;
  if (voisin) await functions.call("atlassian/classer-ticket", { ...instance(move.source), cle: move.source.ticket.id, ...voisin });
}

/** Stade d’un ticket, exposé pour la page (colonne du kanban). */
export const etapeDe = projectTicketStage;

// ------------------------------------------------------------------------------------------------ Annuaire et agendas
export type PersonneAnnuaire = { id: string; identifiant: string; prenom: string; nom: string; email: string };
export async function chercherAnnuaire(instanceKeycloak: string, recherche: string): Promise<PersonneAnnuaire[]> {
  const texte = recherche.trim();
  const { utilisateurs } = await functions.call<{ utilisateurs: PersonneAnnuaire[] }>(
    "keycloak/chercher-utilisateurs",
    texte.includes("@") ? { instance: instanceKeycloak, email: texte } : { instance: instanceKeycloak, recherche: texte },
  );
  return utilisateurs;
}
export const nomAnnuaire = (personne: PersonneAnnuaire) => `${personne.prenom} ${personne.nom}`.trim() || personne.identifiant;

/** Compte Jira d’une personne de l’annuaire : même identifiant, sinon même e-mail (comme `matchDirectoryAccount`). */
export function compteAnnuaire(comptes: readonly Compte[], personne: { username: string; email?: string }) {
  const meme = (gauche?: string, droite?: string) => Boolean(gauche && droite && gauche.toLowerCase() === droite.toLowerCase());
  return comptes.find((compte) => meme(compte.id, personne.username)) ?? comptes.find((compte) => meme(compte.email, personne.email));
}

/**
 * Relit les disponibilités Outlook de la personne (statut « Absent ») et renvoie ses absences à jour : celles de
 * l’agenda sont remplacées sur la période lue, les saisies manuelles restent. `undefined` sans e-mail.
 */
export async function synchroniserAbsences(member: Pick<ProjectMember, "outlookEmail" | "weekdays" | "absences">, depuis: string) {
  const email = member.outlookEmail?.trim();
  if (!email) return undefined;
  const { statuts } = await functions.call<{ statuts: string }>("outlook/lire-disponibilites", { email, debut: depuis, jours: outlookDays });
  const importees = freeBusyAbsences(statuts, depuis, member.weekdays);
  return {
    absences: replaceCalendarAbsences(member.absences, importees, depuis, addProjectDays(depuis, outlookDays - 1)),
    imported: importees.length,
  };
}

/** Crée un ticket dans un projet suivi. */
export function creerTicket(compte: string, projet: string, valeurs: { type: string; resume: string; description: string }) {
  return functions.call<{ cle?: string }>("atlassian/creer-ticket", {
    ...(compte ? { instance: compte } : {}),
    projet,
    type: valeurs.type,
    resume: valeurs.resume,
    description: valeurs.description,
  });
}

// ------------------------------------------------------------------------------------------------ Page et panneau
/** Sélection publiée au panneau de droite. */
export type SelectionProjet =
  | { kind: "ticket"; source: SourcedTicket; ticket?: ProjectTicket; productName: string; assignee?: string }
  | { kind: "member"; member: ProjectMember; teams: ProjectManagementState["teams"]; saving: boolean };
/** Message du panneau vers la page. */
export type MessageProjet =
  | { kind: "member-patch"; id: string; patch: Partial<ProjectMember> }
  | { kind: "member-remove"; id: string }
  | { kind: "member-import"; id: string }
  | { kind: "changed" };
