/**
 * Tableau en colonnes (kanban) repris de OneApp (`ProjectKanban`, `ProjectTicketCard`, `useProjectTicketDrag`) :
 * colonnes en creux et une colonne bordée de réserve, cartes à glisser au pointeur entre colonnes et entre deux
 * cartes, ou au clavier depuis leur poignée (Espace, flèches, Entrée, Échap). Le tableau ne décide d’aucun
 * déplacement : il rapporte la carte, la colonne et la carte avant laquelle la poser ; la page applique.
 */
import {
  ChevronDown,
  CircleCheck,
  CircleDashed,
  CircleDot,
  ExternalLink,
  Grip,
  Inbox,
  PauseCircle,
} from "lucide-react";
import {
  type ComponentType,
  type KeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button, EmptyState, IconButton } from "socle-ui";

/** Icône d’action (icône lucide). */
export type ActionIcon = ComponentType<{ size?: number | string; "aria-hidden"?: boolean | "true" | "false" }>;

/** Icônes des colonnes d’un tableau de tickets, dans l’ordre de OneApp. */
export const boardIcons = {
  pool: Inbox,
  todo: CircleDashed,
  doing: CircleDot,
  suspended: PauseCircle,
  done: CircleCheck,
};

export interface BoardCard {
  id: string;
  /** Nom de la carte pour les lecteurs d’écran : « ATOM-101 Connexion OIDC ». */
  label: string;
  /** Clé de l’objet, en police à chasse fixe : « ATOM-101 ». */
  code: string;
  /** Contexte après la clé (produit, projet), précédé d’un point. */
  meta?: string;
  title: string;
  /** Raison affichée sous le titre, en orange (« Sans responsable »). */
  note?: string;
  onOpen?: () => void;
  openLabel?: string;
  /** Ordre « # » de la carte et son maximum ; saisir un autre rang appelle `onChange`. */
  rank?: { value: number; total: number; label: string; onChange: (rank: number) => void };
  /** Contenu libre sous le titre (choix d’une personne, durée, bouton d’ajout). */
  body?: ReactNode;
  /** Pied de la carte : `footerStart` à gauche, `footerEnd` à droite, puis la poignée si la carte se déplace. */
  footerStart?: ReactNode;
  footerEnd?: ReactNode;
  /** La carte se glisse ; la poignée (nommée par `handleLabel`) sert au clavier. */
  movable?: boolean;
  handleLabel?: string;
}

export interface BoardColumn {
  id: string;
  label: string;
  icon?: ActionIcon;
  /** Compteur à droite de l’en-tête : « 4 », « 2/5 · 3,5 j ». */
  count: string;
  countTitle?: string;
  /** `pool` : colonne bordée sur le fond de la page (tickets disponibles) ; sinon colonne en creux. */
  appearance?: "pool" | "default";
  /** Petite action d’icône à droite de l’en-tête (« Nouveau ticket »). */
  action?: { label: string; icon: ActionIcon; onClick: () => void };
  cards: BoardCard[];
  /** Texte quand la colonne n’a aucune carte. */
  empty: string;
  /** Boutons pleine largeur sous les cartes (« Charger les tickets terminés »). */
  more?: { label: string; onClick: () => void; loading?: boolean; disabled?: boolean; quiet?: boolean }[];
  /** La colonne ne reçoit pas de carte au clavier (la réserve). */
  keyboard?: boolean;
}

type Destination = { column: string; beforeId?: string };
const ACTIVATION = 4;

