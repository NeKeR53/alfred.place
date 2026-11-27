// Gestion de projet d’Atom : calculs repris tels quels de la page Projets de OneApp (src/lib/projectManagement.ts,
// projectTicketState.ts, projectTimeline.ts, projectAssignment.ts, projectAbsences.ts, projectExecutionHistory.ts).
// Rien ici ne lit ni n’écrit : la page charge les tickets et l’état, ces fonctions les combinent.

export type ProjectStage = "todo" | "doing" | "suspended" | "done";
export type ProjectSlot = { date: string; portion: number; offset: number };
export type ProjectHistorySlot = ProjectSlot & { assigneeId: string };
export type ProjectTeam = { id: string; name: string };
export type ProjectAbsence = { from: string; to: string; source?: "calendar" };
export type ProjectMember = {
  id: string;
  name: string;
  teamId: string;
  from: string;
  to?: string;
  weekdays: number[];
  absences: ProjectAbsence[];
  accounts?: Record<string, string>;
  outlookEmail?: string;
  keycloakUsername?: string;
};
export type ProjectTicket = {
  key: string;
  productId: string;
  issueKey: string;
  stage: ProjectStage;
  assigneeId?: string;
  estimateDays?: number;
  remainingDays?: number;
  position: number;
};
export type ProjectManagementState = {
  version: 1;
  startDate?: string;
  teams: ProjectTeam[];
  members: ProjectMember[];
  tickets: ProjectTicket[];
  planningHistory?: Record<string, ProjectHistorySlot[]>;
  planningBaseline?: string;
  ticketOrder?: string[];
  activeTeamId?: string;
  ignoredMemberAccounts?: string[];
};
export type WorkflowEvent = {
  at: string;
  status?: string;
  statusCategory?: "todo" | "doing" | "done";
  assigneeId?: string | null;
};
/** Ticket Jira tel que le tableau le lit (champs de OneApp). */
export type PlanTicket = {
  id: string;
  productId: string;
  productName?: string;
  title: string;
  status: string;
  done: boolean;
  statusCategory: "todo" | "doing" | "done";
  type?: string;
  priority?: string;
  dueDate?: string | null;
  assignee: string;
  assigneeId?: string;
  assigneeLogin?: string;
  assigneeEmail?: string;
  estimateSeconds?: number;
  remainingSeconds?: number;
  boardRank?: string | number;
  workflowHistory?: WorkflowEvent[];
  url?: string | null;
  instance?: string | null;
};
export type SourcedTicket = {
  ticket: PlanTicket;
  connectionId: string;
  key: string;
  workdaySeconds?: number;
  timeTrackingUnavailable?: boolean;
};
export type ScheduledTicket = {
  key: string;
  productId: string;
  assigneeId?: string;
  slots: ProjectSlot[];
  historySlots: ProjectHistorySlot[];
  start?: string;
  end?: string;
  issue?: "assignee" | "estimate" | "availability";
};

export const emptyProjectManagementState = (): ProjectManagementState => ({ version: 1, teams: [], members: [], tickets: [] });

export function removeProjectMember(state: ProjectManagementState, memberId: string): ProjectManagementState {
  const member = state.members.find((item) => item.id === memberId);
  if (!member) return state;
  return {
    ...state,
    members: state.members.filter((item) => item.id !== memberId),
    ignoredMemberAccounts: [
      ...new Set([
        ...(state.ignoredMemberAccounts ?? []),
        ...Object.entries(member.accounts ?? {}).map(([connectionId, id]) => JSON.stringify([connectionId, id])),
      ]),
    ],
  };
}

export function isProjectDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addProjectDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function projectDaysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000);
}

export function projectToday(): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function memberDayStatus(member: ProjectMember, date: string): "available" | "outside-presence" | "absence" | "non-working" {
  if (date < member.from || (member.to && date > member.to)) return "outside-presence";
  if (member.absences.some((absence) => absence.from <= date && date <= absence.to)) return "absence";
  if (!member.weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay())) return "non-working";
  return "available";
}

export const memberAvailable = (member: ProjectMember, date: string) => memberDayStatus(member, date) === "available";

