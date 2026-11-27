// Projet d’Atom : la page Projets de OneApp (ProjectsPage, ProjectKanban, ProjectPlanning, ProjectTeams), fonction par
// fonction. Kanban, Planning et Équipes ; la fiche d’un ticket et celle d’une personne s’ouvrent dans le panneau.
import { Notice, Row, Stack, Text } from "@alfred/kit";
import { matchesSearch, searchTerms, shell, usePageState, usePeerMessage } from "@alfred/sdk";
import { CalendarSync, Inbox, Plus, RefreshCw } from "lucide-react";
import {
  type Action,
  Avatar,
  Button,
  ComboBox,
  type ComboBoxItem,
  Modal,
  EmptyState,
  Link,
  Page,
  Tabs,
  SearchInput,
  Select,
  Table,
  type TableColumn,
  TextArea,
  useOpenForm,
} from "socle-ui";
import { SideNav, SideNavHeader } from "../lib/vues/equipes";
import { LoadMeter, Timeline, TimelineBacklog, type TimelineBar, type TimelineDrag, type TimelineItem } from "../lib/vues/planning";
import { Board, type BoardCard, type BoardColumn, BoardEffortChip, BoardPersonChip, boardIcons } from "../lib/vues/tableau";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { environnementsAvec } from "../lib/environnements";
import {
  addProjectDays,
  assignProjectTicket,
  autoAssignProjectTickets,
  emptyProjectManagementState,
  memberDayStatus,
  memberForTicket,
  moveProjectTicket,
  type ProjectManagementState,
  type ProjectMember,
  type ProjectStage,
  type ProjectTicket,
  projectAvailableReason,
  projectDaysBetween,
  projectRankMoves,
  projectStateFromTickets,
  projectTicketPatch,
  projectTicketStage,
  projectTimelineSegments,
  projectToday,
  projectVisibleDays,
  projectZoomLevels,
  reorderScheduledTicket,
  type ScheduledTicket,
  scheduleProjectTickets,
  type SourcedTicket,
} from "../lib/planning";
import {
  chargerEtat,
  chercherAnnuaire,
  chercherComptes,
  classerTicket,
  commenterTicket,
  compteAnnuaire,
  creerTicket,
  ecrireTicket,
  enregistrerEtat,
  JIRA,
  lireSourceJira,
  lireTickets,
  nomAnnuaire,
  type PersonneAnnuaire,
  type MessageProjet,
  type Produit,
  type SelectionProjet,
  produitsDe,
  type SourceJira,
  synchroniserAbsences,
} from "../lib/projet";
import { useResumeAtom } from "../lib/source";

type Vue = "kanban" | "planning" | "equipes";
const COLUMNS = [
  { id: "todo", label: "À faire", Icon: boardIcons.todo },
  { id: "doing", label: "En cours", Icon: boardIcons.doing },
  { id: "suspended", label: "Suspendu", Icon: boardIcons.suspended },
  { id: "done", label: "Terminé", Icon: boardIcons.done },
] as const;
const PAGE_TERMINES = 25;
const dayFormatter = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" });
const formatDate = (value: string) => dayFormatter.format(new Date(`${value}T12:00:00Z`));
const zoomLabel = (value: number) => ({ 7: "1 sem.", 14: "2 sem.", 28: "4 sem.", 92: "3 mois", 365: "12 mois" })[value] ?? "2 sem.";
const backlogType = "application/x-atom-ticket";
const jours = (value: number) => String(Math.round(value * 10) / 10).replace(".", ",");
function daysLabel(items: readonly { estimateDays?: number; remainingDays?: number }[]) {
  const days = items.reduce((sum, item) => sum + (item.remainingDays ?? item.estimateDays ?? 0), 0);
  return days ? ` · ${jours(days)} j` : "";
}