export function Board({
  label,
  columns,
  onMove,
  busy = false,
  hint,
  announcement = "",
}: {
  label: string;
  columns: BoardColumn[];
  /** Carte déposée : colonne et carte avant laquelle la poser (en bas de la colonne sans `beforeId`). */
  onMove: (cardId: string, columnId: string, beforeId?: string) => void;
  /** Une écriture est en cours : rien ne se glisse ni ne se saisit. */
  busy?: boolean;
  /** Aide de pied, sous les colonnes. */
  hint?: string;
  /** Message lu par les lecteurs d’écran, en plus de ceux du tableau. */
  announcement?: string;
}) {
  const board = useRef<HTMLElement>(null);
  const [dragged, setDragged] = useState<string>();
  const [destination, setDestination] = useState<Destination>();
  const [picked, setPicked] = useState<{ id: string; column: string }>();
  const [message, setMessage] = useState("");
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const move = useRef(onMove);
  move.current = onMove;
  useEffect(() => () => cleanup.current?.(), []);
  useEffect(() => {
    if (announcement) setMessage(announcement);
  }, [announcement]);
  const keyboardColumns = columns.filter((column) => column.keyboard !== false);
  const pool = columns[0]?.appearance === "pool";

  const startDrag = (event: ReactPointerEvent<HTMLElement>, id: string) => {
    if (busy || event.button !== 0 || !event.isPrimary) return;
    const target = event.target as HTMLElement;
    if (target.closest("input,select,textarea,a,button:not([data-board-handle])")) return;
    event.preventDefault();
    cleanup.current?.();
    const source = event.currentTarget;
    const root = board.current;
    if (!root) return;
    const pointerId = event.pointerId;
    const start = { x: event.clientX, y: event.clientY };
    const bounds = source.getBoundingClientRect();
    const offset = { x: start.x - bounds.left, y: start.y - bounds.top };
    let point = start;
    let active = false;
    let preview: HTMLElement | undefined;
    let drop: Destination | undefined;
    let frame = 0;
    const hitTest = () => {
      const column = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>("[data-board-column]");
      if (!column || !root.contains(column)) {
        drop = undefined;
        setDestination(undefined);
        return;
      }
      const cards = [...column.querySelectorAll<HTMLElement>("[data-board-card]")].filter(
        (card) => card.dataset.boardCard !== id,
      );
      const before = cards.find((card) => {
        const rect = card.getBoundingClientRect();
        return point.y < rect.top + rect.height / 2;
      });
      const next = { column: column.dataset.boardColumn ?? "", beforeId: before?.dataset.boardCard };
      if (drop?.column !== next.column || drop?.beforeId !== next.beforeId) {
        drop = next;
        setDestination(next);
      }
    };
    const scroll = () => {
      if (!active) return;
      const column = document.elementFromPoint(point.x, point.y)?.closest("[data-board-column]");
      const scroller = column?.querySelector<HTMLElement>(".atom-board__scroll");
      const rect = (scroller ?? root).getBoundingClientRect();
      const vertical = point.y > rect.bottom - 36 ? 12 : point.y < rect.top + 36 ? -12 : 0;
      if (vertical && scroller) scroller.scrollTop += vertical;
      const area = root.getBoundingClientRect();
      const horizontal = point.x > area.right - 28 ? 12 : point.x < area.left + 28 ? -12 : 0;
      if (horizontal) root.scrollLeft += horizontal;
      hitTest();
      frame = requestAnimationFrame(scroll);
    };
    const reset = () => {
      active = false;
      cancelAnimationFrame(frame);
      preview?.remove();
      window.removeEventListener("pointermove", pointerMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("blur", reset);
      setDragged(undefined);
      setDestination(undefined);
      cleanup.current = undefined;
    };
    const pointerMove = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      point = { x: pointer.clientX, y: pointer.clientY };
      if (!active && (point.x - start.x) ** 2 + (point.y - start.y) ** 2 >= ACTIVATION ** 2) {
        active = true;
        preview = source.cloneNode(true) as HTMLElement;
        preview.removeAttribute("data-board-card");
        preview.querySelectorAll("[id]").forEach((node) => {
          node.removeAttribute("id");
        });
        preview.classList.add("drag-preview");
        preview.setAttribute("aria-hidden", "true");
        preview.inert = true;
        Object.assign(preview.style, {
          width: `${bounds.width}px`,
          height: `${bounds.height}px`,
          left: `${point.x - offset.x}px`,
          top: `${point.y - offset.y}px`,
        });
        root.append(preview);
        setDragged(id);
        frame = requestAnimationFrame(scroll);
      }
      if (!active || !preview) return;
      pointer.preventDefault();
      preview.style.left = `${point.x - offset.x}px`;
      preview.style.top = `${point.y - offset.y}px`;
      hitTest();
    };
    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      const wasActive = active;
      if (wasActive) {
        point = { x: pointer.clientX, y: pointer.clientY };
        hitTest();
        pointer.preventDefault();
      }
      const next = drop;
      reset();
      if (wasActive && next) move.current(id, next.column, next.beforeId);
    };
    const cancel = (pointer: PointerEvent) => {
      if (pointer.pointerId === pointerId) reset();
    };
    const keydown = (keyboard: globalThis.KeyboardEvent) => {
      if (keyboard.key === "Escape") {
        keyboard.preventDefault();
        reset();
      }
    };
    cleanup.current = reset;
    window.addEventListener("pointermove", pointerMove, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", keydown);
    window.addEventListener("blur", reset);
  };

  const keyboardDrag = (event: KeyboardEvent<HTMLButtonElement>, card: BoardCard, column: string) => {
    if ((event.key === " " || event.key === "Enter") && !picked) {
      event.preventDefault();
      setPicked({ id: card.id, column });
      setMessage("Ticket saisi. Flèches gauche et droite pour choisir la colonne, Entrée pour déposer.");
      return;
    }
    if (picked?.id !== card.id) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setPicked(undefined);
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const index = keyboardColumns.findIndex((item) => item.id === picked.column);
      const next =
        keyboardColumns[
          Math.max(0, Math.min(keyboardColumns.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)))
        ];
      if (next) {
        setPicked({ id: card.id, column: next.id });
        setMessage(next.label);
      }
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const target = picked.column;
      setPicked(undefined);
      move.current(card.id, target);
    }
  };

  const activeColumn = destination?.column ?? picked?.column;
  return (
    <div className="atom-board-view">
      <style>{TABLEAU_CSS}</style>
      {/* L’aide précède les colonnes : un tableau peu rempli ne laisse pas de vide entre ses cartes et elle. */}
      {hint ? <p className="atom-board__hint">{hint}</p> : null}
      <section
        ref={board}
        className={`atom-board${pool ? "" : " atom-board--closed"}`}
        aria-label={label}
        aria-busy={busy || undefined}
      >
        {columns.map((column) => {
          const Icon = column.icon;
          return (
            <section
              key={column.id}
              className={`atom-board__column${column.appearance === "pool" ? " atom-board__column--pool" : ""}${activeColumn === column.id ? " is-drop" : ""}`}
              aria-label={column.label}
              data-board-column={column.id}
            >
              <div className="atom-board__head">
                {Icon ? <Icon size={16} aria-hidden="true" /> : null}
                <span>{column.label}</span>
                <span className="atom-board__count" title={column.countTitle}>
                  {column.count}
                </span>
                {column.action ? (
                  <span className="atom-board__action">
                    <IconButton
                      label={column.action.label}
                      icon={<column.action.icon size={16} aria-hidden="true" />}
                      onPress={column.action.onClick}
                    />
                  </span>
                ) : null}
              </div>
              <div className="atom-board__scroll">
                {column.cards.map((card) => (
                  <BoardCardView
                    key={card.id}
                    card={card}
                    busy={busy}
                    lifted={dragged === card.id || picked?.id === card.id}
                    before={destination?.beforeId === card.id}
                    onPointerDown={(event) => startDrag(event, card.id)}
                    onHandleKeyDown={(event) => keyboardDrag(event, card, column.id)}
                  />
                ))}
                {!column.cards.length ? <EmptyState size="compact" title={column.empty} /> : null}
                {column.more?.map((item) => (
                  <div key={item.label} className="atom-board__more">
                    <Button
                      variant={item.quiet ? "subtle" : "secondary"}
                      isPending={item.loading}
                      isDisabled={item.disabled || busy}
                      onPress={item.onClick}
                    >
                      {item.label}
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </section>
      <span className="sr-only" role="status">
        {message}
      </span>
    </div>
  );
}

function BoardCardView({
  card,
  busy,
  lifted,
  before,
  onPointerDown,
  onHandleKeyDown,
}: {
  card: BoardCard;
  busy: boolean;
  lifted: boolean;
  before: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onHandleKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const id = useId();
  const rank = card.rank;
  const [draft, setDraft] = useState(rank ? String(rank.value) : "");
  useEffect(() => {
    if (!busy) setDraft(rank ? String(rank.value) : "");
  }, [rank?.value, rank, busy]);
  const hasFoot = Boolean(card.footerStart || card.footerEnd);
  return (
    <article
      className={`atom-board-card${lifted ? " is-lifted" : ""}${before ? " is-before" : ""}${card.movable ? "" : " atom-board-card--fixed"}`}
      data-board-card={card.id}
      aria-label={card.label}
      aria-busy={busy || undefined}
      onPointerDown={card.movable && !busy ? onPointerDown : undefined}
    >
      <div className="atom-board-card__head">
        {rank ? (
          <label className="atom-board-card__rank" htmlFor={`${id}-rank`}>
            <span aria-hidden="true">#</span>
            <input
              data-slot="bare-input"
              id={`${id}-rank`}
              aria-label={rank.label}
              inputMode="numeric"
              value={draft}
              disabled={busy}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              onBlur={() => {
                const next = Number(draft);
                if (draft && Number.isInteger(next) && next >= 1 && next <= rank.total && next !== rank.value)
                  rank.onChange(next);
                setDraft(String(rank.value));
              }}
            />
          </label>
        ) : null}
        <code className="atom-board-card__key">{card.code}</code>
        {card.meta ? (
          <>
            <span className="atom-board-card__dot" aria-hidden="true" />
            <span className="atom-board-card__meta">{card.meta}</span>
          </>
        ) : null}
        <span className="atom-board-card__open">
          <IconButton
            label={card.openLabel ?? `Ouvrir ${card.code}`}
            icon={<ExternalLink size={16} aria-hidden="true" />}
            isDisabled={!card.onOpen}
            onPress={card.onOpen}
          />
        </span>
      </div>
      <h4 className="atom-board-card__title">{card.title}</h4>
      {card.note ? <p className="atom-board-card__note">{card.note}</p> : null}
      {card.body}
      {hasFoot ? (
        <div className="atom-board-card__foot">
          {card.footerStart}
          <span className="atom-board-card__spacer" />
          {card.footerEnd}
          {card.movable ? (
            <button
              type="button"
              className="atom-board-card__handle"
              aria-label={card.handleLabel ?? `Déplacer ${card.code} : Espace, puis flèches et Entrée`}
              title={card.handleLabel ?? `Déplacer ${card.code} : Espace, puis flèches et Entrée`}
              data-board-handle="true"
              aria-pressed={lifted}
              disabled={busy}
              onKeyDown={onHandleKeyDown}
            >
              <Grip size={14} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function initials(name?: string) {
  if (!name) return "–";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("fr"))
    .join("");
}

/** Pastille de la personne d’une carte : initiales et liste des personnes, sans cadre de champ. */
export function BoardPersonChip({
  label,
  value,
  options,
  onChange,
  disabled = false,
  emptyLabel = "Non attribué",
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  const id = useId();
  return (
    <label className="atom-board-chip atom-board-chip--person" htmlFor={id}>
      <span className="atom-board-chip__initials" aria-hidden="true">
        {initials(options.find((option) => option.value === value)?.label)}
      </span>
      <select
        data-slot="bare-input"
        id={id}
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="atom-board-chip__chevron" size={12} aria-hidden="true" />
    </label>
  );
}

/**
 * Durée en jours d’une carte (« 2 j ») : saisie libre, enregistrée en quittant le champ ou par Entrée ; une saisie
 * invalide revient à la valeur confirmée. `prefix` la précède (« Durée estimée »).
 */
export function BoardEffortChip({
  label,
  value,
  onChange,
  title,
  prefix,
  placeholder = "–",
  disabled = false,
  invalid = false,
  busy = false,
}: {
  label: string;
  value?: number;
  onChange: (days: number | undefined) => void;
  title?: string;
  prefix?: string;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  /** Une écriture est en cours : la saisie n’est pas remplacée par la valeur confirmée. */
  busy?: boolean;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  useEffect(() => {
    if (!busy) setDraft(value === undefined ? "" : String(value));
  }, [value, busy]);
  return (
    <label
      className={`atom-board-chip atom-board-chip--effort${prefix ? " atom-board-chip--reserve" : ""}`}
      htmlFor={id}
      title={title}
    >
      {prefix ? <span>{prefix}</span> : null}
      <input
        data-slot="bare-input"
        id={id}
        aria-label={label}
        inputMode="decimal"
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        onBlur={() => {
          // Mêmes bornes que le champ de OneApp : 0 à 365 jours, par demi-journée ; sinon la valeur confirmée revient.
          const next = draft.trim() === "" ? undefined : Number(draft.trim().replace(",", "."));
          if (next !== undefined && (!Number.isFinite(next) || next < 0 || next > 365 || !Number.isInteger(next * 2))) {
            setDraft(value === undefined ? "" : String(value));
            return;
          }
          if (next !== value) onChange(next);
        }}
      />
      <span aria-hidden="true">j</span>
    </label>
  );
}

/** Styles de la vue, repris de OneApp (src/components/projects/projects.css) ; jetons de DESIGN.md seulement. */
export const TABLEAU_CSS = `/* Tableau en colonnes : mesures reprises de OneApp (src/components/projects/projects.css, .oa-board et .oa-ticket). */
.atom-board-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.atom-board {
  position: relative;
  flex: 1;
  min-height: 0;
  display: grid;
  /* 140 px au moins par colonne : les cinq colonnes tiennent à côté du panneau de droite et dans une fenêtre de 1024 px. */
  grid-template-columns: minmax(140px, 0.94fr) repeat(4, minmax(140px, 1fr));
  grid-template-rows: minmax(0, 1fr);
  align-items: start;
  gap: 12px;
  overflow-x: auto;
  overflow-y: hidden;
}
.atom-board--closed {
  grid-template-columns: repeat(4, minmax(140px, 1fr));
}
.atom-board__column {
  max-height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 8px;
  border-radius: var(--radius-lg);
  background: var(--surface-raised);
}
.atom-board__column--pool {
  border: 1px solid var(--line);
  background: var(--surface);
}
.atom-board__column.is-drop {
  outline: 2px dashed var(--accent);
  outline-offset: -3px;
}
.atom-board__head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 2px 10px;
  font-size: var(--fs-sm);
  font-weight: 500;
}
/* Comme OneApp : l’icône de la colonne reste dans le DOM, mais n’est pas dessinée. */
.atom-board__head > svg {
  display: none;
}
.atom-board__count {
  margin-left: auto;
  color: var(--fg-2);
  font-variant-numeric: tabular-nums;
}
.atom-board__scroll {
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.atom-board__more {
  display: flex;
  justify-content: center;
  margin-top: 8px;
}
.atom-board__hint {
  flex-shrink: 0;
  margin: 0;
  color: var(--fg-2);
  font-size: var(--fs-sm);
}

.atom-board-card {
  min-width: 0;
  margin-bottom: 8px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.atom-board-card--fixed {
  cursor: default;
}
.atom-board-card.is-lifted {
  opacity: 0.6;
}
.atom-board-card.is-before {
  box-shadow: inset 0 2px var(--accent);
}
.atom-board-card__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
  color: var(--fg-2);
  font-size: var(--fs-xs);
}
.atom-board-card__key {
  flex: none;
  white-space: nowrap;
  color: var(--fg-2);
  font-family: var(--font-mono, "Cascadia Mono", ui-monospace, monospace);
  font-size: var(--fs-xs);
}
.atom-board-card__dot {
  width: 3px;
  height: 3px;
  flex: none;
  border-radius: 50%;
  background: var(--fg-2);
}
.atom-board-card__meta {
  min-width: 0;
  overflow: hidden;
  color: var(--fg-2);
  font-size: var(--fs-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.atom-board-card__open {
  display: inline-flex;
  margin-left: auto;
  flex: none;
  opacity: 0;
}
.atom-board-card:hover .atom-board-card__open,
.atom-board-card__open:focus-within {
  opacity: 1;
}
.atom-board-card__title {
  margin: 4px 0 6px;
  font-size: var(--fs-md);
  font-weight: 500;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.atom-board-card__note {
  margin: 0 0 6px;
  color: var(--warning);
  font-size: var(--fs-xs);
}
.atom-board-card select {
  width: 100%;
  font-size: var(--fs-sm);
}
.atom-board-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  margin-top: 8px;
}
.atom-board-card__spacer {
  flex: 1;
}
.atom-board-card__handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  width: 24px;
  padding: 1px;
  flex: none;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg-2);
  cursor: grab;
}
.atom-board-card__handle:hover {
  background: var(--hover);
  color: var(--fg);
}
.atom-board-card__handle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.atom-board-card__handle[aria-pressed="true"] {
  background: var(--selected);
}
.atom-board-card__handle:disabled {
  opacity: 0.4;
  cursor: default;
}
.atom-board-card__rank {
  display: inline-flex;
  align-items: center;
  color: var(--fg-2);
  font-size: var(--fs-xs);
  font-weight: 600;
  white-space: nowrap;
}
.atom-board-card__rank input {
  width: 26px;
  height: 20px;
  min-height: 0;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  color: var(--fg-2);
  font: inherit;
  font-size: var(--fs-xs);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  -moz-appearance: textfield;
}
.atom-board-card__rank input:focus-visible {
  outline: 1px solid var(--accent);
  border-radius: var(--radius-sm);
}

.atom-board-chip {
  height: 24px;
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px 0 3px;
  border: 1px solid var(--line);
  border-radius: 12px;
  font-size: var(--fs-sm);
}
.atom-board-chip:hover,
.atom-board-chip:focus-within {
  background: var(--surface-raised);
}
.atom-board-chip select,
.atom-board-chip input {
  height: 22px;
  min-height: 0;
  padding: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
  color: inherit;
  font: inherit;
  font-size: var(--fs-sm);
}
.atom-board-chip input:focus-visible,
.atom-board-chip select:focus-visible {
  outline: none;
}
.atom-board-chip--person {
  flex: 0 1 auto;
  max-width: 62%;
}
.atom-board-chip--person {
  position: relative;
}
.atom-board-chip--person select {
  appearance: none;
  width: auto;
  min-width: 0;
  max-width: 100%;
  padding-right: 14px;
}
.atom-board-chip__initials {
  width: 18px;
  height: 18px;
  flex: none;
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
  background: var(--surface-side);
  font-size: 9px;
  font-weight: 600;
}
.atom-board-chip--effort {
  padding: 0 8px;
  color: var(--fg-2);
}
.atom-board-chip--effort input {
  width: 30px;
  color: var(--fg);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.atom-board-chip input[aria-invalid="true"],
.atom-board-card select[aria-invalid="true"] {
  color: var(--danger);
}

@media (forced-colors: active) {
  .atom-board-card {
    border: 1px solid ButtonText;
  }
}
.atom-board-chip__chevron {
  position: absolute;
  right: 5px;
  color: var(--fg-2);
  pointer-events: none;
}
.atom-board-card input[type="number"]::-webkit-inner-spin-button,
.atom-board-card input[type="number"]::-webkit-outer-spin-button,
.atom-board-chip input[type="number"]::-webkit-inner-spin-button,
.atom-board-chip input[type="number"]::-webkit-outer-spin-button {
  display: none;
  margin: 0;
  -webkit-appearance: none;
}
.atom-board-chip input[type="number"] {
  -moz-appearance: textfield;
}
`;