/** Le travail commencé d’abord, puis l’ordre des colonnes ; une personne a un jour de capacité par jour disponible. */
export function scheduleProjectTickets(state: ProjectManagementState, start: string): ScheduledTicket[] {
  const used = new Map<string, Map<string, number>>();
  const ordered = [...state.tickets]
    .filter((ticket) => ticket.stage === "todo" || ticket.stage === "doing" || !!state.planningHistory?.[ticket.key]?.length)
    .sort((a, b) => (a.stage === b.stage ? a.position - b.position : a.stage === "doing" ? -1 : 1));
  return ordered.map((ticket) => {
    const result: ScheduledTicket = {
      key: ticket.key,
      productId: ticket.productId,
      assigneeId: ticket.assigneeId,
      slots: [],
      historySlots: state.planningHistory?.[ticket.key] ?? [],
    };
    if (ticket.stage === "suspended" || ticket.stage === "done") return result;
    const member = state.members.find((candidate) => candidate.id === ticket.assigneeId);
    const effort = ticket.stage === "doing" ? (ticket.remainingDays ?? ticket.estimateDays) : ticket.estimateDays;
    if (!member) return { ...result, issue: "assignee" };
    if (effort === undefined || !Number.isFinite(effort) || effort < 0) return { ...result, issue: "estimate" };
    if (effort === 0) return result;
    const days = used.get(member.id) ?? new Map<string, number>();
    used.set(member.id, days);
    let remaining = effort;
    let date = state.planningBaseline && state.planningBaseline > start ? state.planningBaseline : start;
    for (let count = 0; count < 730 && remaining > 0 && (!member.to || date <= member.to); count++) {
      if (memberAvailable(member, date)) {
        const free = Math.max(0, 1 - (days.get(date) ?? 0));
        const portion = Math.min(free, remaining);
        if (portion > 0) {
          result.slots.push({ date, portion, offset: days.get(date) ?? 0 });
          days.set(date, (days.get(date) ?? 0) + portion);
          remaining = Math.round((remaining - portion) * 1000) / 1000;
        }
      }
      date = addProjectDays(date, 1);
    }
    if (remaining > 0) return { ...result, issue: "availability" };
    return { ...result, start: result.slots[0]?.date, end: result.slots.at(-1)?.date };
  });
}

export function moveProjectTicket(state: ProjectManagementState, key: string, stage: ProjectStage, beforeKey?: string): ProjectManagementState {
  const ticket = state.tickets.find((item) => item.key === key);
  if (!ticket) return state;
  const next = state.tickets.filter((item) => item.key !== key).map((item) => ({ ...item }));
  if (key === beforeKey) return state;
  const moved = {
    ...ticket,
    stage,
    ...(stage === "doing" && ticket.stage !== "doing" ? { remainingDays: ticket.remainingDays ?? ticket.estimateDays } : {}),
  };
  const siblings = next.filter((item) => item.stage === stage).sort((a, b) => a.position - b.position);
  const index = beforeKey ? siblings.findIndex((item) => item.key === beforeKey) : -1;
  siblings.splice(index < 0 ? siblings.length : index, 0, moved);
  siblings.forEach((item, position) => {
    item.position = position;
  });
  return { ...state, tickets: [...next, moved] };
}

// ------------------------------------------------------------------------------------------------ Tickets → tableau
export const projectNameKey = (value: string) => value.trim().normalize("NFKC").toLocaleLowerCase("fr").replace(/\s+/g, " ");

function normalized(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase().trim();
}
/** Parcours métier de OneApp d’après le nom d’un statut. */
export function workflowStatusFromName(status: string, done = false) {
  const value = normalized(status);
  if (/suspend/.test(value)) return "Suspendu";
  if (/resol|solve|verif|livr|deliver|recette|ready.*test|test.*ready/.test(value)) return "Résolu";
  if (done || /clot|clos|closed|done|termine|complete|ferme/.test(value)) return "Clôturé";
  if (/en cours|in progress|in-progress|start(?:ed)?(?: work)?|realisation|doing/.test(value)) return "En cours";
  return "À faire";
}

/** Colonne du kanban : statut OneApp (Suspendu, En cours, Résolu, Clôturé), sinon la catégorie du fournisseur. */
export function projectTicketStage(ticket: Pick<PlanTicket, "status" | "done" | "statusCategory">): ProjectStage {
  const status = workflowStatusFromName(ticket.status, ticket.done);
  if (status === "Suspendu") return "suspended";
  if (status === "En cours") return "doing";
  if (status === "Résolu" || status === "Clôturé") return "done";
  return ticket.statusCategory ?? "todo";
}