export default function ProjetPage() {
  const [vue, setVue] = usePageState<Vue>("vue", "kanban");
  const [pool, setPool] = usePageState<boolean>("pool", true);
  const [search, setSearch] = useState("");
  const [state, setState] = useState<ProjectManagementState>(emptyProjectManagementState);
  const [tickets, setTickets] = useState<SourcedTicket[]>([]);
  const [source, setSource] = useState<SourceJira>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [completedLoaded, setCompletedLoaded] = useState(false);
  const [completedLoading, setCompletedLoading] = useState(false);
  const [completedHasMore, setCompletedHasMore] = useState(true);
  const savingRef = useRef(false);
  const pendingMembers = useRef(new Map<string, Partial<ProjectMember>>());
  const completedPage = useRef(0);
  const activeKeys = useRef(new Set<string>());
  const request = useRef(0);
  const currentState = useRef(state);
  const currentTickets = useRef(tickets);
  currentState.current = state;
  currentTickets.current = tickets;
  const selection = useRef<SelectionProjet | undefined>(undefined);
  // « Mettre à jour les absences » appartient à la vue Équipes, mais s’affiche avec les autres actions de la page.
  const absencesRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const [absences, setAbsences] = useState<EtatAbsences>({ visible: false, pending: false });

  const ouverts = state.tickets.filter((ticket) => ticket.stage !== "done").length;
  useResumeAtom(loading ? "" : `${ouverts} ticket${ouverts > 1 ? "s" : ""} au tableau`);

  const refreshTickets = useCallback(async () => {
    if (savingRef.current) return;
    const sequence = ++request.current;
    setTicketsLoading(true);
    try {
      const config = await lireSourceJira();
      if (sequence !== request.current) return;
      setSource(config);
      if (config.dureesIndisponibles)
        void shell.notify({
          tone: "error",
          title: "Durées Jira indisponibles",
          description: "Les tickets sont chargés, mais la configuration du suivi du temps Jira est inaccessible. Vérifiez-la puis rechargez avec F5.",
        });
      const loaded = await lireTickets(config, { mode: "actifs" });
      if (sequence !== request.current) return;
      activeKeys.current = new Set(loaded.map((item) => item.key));
      currentTickets.current = loaded;
      setTickets(loaded);
      setState((config) => projectStateFromTickets(config, loaded));
      completedPage.current = 0;
      setCompletedLoaded(false);
      setCompletedHasMore(true);
      setError("");
    } catch (cause) {
      if (sequence === request.current) setError(cause instanceof Error ? cause.message : "F5 pour réessayer.");
    } finally {
      if (sequence === request.current) setTicketsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void chargerEtat()
      .then((value) => {
        if (!active) return;
        currentState.current = value;
        setState(value);
        setLoading(false);
        void refreshTickets();
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : "Chargement impossible.");
        setLoading(false);
      });
    return () => {
      active = false;
      request.current++;
    };
  }, [refreshTickets]);

  useEffect(() => {
    const refresh = (event: KeyboardEvent) => {
      if (event.key === "F5") {
        event.preventDefault();
        void refreshTickets();
      }
    };
    window.addEventListener("keydown", refresh);
    return () => window.removeEventListener("keydown", refresh);
  }, [refreshTickets]);

  const loadCompleted = async () => {
    if (!source || savingRef.current || completedLoading || ticketsLoading || !completedHasMore) return;
    setCompletedLoading(true);
    const sequence = request.current;
    try {
      const page = await lireTickets(source, { mode: "termines", debut: completedPage.current * PAGE_TERMINES, limite: PAGE_TERMINES });
      if (sequence !== request.current) return;
      const merged = new Map(currentTickets.current.map((item) => [item.key, item]));
      for (const item of page) merged.set(item.key, item);
      const loaded = [...merged.values()];
      currentTickets.current = loaded;
      setTickets(loaded);
      const nextState = projectStateFromTickets(currentState.current, loaded);
      currentState.current = nextState;
      setState(nextState);
      completedPage.current += 1;
      setCompletedLoaded(true);
      setCompletedHasMore(page.length >= PAGE_TERMINES);
    } catch (cause) {
      void shell.notify({ tone: "error", title: "Tickets terminés indisponibles", description: cause instanceof Error ? cause.message : "Réessayez le chargement." });
    } finally {
      if (sequence === request.current) setCompletedLoading(false);
    }
  };
  const clearCompleted = () => {
    if (savingRef.current || completedLoading || ticketsLoading) return;
    const active = currentTickets.current.filter((item) => activeKeys.current.has(item.key) || projectTicketStage(item.ticket) !== "done");
    currentTickets.current = active;
    setTickets(active);
    const nextState = projectStateFromTickets(currentState.current, active);
    currentState.current = nextState;
    setState(nextState);
    completedPage.current = 0;
    setCompletedLoaded(false);
    setCompletedHasMore(true);
  };

  /**
   * Applique un nouvel état : il s’affiche aussitôt, puis les champs changés sont écrits dans Jira, l’ordre dans le
   * Rank, le reste dans la base du module. Un refus relit les tickets et revient à l’état confirmé.
   */
  const change = (next: ProjectManagementState, justification?: { key: string; body: string }, options: { throwOnError?: boolean } = {}): Promise<boolean> => {
    if (savingRef.current) return Promise.resolve(false);
    const previous = currentState.current;
    const sources = currentTickets.current;
    const baseline = projectStateFromTickets(previous, sources, { all: true });
    const config: ProjectManagementState = {
      ...next,
      ticketOrder: next.tickets
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((ticket) => ticket.key),
    };
    const edits = config.tickets.flatMap((ticket) => {
      const before = baseline.tickets.find((item) => item.key === ticket.key);
      const item = sources.find((candidate) => candidate.key === ticket.key);
      if (!before || !item) return [];
      const patch = projectTicketPatch(before, ticket);
      return Object.keys(patch).length ? [{ source: item, patch }] : [];
    });
    if (edits.length || justification) ++request.current;
    savingRef.current = true;
    setSaving(true);
    currentState.current = config;
    setState(config);
    return (async () => {
      try {
        const justified = justification ? sources.find((item) => item.key === justification.key) : undefined;
        if (justification && !justified) throw new Error("Le ticket à justifier est indisponible.");
        for (const edit of edits) {
          const result = await ecrireTicket(edit.source, edit.patch, config.members, edit.source.key === justification?.key ? justification.body : undefined);
          if (result.account)
            config.members = config.members.map((member) =>
              member.id === result.account?.memberId ? { ...member, accounts: { ...member.accounts, [JIRA]: result.account.id } } : member,
            );
        }
        if (justification?.body && justified && !edits.some((edit) => edit.source.key === justified.key)) await commenterTicket(justified, justification.body);
        let loaded = edits.length && source ? await lireTickets(source, { mode: "actifs" }).then((fresh) => mergeFresh(sources, fresh)) : sources;
        const moves = projectRankMoves(config, loaded);
        if (moves.length) {
          try {
            for (const move of moves) await classerTicket(move);
            const positions = new Map(config.tickets.map((ticket) => [ticket.key, ticket.position]));
            loaded = loaded.map((item) =>
              item.ticket.boardRank !== undefined && positions.has(item.key)
                ? { ...item, ticket: { ...item.ticket, boardRank: positions.get(item.key) } }
                : item,
            );
          } catch (cause) {
            void shell.notify({ tone: "warning", title: "Ordre non partagé", description: `L’ordre n’a pas pu être enregistré dans le ticket : ${cause instanceof Error ? cause.message : String(cause)}` });
          }
        }
        const confirmed = projectStateFromTickets(config, loaded);
        await enregistrerEtat(previous, confirmed);
        currentTickets.current = loaded;
        setTickets(loaded);
        currentState.current = confirmed;
        setState(confirmed);
        return true;
      } catch (cause) {
        // Jira a pu accepter une partie des champs : relire sa vérité plutôt que simuler un retour en arrière.
        let loaded = sources;
        if (edits.length && source)
          try {
            loaded = mergeFresh(sources, await lireTickets(source, { mode: "actifs" }));
          } catch {
            /* La notification ci-dessous signale que la confirmation est incomplète. */
          }
        const recovered = projectStateFromTickets(previous, loaded);
        currentTickets.current = loaded;
        setTickets(loaded);
        currentState.current = recovered;
        setState(recovered);
        const message = cause instanceof Error ? cause.message : "Jira n’a pas confirmé la modification. Rechargez les tickets avec F5.";
        if (options.throwOnError) throw new Error(message);
        void shell.notify({ tone: "error", title: "Modification non confirmée", description: message });
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
        if (pendingMembers.current.size) {
          const patches = new Map(pendingMembers.current);
          pendingMembers.current.clear();
          void change({ ...currentState.current, members: currentState.current.members.map((member) => ({ ...member, ...patches.get(member.id) })) });
        }
      }
    })();
  };
  const changeMember = (memberId: string, patch: Partial<ProjectMember>) => {
    const next = { ...currentState.current, members: currentState.current.members.map((member) => (member.id === memberId ? { ...member, ...patch } : member)) };
    if (savingRef.current) {
      pendingMembers.current.set(memberId, { ...pendingMembers.current.get(memberId), ...patch });
      currentState.current = next;
      setState(next);
    } else void change(next);
  };

  const produits = useMemo(() => produitsDe(tickets, source?.projets ?? []), [tickets, source]);
  const productName = (id: string) => produits.find((item) => item.id === id)?.name ?? "Produit indisponible";

  const open = (item: SourcedTicket) => {
    const managed = currentState.current.tickets.find((ticket) => ticket.key === item.key);
    const assignee = currentState.current.members.find((member) => member.id === managed?.assigneeId)?.name;
    const next: SelectionProjet = { kind: "ticket", source: item, ticket: managed, productName: productName(item.ticket.productId), ...(assignee ? { assignee } : {}) };
    selection.current = next;
    void shell.publish(next);
    void shell.setPanelVisible(true);
  };
  const openMember = (member: ProjectMember) => {
    const next: SelectionProjet = { kind: "member", member, teams: currentState.current.teams, saving: savingRef.current };
    selection.current = next;
    void shell.publish(next);
    void shell.setPanelVisible(true);
  };
  // Le panneau d’une personne suit ses changements (présence, absences, équipe).
  useEffect(() => {
    const current = selection.current;
    if (current?.kind !== "member") return;
    const member = state.members.find((item) => item.id === current.member.id);
    if (!member) return;
    const next: SelectionProjet = { kind: "member", member, teams: state.teams, saving };
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    selection.current = next;
    void shell.publish(next);
  }, [state, saving]);

  const importMember = async (memberId: string) => {
    const member = currentState.current.members.find((item) => item.id === memberId);
    if (!member) return;
    try {
      const synced = await synchroniserAbsences(member, projectToday());
      if (!synced) return;
      changeMember(member.id, { absences: synced.absences });
      void shell.notify({
        tone: "success",
        title: "Absences importées d’Outlook",
        description: synced.imported ? `${synced.imported} période${synced.imported > 1 ? "s" : ""} d’absence à venir.` : "Aucune absence à venir dans cet agenda.",
      });
    } catch (cause) {
      void shell.notify({ tone: "error", title: "Disponibilités Outlook illisibles", description: cause instanceof Error ? cause.message : String(cause) });
    }
  };
  usePeerMessage((raw) => {
    const message = raw as MessageProjet;
    if (message?.kind === "member-patch") changeMember(message.id, message.patch);
    if (message?.kind === "member-import") void importMember(message.id);
    if (message?.kind === "member-remove") {
      const member = currentState.current.members.find((item) => item.id === message.id);
      if (!member) return;
      selection.current = undefined;
      void shell.setPanelVisible(false);
      void change(removeMember(currentState.current, member.id));
    }
    if (message?.kind === "changed") void refreshTickets();
  });

  const openForm = useOpenForm();
  const createTicket = () =>
    void openForm({
      title: "Nouveau ticket",
      fields: [
        { name: "projet", label: "Projet", type: "select", isRequired: true, options: produits.map((item) => ({ id: item.id, label: item.name })) },
        { name: "type", label: "Type", type: "select", isRequired: true, options: ["Task", "Story", "Bug"].map((value) => ({ id: value, label: value })) },
        { name: "resume", label: "Titre", placeholder: "Connexion OIDC du portail", isRequired: true },
        { name: "description", label: "Description", type: "textarea" },
      ],
      initialValues: { projet: produits[0]?.id ?? "", type: "Task" },
      submitLabel: "Créer",
      onSubmit: async (values) => {
        const texte = (nom: string) => String(values[nom] ?? "");
        await creerTicket(source?.compte ?? "", texte("projet"), { type: texte("type"), resume: texte("resume"), description: texte("description") });
        void shell.notify({ title: "Ticket créé", tone: "success" });
        void refreshTickets();
      },
    });

  const activeTeam = state.teams.find((team) => team.id === state.activeTeamId) ?? state.teams[0];
  const actions: Action[] = [
    {
      id: "reserve",
      label: pool ? "Masquer les tickets disponibles" : "Afficher les tickets disponibles",
      icon: <Inbox size={16} />,
      isHidden: vue !== "kanban",
      onPress: () => setPool(!pool),
    },
    {
      id: "absences",
      label: "Mettre à jour les absences",
      icon: <CalendarSync size={16} />,
      isHidden: vue !== "equipes" || !absences.visible,
      isDisabled: saving || absences.pending,
      onPress: () => absencesRef.current?.(),
    },
    { id: "actualiser", label: "Actualiser (F5)", icon: <RefreshCw size={16} />, isDisabled: ticketsLoading || saving, onPress: () => refreshTickets() },
  ];
  const toolbar = (
    <Row gap="sm">
      <Tabs
        pageTitle="Projet"
        items={[
          { id: "kanban", label: "Kanban" },
          { id: "planning", label: "Planning" },
          { id: "equipes", label: "Équipes" },
        ]}
        selectedId={vue}
        onSelectionChange={(valeur) => {
          if (valeur === "kanban" || valeur === "planning" || valeur === "equipes") {
            setSearch("");
            setVue(valeur);
          }
        }}
      />
      {vue === "equipes" ? null : (
        <SearchInput key={vue} label="les tickets, produits et personnes" onChange={({ text }) => setSearch(text)} />
      )}
      {vue === "kanban" && state.teams.length > 1 ? (
        <Select
          label="Équipe"
          hideLabel
          isRequired
          width="sm"
          value={activeTeam?.id ?? null}
          isDisabled={saving}
          options={state.teams.map((team) => ({ id: team.id, label: team.name }))}
          onChange={(id) => id && void change({ ...state, activeTeamId: id })}
        />
      ) : null}
    </Row>
  );

  if (loading) return <Page toolbar={toolbar} actions={actions} state="loading" loadingLabel="Lecture des tickets…">{null}</Page>;
  if (error && !tickets.length)
    return (
      <Page toolbar={toolbar} actions={actions}>
        <EmptyState
          title="Les tickets n’ont pas pu être lus"
          description={`${error} Le compte et les projets Jira se règlent dans Réglages, Atom.`}
          action={<Button onPress={() => void refreshTickets()}>Réessayer</Button>}
        />
      </Page>
    );
  return (
    <Page toolbar={toolbar} actions={actions} fill>
      {vue === "kanban" ? (
        <Kanban
          state={state}
          tickets={tickets}
          productName={productName}
          saving={saving}
          search={search}
          pool={pool}
          onChange={(next) => void change(next)}
          onJustifiedMove={(next, key, body) => change(next, { key, body }, { throwOnError: true })}
          onOpen={open}
          onCreate={createTicket}
          completed={{ loaded: completedLoaded, loading: completedLoading, hasMore: completedHasMore, refreshing: ticketsLoading, onLoad: () => void loadCompleted(), onClear: clearCompleted }}
        />
      ) : vue === "planning" ? (
        <Planning state={state} tickets={tickets} produits={produits} saving={saving} search={search} onChange={(next) => void change(next)} onOpen={open} />
      ) : (
        <Equipes
          state={state}
          saving={saving}
          source={source}
          onChange={(next) => void change(next)}
          onMemberChange={changeMember}
          onOpenMember={openMember}
          absencesRef={absencesRef}
          onAbsences={setAbsences}
        />
      )}
    </Page>
  );
}