/**
 * Personne des équipes qui porte le ticket : compte relié, identifiant Keycloak égal à l’identifiant Jira, e-mail,
 * puis nom affiché pour une personne sans compte relié. Une correspondance ambiguë ne relie personne.
 */
export function memberForTicket(members: ProjectMember[], source: SourcedTicket): ProjectMember | undefined {
  const { ticket, connectionId } = source;
  if (!ticket.assigneeId) return undefined;
  const same = (left?: string, right?: string) => Boolean(left && right && projectNameKey(left) === projectNameKey(right));
  const single = (candidates: ProjectMember[]) => (candidates.length === 1 ? candidates[0] : undefined);
  const linked = members.filter((member) => same(member.accounts?.[connectionId], ticket.assigneeId));
  if (linked.length) return single(linked);
  const byLogin = members.filter((member) => same(member.keycloakUsername, ticket.assigneeLogin));
  if (byLogin.length) return single(byLogin);
  const byEmail = members.filter((member) => same(member.outlookEmail, ticket.assigneeEmail));
  if (byEmail.length) return single(byEmail);
  return single(
    members.filter((member) => !member.accounts?.[connectionId] && [ticket.assignee, ticket.assigneeLogin].some((name) => same(name, member.name))),
  );
}

const unlinkedAssignee = (ticket: Pick<ProjectTicket, "assigneeId">) => ticket.assigneeId?.startsWith("provider:");

/** Raison pour laquelle un ticket « À faire » reste dans les disponibles ; `undefined` s’il peut entrer au tableau. */
export function projectAvailableReason(ticket: Pick<ProjectTicket, "assigneeId" | "estimateDays" | "remainingDays">, source: SourcedTicket): string | undefined {
  if (!ticket.assigneeId || unlinkedAssignee(ticket))
    return source.ticket.assigneeId ? `Responsable « ${source.ticket.assignee} » non relié à une personne des équipes` : "Sans responsable";
  const estimated = (ticket.estimateDays ?? 0) > 0 || (ticket.remainingDays ?? 0) > 0;
  if (!source.timeTrackingUnavailable && !estimated) return "Sans durée (suivi du temps vide)";
  return undefined;
}

/** Règle partagée : un ticket « À faire » n’entre au tableau qu’avec un responsable relié et une durée. */
export function onProjectBoard(ticket: ProjectTicket, source: SourcedTicket) {
  if (unlinkedAssignee(ticket)) return false;
  return ticket.stage !== "todo" || !projectAvailableReason(ticket, source);
}

const compareBoardRanks = (left: string | number, right: string | number) =>
  typeof left === "number" && typeof right === "number" ? left - right : String(left) < String(right) ? -1 : 1;

/** L’ordre de chaque personne vient du Rank partagé : les tickets reprennent les places qu’ils occupaient. */
function applyBoardRanks(tickets: ProjectTicket[], sources: readonly SourcedTicket[]) {
  const sourceByKey = new Map(sources.map((source) => [source.key, source]));
  const groups = new Map<string, ProjectTicket[]>();
  for (const ticket of tickets) {
    const source = sourceByKey.get(ticket.key);
    if (!ticket.assigneeId || source?.ticket.boardRank === undefined) continue;
    const group = JSON.stringify([ticket.stage, ticket.assigneeId, source.connectionId]);
    groups.set(group, [...(groups.get(group) ?? []), ticket]);
  }
  for (const group of groups.values()) {
    const places = group.map(({ position }) => position).sort((left, right) => left - right);
    group
      .sort((left, right) => compareBoardRanks(sourceByKey.get(left.key)?.ticket.boardRank ?? 0, sourceByKey.get(right.key)?.ticket.boardRank ?? 0))
      .forEach((ticket, index) => {
        ticket.position = places[index];
      });
  }
}

/** Reconstitue le tableau depuis les champs distants ; les anciennes valeurs locales ne sont jamais utilisées. */
export function projectStateFromTickets(config: ProjectManagementState, sources: SourcedTicket[], options: { all?: boolean } = {}): ProjectManagementState {
  const members = config.members.map((member) => ({ ...member, accounts: { ...member.accounts } }));
  const teams = [...config.teams];
  for (const source of sources) {
    if (!source.ticket.assigneeId) continue;
    if (members.filter((member) => member.accounts[source.connectionId] === source.ticket.assigneeId).length > 1) continue;
    const existing = memberForTicket(members, source);
    if (existing) {
      existing.accounts = { ...existing.accounts, [source.connectionId]: source.ticket.assigneeId };
      continue;
    }
    if (config.ignoredMemberAccounts?.includes(JSON.stringify([source.connectionId, source.ticket.assigneeId]))) continue;
    const teamId = "project-provider-members";
    if (!teams.some((team) => team.id === teamId)) teams.push({ id: teamId, name: "À répartir" });
    members.push({
      id: `provider:${JSON.stringify([source.connectionId, source.ticket.assigneeId])}`,
      name: source.ticket.assignee,
      teamId,
      from: "1970-01-01",
      weekdays: [1, 2, 3, 4, 5],
      absences: [],
      accounts: { [source.connectionId]: source.ticket.assigneeId },
    });
  }
  const order = config.ticketOrder ?? [];
  const rank = new Map(order.map((key, index) => [key, index]));
  const tickets = sources
    .map((source, index): ProjectTicket => {
      const secondsPerDay = source.workdaySeconds ?? 8 * 3600;
      return {
        key: source.key,
        productId: source.ticket.productId,
        issueKey: source.ticket.id,
        stage: projectTicketStage(source.ticket),
        assigneeId: memberForTicket(members, source)?.id,
        estimateDays: source.timeTrackingUnavailable || source.ticket.estimateSeconds === undefined ? undefined : source.ticket.estimateSeconds / secondsPerDay,
        remainingDays: source.timeTrackingUnavailable || source.ticket.remainingSeconds === undefined ? undefined : source.ticket.remainingSeconds / secondsPerDay,
        position: rank.get(source.key) ?? order.length + index,
      };
    })
    .filter((ticket, index) => options.all || onProjectBoard(ticket, sources[index]));
  applyBoardRanks(tickets, sources);
  const executed = projectExecutionHistory(sources, members, projectToday());
  const planningHistory = Object.keys(executed).length ? { ...config.planningHistory, ...executed } : config.planningHistory;
  return { ...config, teams, members, tickets, ...(planningHistory ? { planningHistory } : {}) };
}

export type ProjectTicketPatch = Partial<Pick<ProjectTicket, "stage" | "assigneeId" | "estimateDays" | "remainingDays">>;
export function projectTicketPatch(before: ProjectTicket, after: ProjectTicket): ProjectTicketPatch {
  const patch: ProjectTicketPatch = {};
  if (before.stage !== after.stage) patch.stage = after.stage;
  if (before.assigneeId !== after.assigneeId) patch.assigneeId = after.assigneeId;
  if (before.estimateDays !== after.estimateDays) patch.estimateDays = after.estimateDays;
  // Entrer dans une colonne change le workflow, pas l’estimation.
  if (before.remainingDays !== after.remainingDays && (before.stage === after.stage || before.estimateDays !== after.estimateDays))
    patch.remainingDays = after.remainingDays;
  return patch;
}

export type ProjectRankMove = { source: SourcedTicket; previous?: SourcedTicket; next?: SourcedTicket };
/** Déplacements à écrire dans le Rank pour que l’ordre de chaque personne, par colonne, devienne celui du tableau. */
export function projectRankMoves(state: Pick<ProjectManagementState, "tickets">, sources: readonly SourcedTicket[]): ProjectRankMove[] {
  const sourceByKey = new Map(sources.map((source) => [source.key, source]));
  const groups = new Map<string, { ticket: ProjectTicket; source: SourcedTicket }[]>();
  for (const ticket of state.tickets) {
    const source = sourceByKey.get(ticket.key);
    if (!ticket.assigneeId || (ticket.stage !== "todo" && ticket.stage !== "doing")) continue;
    if (!source || source.ticket.boardRank === undefined) continue;
    const group = JSON.stringify([ticket.stage, ticket.assigneeId, source.connectionId]);
    groups.set(group, [...(groups.get(group) ?? []), { ticket, source }]);
  }
  const moves: ProjectRankMove[] = [];
  for (const group of groups.values()) {
    const wanted = group.slice().sort((left, right) => left.ticket.position - right.ticket.position).map(({ source }) => source);
    const current = wanted.slice().sort((left, right) => compareBoardRanks(left.ticket.boardRank ?? 0, right.ticket.boardRank ?? 0));
    wanted.forEach((source, index) => {
      if (current[index] === source) return;
      current.splice(current.indexOf(source), 1);
      current.splice(index, 0, source);
      moves.push(index ? { source, previous: wanted[index - 1] } : { source, next: current[1] });
    });
  }
  return moves;
}