/** Remplace les tickets relus, garde les terminés chargés à la demande. */
function mergeFresh(previous: SourcedTicket[], fresh: SourcedTicket[]) {
  const merged = new Map(previous.map((item) => [item.key, item]));
  for (const item of fresh) merged.set(item.key, item);
  return [...merged.values()];
}

function removeMember(state: ProjectManagementState, memberId: string): ProjectManagementState {
  const member = state.members.find((item) => item.id === memberId);
  if (!member) return state;
  return {
    ...state,
    members: state.members.filter((item) => item.id !== memberId),
    ignoredMemberAccounts: [...new Set([...(state.ignoredMemberAccounts ?? []), ...Object.entries(member.accounts ?? {}).map(([connectionId, id]) => JSON.stringify([connectionId, id]))])],
  };
}

// ------------------------------------------------------------------------------------------------ Kanban
function Kanban({
  state,
  tickets,
  productName,
  saving,
  search,
  pool,
  onChange,
  onJustifiedMove,
  onOpen,
  onCreate,
  completed,
}: {
  state: ProjectManagementState;
  tickets: SourcedTicket[];
  productName: (id: string) => string;
  saving: boolean;
  search: string;
  pool: boolean;
  onChange: (next: ProjectManagementState) => void;
  onJustifiedMove: (next: ProjectManagementState, key: string, body: string) => Promise<boolean>;
  onOpen: (ticket: SourcedTicket) => void;
  onCreate: () => void;
  completed: { loaded: boolean; loading: boolean; hasMore: boolean; refreshing: boolean; onLoad: () => void; onClear: () => void };
}) {
  const selectedTeam = state.teams.find((team) => team.id === state.activeTeamId) ?? state.teams[0];
  const teamMembers = state.members.filter((member) => member.teamId === selectedTeam?.id);
  const teamMemberIds = new Set(teamMembers.map((member) => member.id));
  const [reserveAssignments, setReserveAssignments] = useState<Record<string, string>>({});
  const [requiredAssignee, setRequiredAssignee] = useState<string>();
  const [reserveEstimates, setReserveEstimates] = useState<Record<string, number | undefined>>({});
  const [requiredEstimate, setRequiredEstimate] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const terms = searchTerms(useDeferredValue(search));
  const sourceByKey = useMemo(() => new Map(tickets.map((item) => [item.key, item])), [tickets]);
  const managedByKey = useMemo(() => new Map(state.tickets.map((ticket) => [ticket.key, ticket])), [state.tickets]);
  const memberNames = useMemo(() => new Map(state.members.map((member) => [member.id, member.name])), [state.members]);
  const visibleOrder = new Map<string, string[]>();
  const personOrder = (ticket: ProjectTicket) => (visibleOrder.get(ticket.stage) ?? []).filter((key) => managedByKey.get(key)?.assigneeId === ticket.assigneeId);
  const matches = (key: string) => {
    if (!terms.length) return true;
    const item = sourceByKey.get(key);
    const managed = managedByKey.get(key);
    const assigneeId = managed?.assigneeId ?? (item ? memberForTicket(state.members, item)?.id : undefined);
    return matchesSearch(terms, [item?.ticket.id ?? managed?.issueKey, item?.ticket.title, productName(managed?.productId ?? item?.ticket.productId ?? ""), assigneeId ? memberNames.get(assigneeId) : undefined]);
  };
  const poolAssignee = (key: string) => {
    if (reserveAssignments[key]) return reserveAssignments[key];
    const item = sourceByKey.get(key);
    const existing = item ? memberForTicket(state.members, item)?.id : undefined;
    return existing && teamMemberIds.has(existing) ? existing : undefined;
  };
  const backlog = tickets.filter((item) => {
    if (managedByKey.has(item.key)) return false;
    const assigneeId = memberForTicket(state.members, item)?.id;
    const visible = !assigneeId || teamMemberIds.has(assigneeId) || assigneeId.startsWith("provider:");
    return visible && matches(item.key);
  });

  const [deplacement, setDeplacement] = useState<{ key: string; destination: string; next: ProjectManagementState } | null>(null);
  const confirmMove = (key: string, stage: ProjectStage | undefined, next: ProjectManagementState, rank?: number) => {
    const destination = `${COLUMNS.find((column) => column.id === stage)?.label ?? "Tickets disponibles"}${rank ? ` · Ordre ${rank}` : ""}`;
    setDeplacement({ key, destination, next });
  };

  const move = (key: string, column: string, beforeKey?: string) => {
    if (saving || key === beforeKey) return;
    const stage = column === "reserve" ? undefined : (column as ProjectStage);
    const managed = state.tickets.find((ticket) => ticket.key === key);
    const item = sourceByKey.get(key);
    const assignment = managed?.assigneeId ?? poolAssignee(key);
    if (stage && !teamMemberIds.has(assignment ?? "")) {
      setRequiredAssignee(key);
      setAnnouncement("Choisissez un membre de l’équipe pour attribuer ce ticket.");
      return;
    }
    const remoteEstimate = item && !item.timeTrackingUnavailable && item.ticket.estimateSeconds ? item.ticket.estimateSeconds / (item.workdaySeconds ?? 28800) : undefined;
    const estimate = managed?.estimateDays || reserveEstimates[key] || remoteEstimate;
    if (stage && !estimate && !item?.timeTrackingUnavailable) {
      setRequiredEstimate(key);
      setAnnouncement("Renseignez la durée estimée de ce ticket avant de le planifier.");
      return;
    }
    if (!stage) {
      setAnnouncement("Retirez le responsable ou la durée du ticket pour le remettre dans les tickets disponibles.");
      void shell.notify({ tone: "info", title: "Retirez le responsable ou la durée du ticket pour le remettre dans les tickets disponibles." });
      return;
    }
    let next = state;
    if (!managed) {
      if (!item) return;
      const remote = projectStateFromTickets(state, [item], { all: true }).tickets[0];
      next = {
        ...state,
        tickets: [
          ...state.tickets,
          {
            ...remote,
            stage,
            position: state.tickets.length,
            assigneeId: assignment,
            ...(reserveEstimates[key] && !remote.estimateDays ? { estimateDays: reserveEstimates[key], remainingDays: reserveEstimates[key] } : {}),
          },
        ],
      };
    } else if (!managed.assigneeId) next = { ...state, tickets: state.tickets.map((ticket) => (ticket.key === key ? { ...ticket, assigneeId: assignment } : ticket)) };
    next = moveProjectTicket(next, key, stage, beforeKey);
    const changed =
      next.tickets.length !== state.tickets.length ||
      next.tickets.some((ticket) => {
        const previous = state.tickets.find((candidate) => candidate.key === ticket.key);
        return !previous || previous.stage !== ticket.stage || previous.position !== ticket.position || previous.assigneeId !== ticket.assigneeId || previous.remainingDays !== ticket.remainingDays;
      });
    if (changed) confirmMove(key, stage, next);
  };
  const moveToRank = (key: string, rank: number) => {
    if (saving) return;
    const ticket = state.tickets.find((item) => item.key === key);
    if (!ticket) return;
    const order = personOrder(ticket);
    if (!Number.isInteger(rank) || rank < 1 || rank > order.length) {
      setAnnouncement(`Choisissez un ordre entre 1 et ${order.length}.`);
      return;
    }
    if (order.indexOf(key) === rank - 1) return;
    const remaining = order.filter((item) => item !== key);
    const column = (visibleOrder.get(ticket.stage) ?? []).filter((item) => item !== key);
    const beforeKey = remaining[rank - 1] ?? column[column.indexOf(remaining[remaining.length - 1]) + 1];
    const next = moveProjectTicket(state, key, ticket.stage, beforeKey);
    if (next !== state) confirmMove(key, ticket.stage, next, rank);
  };

  const memberOptions = teamMembers.map((member) => ({ value: member.id, label: member.name }));
  const card = (key: string, managed?: ProjectTicket): BoardCard => {
    const item = sourceByKey.get(key);
    const issueKey = item?.ticket.id ?? managed?.issueKey ?? "";
    const base = {
      id: key,
      label: `${issueKey} ${item?.ticket.title ?? "Ticket indisponible"}`,
      code: issueKey,
      meta: productName(managed?.productId ?? item?.ticket.productId ?? ""),
      title: item?.ticket.title ?? "Données du ticket indisponibles",
      ...(item ? { onOpen: () => onOpen(item), openLabel: `Ouvrir ${issueKey}` } : {}),
    };
    if (!managed) {
      const reason = item ? projectAvailableReason(projectStateFromTickets(state, [item], { all: true }).tickets[0], item) : undefined;
      return {
        ...base,
        movable: true,
        note: reason,
        body: (
          <Stack gap="xs">
            <Select
              label={`Attribuer ${issueKey} à un membre de l’équipe`}
              hideLabel
              isRequired
              placeholder="Personne"
              value={poolAssignee(key) ?? null}
              isDisabled={saving}
              options={memberOptions.map((option) => ({ id: option.value, label: option.label }))}
              {...(requiredAssignee === key ? { error: "Choisissez un membre de l’équipe." } : {})}
              onChange={(id) => {
                setReserveAssignments((previous) => ({ ...previous, [key]: id ?? "" }));
                setRequiredAssignee(undefined);
              }}
            />
            {item?.timeTrackingUnavailable ? null : (
              <Row>
                <BoardEffortChip
                  label={`Durée estimée ${issueKey}`}
                  prefix="Durée estimée"
                  value={reserveEstimates[key]}
                  placeholder={item?.ticket.estimateSeconds ? jours(item.ticket.estimateSeconds / (item.workdaySeconds ?? 28800)).replace(",", ".") : "–"}
                  disabled={saving}
                  invalid={requiredEstimate === key}
                  onChange={(days) => {
                    setReserveEstimates((previous) => ({ ...previous, [key]: days !== undefined && Number.isFinite(days) && days > 0 ? days : undefined }));
                    setRequiredEstimate(undefined);
                  }}
                />
              </Row>
            )}
            {requiredEstimate === key ? <Notice tone="danger">Renseignez la durée estimée avant de planifier.</Notice> : null}
            <Row>
              {/* Un lien, lisible sur le fond de la carte ; pendant un enregistrement, le texte reste sans action. */}
              {saving ? (
                <Text tone="muted" size="meta" as="span">
                  Ajouter au Kanban →
                </Text>
              ) : (
                <Link onPress={() => move(key, "todo")}>Ajouter au Kanban →</Link>
              )}
            </Row>
          </Stack>
        ),
      };
    }
    const hasRemaining = managed.stage === "doing" || managed.stage === "suspended";
    const effort = hasRemaining ? (managed.remainingDays ?? managed.estimateDays) : managed.estimateDays;
    const order = personOrder(managed);
    const rank = managed.stage !== "done" ? order.indexOf(key) + 1 || undefined : undefined;
    return {
      ...base,
      movable: true,
      handleLabel: `Déplacer ${issueKey} : Espace, puis flèches et Entrée`,
      ...(rank ? { rank: { value: rank, total: order.length, label: `Ordre ${issueKey}`, onChange: (value: number) => moveToRank(key, value) } } : {}),
      footerStart: (
        <BoardPersonChip
          label={`Responsable ${issueKey}`}
          value={managed.assigneeId ?? ""}
          options={memberOptions}
          disabled={saving}
          onChange={(value) => onChange({ ...state, tickets: state.tickets.map((ticket) => (ticket.key === key ? { ...ticket, assigneeId: value || undefined } : ticket)) })}
        />
      ),
      footerEnd: (
        <BoardEffortChip
          label={`${hasRemaining ? "Reste à faire" : "Estimation"} ${issueKey}`}
          title={`${hasRemaining ? "Reste à faire" : "Durée"} · 1 jour = ${(item?.workdaySeconds ?? 28800) / 3600} heures`}
          value={effort}
          busy={saving}
          disabled={managed.stage === "done" || saving || item?.timeTrackingUnavailable}
          onChange={(value) =>
            onChange({
              ...state,
              tickets: state.tickets.map((ticket) =>
                ticket.key === key ? { ...ticket, ...(hasRemaining ? { remainingDays: value } : { estimateDays: value, remainingDays: value }) } : ticket,
              ),
            })
          }
        />
      ),
    };
  };

  const columns: BoardColumn[] = [];
  if (pool)
    columns.push({
      id: "reserve",
      label: "Tickets disponibles",
      icon: boardIcons.pool,
      appearance: "pool",
      keyboard: false,
      count: String(backlog.length),
      action: { label: "Nouveau ticket", icon: Plus, onClick: onCreate },
      cards: backlog.map((item) => card(item.key)),
      empty: "Aucun ticket disponible.",
    });
  for (const { id, label, Icon } of COLUMNS) {
    const hidden = id === "done" && !completed.loaded;
    const eligible = state.tickets.filter((item) => !hidden && item.stage === id && teamMemberIds.has(item.assigneeId ?? "")).sort((a, b) => a.position - b.position);
    const items = eligible.filter((ticket) => matches(ticket.key));
    visibleOrder.set(id, items.map(({ key }) => key));
    columns.push({
      id,
      label,
      icon: Icon,
      count: `${terms.length ? `${items.length}/${eligible.length}` : items.length}${daysLabel(items)}`,
      ...(id === "done" ? { countTitle: "Tickets terminés chargés" } : {}),
      cards: [],
      empty: terms.length
        ? id === "done" && !completed.loaded
          ? "Chargez les tickets terminés pour effectuer une recherche."
          : "Aucun ticket ne correspond à cette recherche."
        : id === "done" && !completed.loaded
          ? "Les tickets terminés sont chargés à la demande."
          : id === "done"
            ? "Aucun ticket terminé chargé."
            : "Déposer un ticket ici.",
      more:
        id === "done"
          ? [
              ...(completed.hasMore
                ? [{ label: completed.loaded ? "Charger davantage de tickets terminés" : "Charger les tickets terminés", onClick: completed.onLoad, loading: completed.loading, disabled: completed.loading || completed.refreshing }]
                : []),
              ...(completed.loaded ? [{ label: "Masquer les tickets terminés", onClick: completed.onClear, quiet: true, disabled: completed.loading || completed.refreshing }] : []),
            ]
          : undefined,
    });
  }
  // Les cartes se construisent une fois l’ordre visible de chaque colonne connu (rang « # » de chaque personne).
  for (const column of columns) if (column.id !== "reserve") column.cards = (visibleOrder.get(column.id) ?? []).map((key) => card(key, managedByKey.get(key)));
  return (
    <>
      <Board
        label="Kanban du projet"
        columns={columns}
        busy={saving}
        onMove={move}
        announcement={announcement}
        hint="Saisir le numéro # d’une carte pour la placer dans sa colonne, ou la glisser · Espace puis flèches au clavier · le haut de la colonne est le plus prioritaire"
      />
      {deplacement ? (
        <Justification
          destination={deplacement.destination}
          fermer={() => setDeplacement(null)}
          deplacer={async (body) => {
            await onJustifiedMove(deplacement.next, deplacement.key, body);
            setAnnouncement(body ? `Ticket déplacé dans ${deplacement.destination}.` : "Ticket déplacé sans message.");
            setDeplacement(null);
          }}
        />
      ) : null}
    </>
  );
}