// ------------------------------------------------------------------------------------------------ Passé du planning
type Period = { key: string; memberId: string; from: string; to: string };
function inProgressPeriods(source: SourcedTicket, members: readonly ProjectMember[], today: string): Period[] {
  const history = source.ticket.workflowHistory ?? [];
  const member = (accountId: string | null | undefined) =>
    accountId ? members.find((candidate) => candidate.accounts?.[source.connectionId] === accountId) : undefined;
  const periods: Period[] = [];
  let status: { status: string; statusCategory?: "todo" | "doing" | "done" } | undefined;
  let assignee: string | null | undefined;
  let open: { memberId: string; from: string } | undefined;
  const close = (date: string) => {
    if (open) periods.push({ key: source.key, ...open, to: date > open.from ? date : addProjectDays(open.from, 1) });
    open = undefined;
  };
  for (const event of history) {
    const date = event.at.slice(0, 10);
    if (event.status !== undefined) status = { status: event.status, statusCategory: event.statusCategory };
    if (event.assigneeId !== undefined) assignee = event.assigneeId;
    const doing =
      status && projectTicketStage({ status: status.status, done: status.statusCategory === "done", statusCategory: status.statusCategory ?? "todo" }) === "doing";
    const memberId = doing ? member(assignee)?.id : undefined;
    if (open && open.memberId !== memberId) close(date);
    if (memberId && !open) open = { memberId, from: date };
  }
  if (open) close(today);
  return periods.filter(({ from }) => from < today);
}

/** Passé réel du planning : les jours travaillés de chaque période « en cours », avant aujourd’hui. */
export function projectExecutionHistory(sources: readonly SourcedTicket[], members: readonly ProjectMember[], today: string): Record<string, ProjectHistorySlot[]> {
  const byDay = new Map<string, string[]>();
  const tracked = sources.filter((source) => source.ticket.workflowHistory);
  for (const source of tracked)
    for (const period of inProgressPeriods(source, members, today)) {
      const person = members.find(({ id }) => id === period.memberId);
      if (!person) continue;
      for (let date = period.from; date < period.to && date < today; date = addProjectDays(date, 1)) {
        if (!memberAvailable(person, date)) continue;
        const day = JSON.stringify([person.id, date]);
        const keys = byDay.get(day) ?? [];
        if (!keys.includes(period.key)) byDay.set(day, [...keys, period.key]);
      }
    }
  const history: Record<string, ProjectHistorySlot[]> = Object.fromEntries(tracked.map(({ key }) => [key, []]));
  for (const [day, keys] of byDay) {
    const [assigneeId, date] = JSON.parse(day) as [string, string];
    keys.forEach((key, index) => {
      history[key].push({ date, portion: 1 / keys.length, offset: index / keys.length, assigneeId });
    });
  }
  for (const slots of Object.values(history)) slots.sort((left, right) => left.date.localeCompare(right.date));
  return history;
}