/** Fenêtre « Justifier le déplacement » : la justification part en commentaire du ticket. */
function Justification({
  destination,
  fermer,
  deplacer,
}: {
  destination: string;
  fermer: () => void;
  deplacer: (body: string) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [erreur, setErreur] = useState<string>();
  const [enCours, setEnCours] = useState<"sans" | "avec" | null>(null);
  const lancer = async (avec: boolean) => {
    if (avec && !body.trim()) {
      setErreur("Saisissez une justification, ou choisissez « Déplacer sans message ».");
      return;
    }
    setEnCours(avec ? "avec" : "sans");
    setErreur(undefined);
    try {
      await deplacer(avec ? body.trim() : "");
    } catch (cause) {
      setErreur(cause instanceof Error && cause.message ? cause.message : "Le déplacement n’a pas abouti.");
    } finally {
      setEnCours(null);
    }
  };
  return (
    <Modal
      isOpen
      title="Justifier le déplacement"
      description={`Destination : ${destination}`}
      isBusy={enCours !== null}
      onOpenChange={(ouverte) => {
        if (!ouverte) fermer();
      }}
      footer={
        <>
          <Button onPress={fermer}>Annuler</Button>
          <Button isPending={enCours === "sans"} isDisabled={enCours === "avec"} onPress={() => void lancer(false)}>
            Déplacer sans message
          </Button>
          <Button variant="primary" isPending={enCours === "avec"} isDisabled={enCours === "sans"} onPress={() => void lancer(true)}>
            Confirmer le déplacement
          </Button>
        </>
      }
    >
      <TextArea
        label="Justification"
        description="Ce texte sera ajouté en commentaire au ticket. Facultatif : « Déplacer sans message » s’en passe."
        minRows={5}
        value={body}
        {...(erreur ? { error: erreur } : {})}
        onChange={setBody}
      />
    </Modal>
  );
}

// ------------------------------------------------------------------------------------------------ Planning
function Planning({
  state,
  tickets,
  produits,
  saving,
  search,
  onChange,
  onOpen,
}: {
  state: ProjectManagementState;
  tickets: SourcedTicket[];
  produits: Produit[];
  saving: boolean;
  search: string;
  onChange: (next: ProjectManagementState) => void;
  onOpen: (source: SourcedTicket) => void;
}) {
  const today = projectToday();
  const calculationStart = state.startDate ?? today;
  const [viewStart, setViewStart] = usePageState<string>("planning.debut", addProjectDays(today, -3));
  const [zoom, setZoom] = usePageState<number>("planning.zoom", 14);
  const [group, setGroup] = usePageState<string>("planning.groupe", "person");
  const [announcement, setAnnouncement] = useState("");
  const [drag, setDrag] = useState<TimelineDrag>();
  const terms = searchTerms(useDeferredValue(search));
  const days = projectVisibleDays(zoom, viewStart);
  const dates = useMemo(() => Array.from({ length: days }, (_, index) => addProjectDays(viewStart, index)), [viewStart, days]);
  const end = dates.at(-1) ?? viewStart;
  const preview = useMemo(() => (drag?.valid ? reorderScheduledTicket(state, drag.key, drag.shiftDays, calculationStart) : state), [state, drag, calculationStart]);
  const schedule = useMemo(() => scheduleProjectTickets(preview, calculationStart), [preview, calculationStart]);
  const sourceByKey = new Map(tickets.map((item) => [item.key, item]));
  const managedByKey = new Map(state.tickets.map((ticket) => [ticket.key, ticket]));
  const productNames = new Map(produits.map((product) => [product.id, product.name]));
  const memberNames = new Map(state.members.map((member) => [member.id, member.name]));
  const ticketMatches = (key: string, productId: string, assigneeId?: string) =>
    matchesSearch(terms, [managedByKey.get(key)?.issueKey, sourceByKey.get(key)?.ticket.title, productNames.get(productId), assigneeId ? memberNames.get(assigneeId) : undefined]);
  const visibleSchedule = terms.length ? schedule.filter((entry) => ticketMatches(entry.key, entry.productId, entry.assigneeId)) : schedule;
  const visibleProducts = terms.length ? produits.filter((product) => visibleSchedule.some((entry) => entry.productId === product.id)) : produits;
  const involves = (entry: ScheduledTicket, personId: string) => entry.assigneeId === personId || entry.historySlots.some((slot) => slot.assigneeId === personId);
  const visibleMembers = terms.length ? state.members.filter((person) => visibleSchedule.some((entry) => involves(entry, person.id))) : state.members;

  const move = (key: string, shiftDays: number) => {
    if (saving) return;
    const next = reorderScheduledTicket(state, key, shiftDays, calculationStart);
    if (next !== state) {
      onChange(next);
      setAnnouncement("Ordre de la tâche mis à jour dans le planning et le Kanban.");
    }
  };
  const assign = (key: string, memberId: string) => {
    if (saving) return;
    const next = assignProjectTicket(state, key, memberId);
    if (next === state) return;
    onChange(next);
    setAnnouncement(`Ticket attribué à ${state.members.find(({ id }) => id === memberId)?.name ?? "la personne"} et placé dans le planning.`);
  };
  const zoomTo = (value: number, ratio = 0.5, calendarYear = false) => {
    const anchor = addProjectDays(viewStart, Math.round(days * ratio));
    setZoom(value);
    setViewStart(calendarYear && value === 365 ? `${anchor.slice(0, 4)}-01-01` : addProjectDays(anchor, -Math.round(value * ratio)));
  };
  const loadOf = (person: ProjectMember) => {
    const available = dates.filter((date) => memberDayStatus(person, date) === "available").length;
    if (!available) return 0;
    const planned = schedule
      .filter((entry) => entry.assigneeId === person.id)
      .flatMap((entry) => entry.slots)
      .filter((slot) => slot.date >= viewStart && slot.date <= end)
      .reduce((total, slot) => total + slot.portion, 0);
    return Math.round((planned / available) * 100);
  };
  const unplanned = state.tickets.filter((ticket) => ticket.stage !== "done" && !ticket.assigneeId && ticketMatches(ticket.key, ticket.productId)).sort((left, right) => left.position - right.position);
  const keyboardMove = (entry: ScheduledTicket, direction: -1 | 1) => {
    const own = managedByKey.get(entry.key);
    const siblings = state.tickets.filter((item) => item.assigneeId === own?.assigneeId && item.stage === own?.stage).sort((a, b) => a.position - b.position);
    const neighbor = siblings[siblings.findIndex((item) => item.key === entry.key) + direction];
    const target = schedule.find((item) => item.key === neighbor?.key);
    const first = entry.slots[0];
    const slot = direction > 0 ? target?.slots.at(-1) : target?.slots[0];
    if (first && slot) move(entry.key, projectDaysBetween(first.date, slot.date) + slot.offset + (direction > 0 ? slot.portion : 0) - first.offset);
  };
  const row = (person: ProjectMember, entries: ScheduledTicket[], id: string): TimelineItem => ({
    kind: "person",
    id,
    personId: person.id,
    name: person.name,
    load: loadOf(person),
    days: dates.map((date) => {
      const status = memberDayStatus(person, date);
      const reason =
        status === "outside-presence"
          ? date < person.from
            ? `Présence à partir du ${formatDate(person.from)}`
            : `Fin de présence le ${formatDate(person.to ?? date)}`
          : status === "absence"
            ? "Absence déclarée"
            : status === "non-working"
              ? "Jour non travaillé"
              : "Disponible";
      return { status, title: `${formatDate(date)} · ${reason}` };
    }),
    bars: entries.flatMap((entry) => {
      const item = sourceByKey.get(entry.key);
      const issueKey = item?.ticket.id ?? managedByKey.get(entry.key)?.issueKey ?? "";
      const segments = [
        ...projectTimelineSegments(entry.historySlots.filter((slot) => slot.assigneeId === person.id), viewStart, days).map((segment) => ({ ...segment, history: true })),
        ...(entry.assigneeId === person.id ? projectTimelineSegments(entry.slots, viewStart, days).map((segment) => ({ ...segment, history: false })) : []),
      ];
      return segments.map(
        (segment, index): TimelineBar => ({
          id: `${entry.key}-${segment.history ? "history" : "remaining"}-${index}`,
          key: entry.key,
          column: segment.column,
          span: segment.span,
          offset: segment.offset,
          duration: segment.duration,
          history: segment.history,
          label: segment.span >= 4 ? issueKey : segment.span >= 2 ? (issueKey.split("-").at(-1) ?? "") : "•",
          ariaLabel: `Ouvrir ${issueKey} · ${item?.ticket.title ?? "Ticket indisponible"}${segment.history ? " · Travail antérieur" : ""}`,
          title: `${issueKey} · ${item?.ticket.title ?? "Ticket indisponible"} · ${segment.history ? "Travail antérieur" : "Reste à faire"} · ${formatDate(segment.date)}`,
          disabled: !item,
          ...(item ? { onOpen: () => onOpen(item) } : {}),
          onKeyDown: (event) => {
            if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
              event.preventDefault();
              keyboardMove(entry, event.key === "ArrowLeft" ? -1 : 1);
            }
          },
        }),
      );
    }),
  });
  const items: TimelineItem[] =
    group === "person"
      ? [
          ...visibleMembers.map((person) => row(person, visibleSchedule.filter((entry) => involves(entry, person.id)), person.id)),
          ...(!visibleMembers.length ? [{ kind: "empty" as const, id: "vide", text: "Aucune personne planifiée pour ces produits." }] : []),
        ]
      : [
          ...visibleProducts.flatMap((product): TimelineItem[] => {
            const entries = visibleSchedule.filter((entry) => entry.productId === product.id);
            const people = state.members.filter((person) => entries.some((entry) => involves(entry, person.id)));
            return [
              { kind: "band", id: `band-${product.id}`, label: product.name },
              ...people.map((person) => row(person, entries.filter((entry) => involves(entry, person.id)), `${product.id}-${person.id}`)),
              ...(!people.length ? [{ kind: "empty" as const, id: `vide-${product.id}`, text: "Aucune personne planifiée sur ce produit." }] : []),
            ];
          }),
          ...(!visibleProducts.length ? [{ kind: "empty" as const, id: "vide", text: "Aucun produit configuré." }] : []),
        ];
  const draggedSource = drag ? sourceByKey.get(drag.key) : undefined;
  const draggedEntry = schedule.find((entry) => entry.key === drag?.key);
  return (
    <Timeline
      label="Planning du projet"
      groups={{ label: "Regrouper le planning", value: group, options: [{ value: "product", label: "Par produit" }, { value: "person", label: "Par personne" }], onChange: setGroup }}
      start={{
        label: "Planifier à partir du",
        title: "Date de départ du planning calculé, en tenant compte des jours travaillés et des absences de chaque personne.",
        value: calculationStart,
        onChange: (value) => onChange({ ...state, startDate: value }),
      }}
      aside={
        <TimelineBacklog
          title="À planifier"
          count={unplanned.length}
          description="Glissez un ticket sur la ligne d’une personne, ou laissez Atom répartir."
          action={{
            label: "Répartir selon la charge",
            title: "Attribue chaque ticket à planifier, par ordre de priorité, à la personne la moins chargée au regard de ses jours travaillés. Les tickets restent déplaçables ensuite.",
            disabled: !unplanned.length || !state.members.length,
            onClick: () => {
              const next = autoAssignProjectTickets(state);
              if (next === state) return;
              onChange(next);
              setAnnouncement(`${unplanned.length} ticket${unplanned.length > 1 ? "s" : ""} réparti${unplanned.length > 1 ? "s" : ""} selon la charge de chacun.`);
            },
          }}
          disabled={saving}
          dragType={backlogType}
          empty="Tous les tickets ont une personne attribuée."
          items={unplanned.map((ticket) => {
            const item = sourceByKey.get(ticket.key);
            const effort = ticket.remainingDays ?? ticket.estimateDays;
            return {
              id: ticket.key,
              code: ticket.issueKey,
              title: item?.ticket.title ?? "Ticket indisponible",
              ...(effort ? { effort: `${effort} j` } : {}),
              color: produits.find(({ id }) => id === ticket.productId)?.color ?? "steel",
              ...(item ? { onOpen: () => onOpen(item) } : {}),
              ...(state.members.length
                ? { assign: { label: `Attribuer ${ticket.issueKey} à`, placeholder: "Attribuer à…", options: state.members.map((member) => ({ value: member.id, label: member.name })), onChange: (value: string) => assign(ticket.key, value) } }
                : {}),
            };
          })}
        />
      }
      period={{
        label: `${formatDate(viewStart)} – ${formatDate(end)} ${end.slice(0, 4)}`,
        onPrevious: () => setViewStart(addProjectDays(viewStart, -Math.max(1, Math.round(days / 2)))),
        onToday: () => setViewStart(zoom === 365 ? `${today.slice(0, 4)}-01-01` : addProjectDays(today, -Math.floor(days * 0.2))),
        onNext: () => setViewStart(addProjectDays(viewStart, Math.max(1, Math.round(days / 2)))),
      }}
      zoom={{ label: "Période visible", value: zoom, levels: projectZoomLevels.map((level) => ({ value: level, label: zoomLabel(level) })), onChange: (value) => zoomTo(value, 0.5, true) }}
      dates={dates}
      today={today}
      firstColumn={group === "person" ? "Personnes" : "Produits / personnes"}
      items={items}
      busy={saving}
      announcement={announcement}
      onShift={(shift) => setViewStart((value) => addProjectDays(value, shift))}
      onWheelZoom={(direction, ratio) => {
        const index = projectZoomLevels.indexOf(zoom);
        const next = projectZoomLevels[Math.max(0, Math.min(projectZoomLevels.length - 1, index + direction))];
        if (next === zoom) return;
        setZoom(next);
        setViewStart(addProjectDays(viewStart, Math.round((days - projectVisibleDays(next, viewStart)) * ratio)));
      }}
      onBarDrag={setDrag}
      onBarDrop={move}
      rowDrop={{ type: backlogType, onDrop: (personId, key) => assign(key, personId) }}
      dragPreview={
        drag && draggedSource
          ? {
              heading: draggedSource.ticket.id,
              title: draggedSource.ticket.title,
              detail: drag.valid ? `${formatDate(draggedEntry?.slots[0]?.date ?? viewStart)} → ${formatDate(draggedEntry?.slots.at(-1)?.date ?? viewStart)}` : "Déposer sur la ligne de cette personne",
              valid: drag.valid,
              x: drag.x,
              y: drag.y,
            }
          : undefined
      }
    />
  );
}

// ------------------------------------------------------------------------------------------------ Équipes
/** État de l’action « Mettre à jour les absences », que la vue Équipes remonte à la page. */
type EtatAbsences = { visible: boolean; pending: boolean };

function Equipes({
  state,
  saving,
  source,
  onChange,
  onMemberChange,
  onOpenMember,
  absencesRef,
  onAbsences,
}: {
  state: ProjectManagementState;
  saving: boolean;
  source?: SourceJira;
  onChange: (next: ProjectManagementState) => void;
  onMemberChange: (memberId: string, patch: Partial<ProjectMember>) => void;
  onOpenMember: (member: ProjectMember) => void;
  absencesRef: { current: (() => Promise<void>) | undefined };
  onAbsences: (etat: EtatAbsences) => void;
}) {
  const [teamId, setTeamId] = usePageState<string>("equipes.equipe", state.teams[0]?.id ?? "");
  const [directoryId, setDirectoryId] = useState("");
  const [environnements, setEnvironnements] = useState<{ id: string; nom: string; instance: string }[]>([]);
  // Recrée le champ de recherche de personne après un ajout, pour le vider.
  const [ajouts, setAjouts] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [personId, setPersonId] = useState<string>();
  const latestMembers = useRef(state.members);
  latestMembers.current = state.members;
  useEffect(() => {
    void environnementsAvec("keycloak")
      .then((liste) => {
        setEnvironnements(liste);
        setDirectoryId((current) => current || liste[0]?.id || "");
      })
      .catch(() => setEnvironnements([]));
  }, []);
  const annuaire = useRef(new Map<string, PersonneAnnuaire>());
  const chercherPersonnes = async (texte: string): Promise<ComboBoxItem[]> => {
    const environment = environnements.find((item) => item.id === (directoryId || environnements[0]?.id));
    if (!environment) return [];
    const found = await chercherAnnuaire(environment.instance, texte).catch(() => [] as PersonneAnnuaire[]);
    return found.map((option) => {
      annuaire.current.set(option.id, option);
      return {
        id: option.id,
        label: nomAnnuaire(option),
        description: [option.identifiant, option.email].filter((part, index, all) => part && all.indexOf(part) === index).join(" · "),
      };
    });
  };
  const team = state.teams.find((item) => item.id === teamId) ?? state.teams[0];
  const members = state.members.filter((member) => member.teamId === team?.id);
  const today = projectToday();
  const week = useMemo(() => {
    const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
    return Array.from({ length: 7 }, (_, index) => addProjectDays(today, index - weekday));
  }, [today]);
  const schedule = useMemo(() => scheduleProjectTickets(state, state.startDate ?? today), [state, today]);
  const weekLoad = (member: ProjectMember) => {
    const available = week.filter((date) => memberDayStatus(member, date) === "available").length;
    if (!available) return undefined;
    const planned = schedule
      .filter((entry) => entry.assigneeId === member.id)
      .flatMap((entry) => entry.slots)
      .filter((slot) => week.includes(slot.date))
      .reduce((total, slot) => total + slot.portion, 0);
    return Math.round((planned / available) * 100);
  };

  const refreshTeamAbsences = async () => {
    if (refreshing) return;
    const readable = members.filter(({ outlookEmail }) => outlookEmail);
    if (!readable.length) {
      void shell.notify({ tone: "info", title: "Aucun agenda à lire", description: "Ajoutez les personnes depuis Keycloak ou renseignez leur agenda Outlook pour importer leurs absences." });
      return;
    }
    setRefreshing(true);
    let periods = 0;
    const failed: string[] = [];
    for (const member of readable) {
      try {
        const current = latestMembers.current.find(({ id }) => id === member.id) ?? member;
        const synced = await synchroniserAbsences(current, projectToday());
        if (!synced) continue;
        if (JSON.stringify(synced.absences) !== JSON.stringify(current.absences)) onMemberChange(member.id, { absences: synced.absences });
        periods += synced.imported;
      } catch (cause) {
        failed.push(`${member.name} : ${cause instanceof Error && cause.message ? cause.message : "lecture impossible"}`);
      }
    }
    setRefreshing(false);
    const read = readable.length - failed.length;
    const skipped = members.length - readable.length;
    void shell.notify({
      tone: failed.length ? "warning" : "success",
      ...(failed.length ? { persistent: true } : {}),
      title: `Absences de ${team?.name ?? "l’équipe"} mises à jour`,
      description: [
        `${read} agenda${read > 1 ? "s" : ""} lu${read > 1 ? "s" : ""}, ${periods} période${periods > 1 ? "s" : ""} d’absence à venir.`,
        failed.length ? `\nNon lus :\n${failed.join("\n")}` : "",
        skipped ? `${skipped} personne${skipped > 1 ? "s" : ""} sans agenda.` : "",
      ]
        .filter(Boolean)
        .join(" "),
    });
  };

  const addMember = (person: { name: string; keycloakUsername?: string; email?: string }) => {
    if (!team) return;
    const id = person.keycloakUsername ?? `personne-${crypto.randomUUID()}`;
    if (state.members.some((member) => member.id === id)) {
      void shell.notify({ tone: "info", title: `${person.name} est déjà dans une équipe du projet.` });
      return;
    }
    onChange({
      ...state,
      members: [
        ...state.members,
        {
          id,
          name: person.name,
          teamId: team.id,
          from: projectToday(),
          weekdays: [1, 2, 3, 4, 5],
          absences: [],
          ...(person.keycloakUsername ? { keycloakUsername: person.keycloakUsername } : {}),
          ...(person.email ? { outlookEmail: person.email } : {}),
        },
      ],
    });
    setAjouts((n) => n + 1);
    if (!person.keycloakUsername) return;
    const { keycloakUsername, email } = person;
    void (async () => {
      const accounts: Record<string, string> = {};
      const linked: string[] = [];
      for (const projet of source?.projets.length ? source.projets : []) {
        try {
          for (const term of [keycloakUsername, email].filter(Boolean) as string[]) {
            const account = compteAnnuaire(await chercherComptes(source?.compte ?? "", projet, term), { username: keycloakUsername, email });
            if (account) {
              accounts[JIRA] = account.id;
              linked.push("Jira");
              break;
            }
          }
        } catch {
          /* Un outil indisponible n’empêche pas les autres liaisons. */
        }
        if (accounts[JIRA]) break;
      }
      if (linked.length) onMemberChange(id, { accounts });
      let absences = 0;
      if (email)
        try {
          const member = latestMembers.current.find((item) => item.id === id);
          const synced = member ? await synchroniserAbsences({ ...member, outlookEmail: email }, projectToday()) : undefined;
          if (synced?.imported) {
            onMemberChange(id, { absences: synced.absences });
            absences = synced.imported;
          }
        } catch {
          /* Outlook absent ou indisponible : les absences restent à importer depuis la fiche. */
        }
      void shell.notify({
        tone: "success",
        title: `${person.name} ajouté(e) à ${team.name}`,
        description: [
          linked.length ? `Comptes reliés : ${linked.join(", ")}.` : "Aucun compte Jira relié automatiquement.",
          absences ? `${absences} période${absences > 1 ? "s" : ""} d’absence importée${absences > 1 ? "s" : ""} d’Outlook.` : "",
        ]
          .filter(Boolean)
          .join(" "),
      });
    })();
  };

  // La page montre l’action « Mettre à jour les absences » ; elle appelle la dernière version de la fonction.
  absencesRef.current = refreshTeamAbsences;
  useEffect(() => {
    onAbsences({ visible: members.length > 0, pending: refreshing });
  }, [members.length, refreshing, onAbsences]);
  useEffect(
    () => () => {
      absencesRef.current = undefined;
      onAbsences({ visible: false, pending: false });
    },
    [absencesRef, onAbsences],
  );

  type Ligne = ProjectMember & { load?: number };
  const columns: TableColumn[] = [
    { id: "person", label: "Personne", width: 240 },
    { id: "identity", label: "Identifiant", width: 220 },
    { id: "capacity", label: "Capacité", width: 96 },
    { id: "load", label: "Cette semaine", width: 140 },
  ];
  return (
    <SideNav
      label="Liste des équipes"
      items={state.teams.map((item) => ({ id: item.id, label: item.name, count: state.members.filter((member) => member.teamId === item.id).length }))}
      selected={team?.id}
      onSelect={(id) => {
        setTeamId(id);
        setPersonId(undefined);
      }}
      create={{
        label: "+ Nouvelle équipe",
        field: "Nom de l’équipe",
        placeholder: "Nom de la nouvelle équipe",
        submit: "Ajouter l’équipe",
        onCreate: (name) => {
          const id = crypto.randomUUID();
          onChange({ ...state, teams: [...state.teams, { id, name }] });
          setTeamId(id);
        },
      }}
    >
      <SideNavHeader
        title={team?.name ?? "Équipe"}
        end={
          team ? (
            <Row gap="sm">
              {environnements.length ? (
                <Select
                  label="Annuaire Keycloak"
                  hideLabel
                  isRequired
                  width="sm"
                  value={directoryId || null}
                  options={environnements.map((environment) => ({ id: environment.id, label: `Keycloak · ${environment.nom}` }))}
                  onChange={(id) => id && setDirectoryId(id)}
                />
              ) : null}
              <ComboBox
                key={`${directoryId}:${ajouts}`}
                label="Ajouter une personne"
                hideLabel
                width="md"
                placeholder={environnements.length ? "Identifiant, nom ou e-mail Keycloak" : "Nom de la personne"}
                loadItems={(texte) => chercherPersonnes(texte)}
                value={null}
                allowsCustomValue
                // Personne absente de l’annuaire : « Ajouter » la déclare par son seul nom.
                onCreate={(texte) => {
                  addMember({ name: texte.trim() });
                  return { id: `nom:${texte.trim()}`, label: texte.trim() };
                }}
                onChange={(id) => {
                  const option = typeof id === "string" ? annuaire.current.get(id) : undefined;
                  if (option) addMember({ name: nomAnnuaire(option), keycloakUsername: option.identifiant, email: option.email });
                }}
              />
            </Row>
          ) : undefined
        }
      />
      {members.length ? (
        <Table<Ligne>
          label={`Membres de ${team?.name ?? "l’équipe"}`}
          selectionMode="single"
          columns={columns}
          rows={members.map((member) => ({ ...member, load: weekLoad(member) }))}
          selectedKeys={personId ? [personId] : []}
          onSelectionChange={(keys) => {
            const [id] = [...keys];
            const member = members.find((item) => item.id === id);
            if (!member) return;
            setPersonId(member.id);
            onOpenMember(member);
          }}
          rowIcon={(member) => <Avatar name={member.name} size="sm" />}
          rowDescription={(member) =>
            member.absences.length
              ? `${member.absences.length} absence${member.absences.length > 1 ? "s" : ""} déclarée${member.absences.length > 1 ? "s" : ""}`
              : "Aucune absence"
          }
          renderCell={(member, column) => {
            if (column === "person") return member.name;
            if (column === "identity") return [member.keycloakUsername ?? "—", member.outlookEmail].filter(Boolean).join(" · ");
            if (column === "capacity") return `${member.weekdays.length} j / sem.`;
            return member.load === undefined ? (
              <Text tone="muted" size="meta" as="span">
                —
              </Text>
            ) : (
              <LoadMeter value={member.load} label={`Charge de ${member.name} cette semaine`} />
            );
          }}
        />
      ) : (
        <EmptyState
          size="compact"
          title={team ? "Aucun membre dans cette équipe" : "Aucune équipe"}
          description={team ? "Ajoutez une première personne à cette équipe." : "Ajoutez une équipe pour déclarer ses membres."}
        />
      )}
    </SideNav>
  );
}