// ------------------------------------------------------------------------------------------------ Planning
/** Déplace la priorité dans la file d’une personne, sans changer son affectation ni son état. */
export function reorderScheduledTicket(state: ProjectManagementState, key: string, shiftDays: number, start: string, today = projectToday()): ProjectManagementState {
  const ticket = state.tickets.find((item) => item.key === key);
  if (!ticket?.assigneeId || ticket.stage === "done" || !Number.isFinite(shiftDays) || shiftDays === 0) return state;
  const schedule = scheduleProjectTickets(state, start);
  const first = schedule.find((entry) => entry.key === key)?.slots[0];
  if (!first) return state;
  const siblings = state.tickets.filter((item) => item.assigneeId === ticket.assigneeId && item.stage === ticket.stage).sort((a, b) => a.position - b.position);
  const remaining = siblings.filter((item) => item.key !== key);
  const target = projectDaysBetween(start, first.date) + first.offset + shiftDays;
  const before = remaining.find((item) => {
    const entry = schedule.find((candidate) => candidate.key === item.key);
    const head = entry?.slots[0];
    const tail = entry?.slots.at(-1);
    if (!head || !tail) return true;
    const middle = (projectDaysBetween(start, head.date) + head.offset + projectDaysBetween(start, tail.date) + tail.offset + tail.portion) / 2;
    return target < middle;
  });
  const index = before ? remaining.indexOf(before) : remaining.length;
  if (index === siblings.findIndex((item) => item.key === key)) return state;
  const reordered = moveProjectTicket(state, key, ticket.stage, before?.key);
  if (ticket.stage !== "doing") return reordered;
  const assigneeId = ticket.assigneeId;
  const elapsed = schedule.find((entry) => entry.key === key)?.slots.filter((slot) => slot.date < today).map((slot) => ({ ...slot, assigneeId })) ?? [];
  if (!elapsed.length) return reordered;
  return { ...reordered, planningBaseline: today, planningHistory: { ...state.planningHistory, [key]: [...(state.planningHistory?.[key] ?? []), ...elapsed] } };
}

export const projectZoomLevels: readonly number[] = [7, 14, 28, 92, 365];
export function projectVisibleDays(zoom: number, start: string): number {
  if (zoom === 7 || zoom === 14 || zoom === 15 || zoom === 28) return zoom;
  const months = ({ 31: 1, 92: 3, 183: 6, 365: 12 } as Record<number, number>)[zoom];
  if (!months) return 15;
  const date = new Date(`${start}T12:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return projectDaysBetween(start, date.toISOString().slice(0, 10));
}

/** Segments continus du calendrier, parts de jour conservées. */
export function projectTimelineSegments(slots: ScheduledTicket["slots"], start: string, days: number) {
  const end = addProjectDays(start, days - 1);
  const segments: { first: ProjectSlot; last: ProjectSlot }[] = [];
  for (const slot of slots) {
    if (slot.date < start || slot.date > end) continue;
    const previous = segments.at(-1);
    if (previous && addProjectDays(previous.last.date, 1) === slot.date && previous.last.offset + previous.last.portion === 1 && slot.offset === 0) previous.last = slot;
    else segments.push({ first: slot, last: slot });
  }
  return segments.map(({ first, last }) => ({
    date: first.date,
    column: projectDaysBetween(start, first.date),
    span: projectDaysBetween(first.date, last.date) + 1,
    offset: first.offset,
    duration: projectDaysBetween(first.date, last.date) + last.offset + last.portion - first.offset,
  }));
}

// ------------------------------------------------------------------------------------------------ Attribution
const open = (ticket: ProjectTicket) => ticket.stage === "todo" || ticket.stage === "doing";
const effortOf = (ticket: ProjectTicket) => ticket.remainingDays ?? ticket.estimateDays ?? 1;

/** Attribue un ticket à une personne ; il passe en fin de file de cette personne. */
export function assignProjectTicket(state: ProjectManagementState, key: string, memberId: string): ProjectManagementState {
  const current = state.tickets.find((ticket) => ticket.key === key);
  if (!current || !state.members.some(({ id }) => id === memberId) || current.assigneeId === memberId) return state;
  const position = Math.max(-1, ...state.tickets.filter((ticket) => ticket.assigneeId === memberId && ticket.stage === current.stage).map((ticket) => ticket.position)) + 1;
  return { ...state, tickets: state.tickets.map((ticket) => (ticket.key === key ? { ...ticket, assigneeId: memberId, position } : ticket)) };
}

/** Répartit les tickets ouverts sans personne, par priorité, vers la personne la moins chargée par jour travaillé. */
export function autoAssignProjectTickets(state: ProjectManagementState): ProjectManagementState {
  const members = state.members.filter(({ weekdays }) => weekdays.length);
  const pending = state.tickets.filter((ticket) => open(ticket) && !ticket.assigneeId);
  if (!members.length || !pending.length) return state;
  const load = new Map(
    members.map((member) => [member.id, state.tickets.filter((ticket) => open(ticket) && ticket.assigneeId === member.id).reduce((total, ticket) => total + effortOf(ticket), 0)]),
  );
  let next = state;
  for (const ticket of [...pending].sort((left, right) => left.position - right.position)) {
    const target = members.reduce((best, member) =>
      (load.get(member.id) ?? 0) / member.weekdays.length < (load.get(best.id) ?? 0) / best.weekdays.length ? member : best,
    );
    load.set(target.id, (load.get(target.id) ?? 0) + effortOf(ticket));
    next = assignProjectTicket(next, ticket.key, target.id);
  }
  return next;
}

// ------------------------------------------------------------------------------------------------ Absences
/** Bascule un jour : il devient une absence d’un jour, ou il est retiré de la période qui le contient. */
export function toggleProjectAbsenceDay(absences: readonly ProjectAbsence[], date: string): ProjectAbsence[] {
  const covering = absences.find(({ from, to }) => from <= date && date <= to);
  if (!covering) {
    const before = absences.find(({ to, source }) => !source && to === addProjectDays(date, -1));
    const after = absences.find(({ from, source }) => !source && from === addProjectDays(date, 1));
    return [...absences.filter((absence) => absence !== before && absence !== after), { from: before?.from ?? date, to: after?.to ?? date }];
  }
  const rest = absences.filter((absence) => absence !== covering);
  const before = date > covering.from ? [{ ...covering, to: addProjectDays(date, -1) }] : [];
  const after = date < covering.to ? [{ ...covering, from: addProjectDays(date, 1) }] : [];
  return [...rest, ...before, ...after];
}

export function mergeProjectAbsences(...lists: readonly (readonly ProjectAbsence[])[]): ProjectAbsence[] {
  const sorted = lists.flat().sort((left, right) => left.from.localeCompare(right.from));
  const merged: ProjectAbsence[] = [];
  const lastBySource = new Map<string, ProjectAbsence>();
  for (const absence of sorted) {
    const last = lastBySource.get(absence.source ?? "");
    if (last && absence.from <= addProjectDays(last.to, 1)) {
      if (absence.to > last.to) last.to = absence.to;
    } else {
      const copy = { ...absence };
      merged.push(copy);
      lastBySource.set(absence.source ?? "", copy);
    }
  }
  return merged;
}

/** Remplace les absences d’agenda de la période lue par celles importées ; les saisies manuelles restent. */
export function replaceCalendarAbsences(current: readonly ProjectAbsence[], imported: readonly ProjectAbsence[], since: string, until?: string): ProjectAbsence[] {
  const kept = current.flatMap((absence): ProjectAbsence[] => {
    if (absence.source !== "calendar") return [absence];
    const parts: ProjectAbsence[] = [];
    if (absence.from < since) {
      const end = addProjectDays(since, -1);
      parts.push({ ...absence, to: absence.to < end ? absence.to : end });
    }
    if (until && absence.to > until) {
      const start = addProjectDays(until, 1);
      parts.push({ ...absence, from: absence.from > start ? absence.from : start });
    }
    return parts;
  });
  return mergeProjectAbsences(kept, imported.map((absence) => ({ ...absence, source: "calendar" as const })));
}

/** Période lue dans Outlook pour les absences à venir. */
export const outlookDays = 120;
const workSlots = { from: 18, to: 34 };
const slotsPerDay = 48;
/** Jours « Absent » sur plus de la moitié des heures de travail (9 h – 17 h) ; un jour non travaillé ne coupe pas une période. */
export function freeBusyAbsences(statuses: string, start: string, weekdays: readonly number[]): ProjectAbsence[] {
  const absences: ProjectAbsence[] = [];
  const days = Math.floor(statuses.length / slotsPerDay);
  for (let day = 0; day < days; day++) {
    const date = addProjectDays(start, day);
    if (!weekdays.includes(new Date(`${date}T12:00:00Z`).getUTCDay())) continue;
    const slots = statuses.slice(day * slotsPerDay + workSlots.from, day * slotsPerDay + workSlots.to);
    const known = [...slots].filter((status) => status !== "5");
    const away = known.filter((status) => status === "3").length;
    if (away * 2 <= known.length) continue;
    const previous = absences.at(-1);
    const bridged =
      previous &&
      Array.from({ length: projectDaysBetween(previous.to, date) - 1 }, (_, index) => addProjectDays(previous.to, index + 1)).every(
        (between) => !weekdays.includes(new Date(`${between}T12:00:00Z`).getUTCDay()),
      );
    if (previous && bridged) previous.to = date;
    else absences.push({ from: date, to: date });
  }
  return absences;
}
