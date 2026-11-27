/**
 * Planning en lignes et jours, repris de OneApp (`ProjectPlanning`, `useProjectPlanningDrag`) : en-têtes de
 * semaines (ou de mois au-delà de 80 jours), une ligne par personne avec sa charge, ses jours non travaillés,
 * absences et hors présence, et des barres placées au jour près (parts de jour comprises). Glisser une barre sur sa
 * ligne rapporte un décalage en jours ; glisser le fond, la molette (Maj ou horizontale) et Ctrl+molette décalent
 * et zooment. Le planning ne calcule rien : la page fournit les jours, les barres et réagit aux gestes.
 */
import { Box, ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import {
  type CSSProperties,
  type DragEvent,
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button, EmptyState, IconButton, RadioButtonGroup } from "socle-ui";

export type TimelineDayStatus = "available" | "non-working" | "absence" | "outside-presence";

export interface TimelineBar {
  id: string;
  /** Objet que la barre représente ; rapporté par le glisser. */
  key: string;
  /** Premier jour visible couvert (0 = premier jour affiché), nombre de jours couverts. */
  column: number;
  span: number;
  /** Début dans le premier jour (0 à 1) et longueur en jours, parts comprises. */
  offset: number;
  duration: number;
  /** Travail passé : barre en pointillé, ni glissée ni décalée. */
  history?: boolean;
  label: string;
  ariaLabel: string;
  title?: string;
  disabled?: boolean;
  onOpen?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

export type TimelineItem =
  | {
      kind: "person";
      id: string;
      /** Personne de la ligne : le glisser d’une barre n’est valable que sur sa propre ligne. */
      personId: string;
      name: string;
      /** Charge de la période visible, en pour cent. */
      load: number;
      days: readonly { status: TimelineDayStatus; title: string }[];
      bars: readonly TimelineBar[];
    }
  | { kind: "band"; id: string; label: string }
  | { kind: "empty"; id: string; text: string };

export type TimelineDrag = { key: string; shiftDays: number; valid: boolean; x: number; y: number };

const ACTIVATION = 4;
const dayFormatter = new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short", timeZone: "UTC" });
const monthFormatter = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
const dayOf = (value: string) => new Date(`${value}T12:00:00Z`);
const formatDay = (value: string) => dayFormatter.format(dayOf(value));

/** Charge d’une personne : jauge de 64 px et pourcentage, orange dès 85 %, rouge au-delà de 100 %. */
export function LoadMeter({ value, label }: { value: number; label: string }) {
  return (
    <span className={`atom-load${value > 100 ? " is-over" : value >= 85 ? " is-high" : ""}`}>
      {/* Un trait gris comme la jauge native de OneApp (Chromium) : la valeur se lit dans le pourcentage. */}
      {/* biome-ignore lint/a11y/useSemanticElements: la jauge native se dessine différemment selon le moteur (verte sous WebKit). */}
      <span
        className="atom-load__meter"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(value, 100)}
      />
      <small>{value} %</small>
    </span>
  );
}

/** Colonne des objets à planifier, à gauche du planning : chacun se glisse sur la ligne d’une personne. */
export function TimelineBacklog({
  title,
  count,
  description,
  action,
  items,
  empty,
  dragType,
  disabled = false,
}: {
  title: string;
  count: number;
  description: string;
  action?: { label: string; title?: string; onClick: () => void; disabled?: boolean };
  items: readonly {
    id: string;
    code: string;
    title: string;
    /** « 2 j » à droite de la clé. */
    effort?: string;
    /** Teinte de la pastille (couleur d’accent d’Alfred : blue, violet, teal…). */
    color?: string;
    onOpen?: () => void;
    assign?: {
      label: string;
      placeholder: string;
      options: readonly { value: string; label: string }[];
      onChange: (value: string) => void;
    };
  }[];
  empty: string;
  /** Type des données glissées : la ligne d’une personne ne reçoit que ce type. */
  dragType: string;
  disabled?: boolean;
}) {
  return (
    <aside className="atom-timeline-backlog" aria-label={title}>
      <h3>
        {title} <span>· {count}</span>
      </h3>
      <p>{description}</p>
      {action ? (
        <span className="atom-timeline-backlog__action" title={action.title}>
          <Button variant="primary" isDisabled={action.disabled || disabled} onPress={action.onClick}>
            {action.label}
          </Button>
        </span>
      ) : null}
      <ul>
        {items.map((item) => (
          <li
            key={item.id}
            draggable={!disabled}
            onDragStart={(event) => {
              event.dataTransfer.setData(dragType, item.id);
              event.dataTransfer.effectAllowed = "move";
            }}
          >
            <button type="button" disabled={!item.onOpen} onClick={item.onOpen}>
              <span className="atom-timeline-backlog__meta">
                <i className={`product-color--${item.color ?? "steel"}`} aria-hidden="true" />
                <code>{item.code}</code>
                {item.effort ? <small>{item.effort}</small> : null}
              </span>
              <span>{item.title}</span>
            </button>
            {item.assign ? (
              <select
                data-slot="bare-input"
                className="atom-timeline-backlog__assign"
                aria-label={item.assign.label}
                value=""
                disabled={disabled}
                onChange={(event) => {
                  if (event.target.value) item.assign?.onChange(event.target.value);
                }}
              >
                <option value="">{item.assign.placeholder}</option>
                {item.assign.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : null}
          </li>
        ))}
      </ul>
      {!items.length ? <p>{empty}</p> : null}
    </aside>
  );
}

const defaultLegend = {
  bar: "Reste à faire",
  history: "Travail antérieur conservé",
  off: "Jour non travaillé",
  absence: "Absence",
  outside: "Hors période de présence",
  today: "Aujourd’hui",
};

export function Timeline({
  label,
  groups,
  start,
  aside,
  period,
  zoom,
  legend = defaultLegend,
  dates,
  today,
  firstColumn,
  items,
  busy = false,
  dragHelp = "Glisser pour changer la priorité. Au clavier : Alt et flèche gauche ou droite.",
  announcement = "",
  onShift,
  onWheelZoom,
  onBarDrag,
  onBarDrop,
  dragPreview,
  rowDrop,
}: {
  label: string;
  /** Choix du regroupement (« Par produit », « Par personne »), à gauche de la barre du planning. */
  groups?: {
    label: string;
    value: string;
    options: readonly { value: string; label: string }[];
    onChange: (value: string) => void;
  };
  /** Date de départ du calcul, à droite de la barre. */
  start?: { label: string; title?: string; value: string; onChange: (value: string) => void };
  /** Colonne de gauche (`TimelineBacklog`). */
  aside?: ReactNode;
  period: { label: string; onPrevious: () => void; onToday: () => void; onNext: () => void };
  zoom: {
    label: string;
    value: number;
    levels: readonly { value: number; label: string }[];
    onChange: (value: number) => void;
  };
  legend?: typeof defaultLegend;
  /** Jours affichés, au format AAAA-MM-JJ, consécutifs. */
  dates: readonly string[];
  today: string;
  /** En-tête de la colonne des noms : « Personnes ». */
  firstColumn: string;
  items: readonly TimelineItem[];
  busy?: boolean;
  dragHelp?: string;
  announcement?: string;
  /** Décale la période affichée de `days` jours (glisser le fond, molette). */
  onShift: (days: number) => void;
  /** Ctrl+molette : un cran de zoom (`1` vers plus de jours), autour de la position `ratio` (0 à 1) du pointeur. */
  onWheelZoom?: (direction: 1 | -1, ratio: number) => void;
  /** Glisser en cours d’une barre, pour l’aperçu ; `undefined` à la fin. */
  onBarDrag?: (drag: TimelineDrag | undefined) => void;
  /** Barre déposée sur sa ligne, décalée de `shiftDays` jours (fractions comprises). */
  onBarDrop?: (key: string, shiftDays: number) => void;
  /** Encadré qui suit le pointeur pendant le glisser d’une barre. */
  dragPreview?: { heading: string; title: string; detail: string; valid: boolean; x: number; y: number };
  /** Dépôt sur la ligne d’une personne d’un objet glissé depuis `TimelineBacklog` (même `type`). */
  rowDrop?: { type: string; onDrop: (personId: string, id: string) => void };
}) {
  const days = dates.length;
  const first = dates[0] ?? today;
  const viewport = useRef<HTMLDivElement>(null);
  const pan = useRef<{ id: number; x: number; width: number; moved: number } | undefined>(undefined);
  const [panning, setPanning] = useState(false);
  const lastWheelZoom = useRef(0);
  const wheelPan = useRef(0);
  const [dropTarget, setDropTarget] = useState<string>();
  const drag = useBarDrag(onBarDrag, onBarDrop);
  const shift = useRef(onShift);
  shift.current = onShift;
  const zoomRef = useRef(onWheelZoom);
  zoomRef.current = onWheelZoom;

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      const rect = node.querySelector(".atom-timeline__track")?.getBoundingClientRect();
      const width = rect?.width || Math.max(1, node.clientWidth - 155);
      if (event.ctrlKey) {
        event.preventDefault();
        if (Date.now() - lastWheelZoom.current < 100) return;
        lastWheelZoom.current = Date.now();
        const ratio = rect ? Math.max(0, Math.min(1, (event.clientX - rect.left) / width)) : 0.5;
        zoomRef.current?.(event.deltaY > 0 ? 1 : -1, ratio);
      } else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault();
        wheelPan.current += ((event.shiftKey ? event.deltaY : event.deltaX) * days) / width;
        const whole = Math.trunc(wheelPan.current);
        if (whole) {
          wheelPan.current -= whole;
          shift.current(whole);
        }
      }
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, [days]);

  const months = days >= 80;
  const headers: { start: string; count: number; label: string }[] = [];
  for (let index = 0; index < dates.length; ) {
    let next = Math.min(dates.length, index + 7);
    if (months) {
      next = index + 1;
      while (next < dates.length && dates[next].slice(0, 7) === dates[index].slice(0, 7)) next++;
    }
    headers.push({
      start: dates[index],
      count: next - index,
      label: months ? monthFormatter.format(dayOf(dates[index])) : formatDay(dates[index]),
    });
    index = next;
  }
  const todayIndex = dates.indexOf(today);
  const dropHandlers = (rowId: string, personId: string) =>
    rowDrop
      ? {
          onDragOver: (event: DragEvent<HTMLDivElement>) => {
            if (!event.dataTransfer.types.includes(rowDrop.type)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDropTarget(rowId);
          },
          onDragLeave: (event: DragEvent<HTMLDivElement>) => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
              setDropTarget((current) => (current === rowId ? undefined : current));
          },
          onDrop: (event: DragEvent<HTMLDivElement>) => {
            const id = event.dataTransfer.getData(rowDrop.type);
            setDropTarget(undefined);
            if (id) rowDrop.onDrop(personId, id);
          },
        }
      : {};

  return (
    <section className="atom-timeline-view" aria-label={label}>
      <style>{PLANNING_CSS}</style>
      {groups || start ? (
        <div className="atom-timeline__toolbar">
          {groups ? (
            <RadioButtonGroup
              label={groups.label}
              hideLabel
              orientation="horizontal"
              value={groups.value}
              onChange={(value) => {
                if (value) groups.onChange(value);
              }}
            >
              {groups.options.map((option) => (
                <RadioButtonGroup.Option key={option.value} value={option.value}>
                  {option.label}
                </RadioButtonGroup.Option>
              ))}
            </RadioButtonGroup>
          ) : null}
          {start ? (
            <label className="atom-timeline__start">
              {start.label}{" "}
              <input
                data-slot="bare-input"
                className="atom-timeline__date"
                type="date"
                title={start.title}
                value={start.value}
                required
                onChange={(event) => {
                  if (event.target.value && event.currentTarget.validity.valid) start.onChange(event.target.value);
                }}
              />
            </label>
          ) : null}
        </div>
      ) : null}
      <div className={`atom-timeline__layout${aside ? "" : " atom-timeline__layout--full"}`}>
        {aside}
        <div className="atom-timeline__plan">
          <div className="atom-timeline__head">
            <IconButton
              label="Période précédente"
              icon={<ChevronLeft size={16} aria-hidden="true" />}
              onPress={period.onPrevious}
            />
            <Button variant="subtle" size="sm" onPress={period.onToday}>
              Aujourd’hui
            </Button>
            <IconButton
              label="Période suivante"
              icon={<ChevronRight size={16} aria-hidden="true" />}
              onPress={period.onNext}
            />
            <span className="atom-timeline__range" aria-live="polite">
              {period.label}
            </span>
            <div className="atom-timeline__zoom">
              <RadioButtonGroup
                label={zoom.label}
                hideLabel
                orientation="horizontal"
                value={String(zoom.value)}
                onChange={(value) => {
                  if (value) zoom.onChange(Number(value));
                }}
              >
                {zoom.levels.map((level) => (
                  <RadioButtonGroup.Option key={level.value} value={String(level.value)}>
                    {level.label}
                  </RadioButtonGroup.Option>
                ))}
              </RadioButtonGroup>
            </div>
          </div>
          <ul className="atom-timeline__legend" aria-label="Légende du planning">
            <li>
              <i className="atom-timeline__legend-bar" aria-hidden="true" />
              {legend.bar}
            </li>
            <li>
              <i className="atom-timeline__legend-history" aria-hidden="true" />
              {legend.history}
            </li>
            <li>
              <i className="atom-timeline__legend-off" aria-hidden="true" />
              {legend.off}
            </li>
            <li>
              <i className="atom-timeline__legend-absence" aria-hidden="true" />
              {legend.absence}
            </li>
            <li>
              <i className="atom-timeline__legend-outside" aria-hidden="true" />
              {legend.outside}
            </li>
            <li>
              <i className="atom-timeline__legend-today" aria-hidden="true" />
              {legend.today}
            </li>
          </ul>
          <div
            className="atom-timeline__wrap"
            ref={viewport}
            onPointerDown={(event) => {
              const target = event.target as HTMLElement;
              if (event.button !== 0 || !target.closest(".atom-timeline__grid") || target.closest("button,input,select"))
                return;
              pan.current = {
                id: event.pointerId,
                x: event.clientX,
                moved: 0,
                width:
                  event.currentTarget.querySelector(".atom-timeline__track")?.getBoundingClientRect().width ||
                  Math.max(1, event.currentTarget.clientWidth - 155),
              };
              event.currentTarget.setPointerCapture(event.pointerId);
              setPanning(true);
            }}
            onPointerMove={(event) => {
              const current = pan.current;
              if (!current || current.id !== event.pointerId) return;
              const total = Math.round(((current.x - event.clientX) * days) / current.width);
              if (total !== current.moved) {
                shift.current(total - current.moved);
                current.moved = total;
              }
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
              pan.current = undefined;
              setPanning(false);
            }}
            onLostPointerCapture={() => {
              pan.current = undefined;
              setPanning(false);
            }}
          >
            <div
              className={`atom-timeline__grid${panning ? " is-panning" : ""}`}
              data-scale={months ? "months" : "days"}
              data-density={days > 28 ? "wide" : "normal"}
              data-view-start={first}
              style={{ "--atom-visible-days": days } as CSSProperties}
            >
              <div className="atom-timeline__week">{firstColumn}</div>
              {headers.map((header) => (
                <div
                  key={header.start}
                  className={`atom-timeline__week${months ? " atom-timeline__month" : ""}`}
                  style={{ gridColumn: `span ${header.count}` }}
                >
                  {header.count >= (months ? 14 : 4) ? header.label : ""}
                </div>
              ))}
              <div className="atom-timeline__day" />
              {dates.map((date) => (
                <div key={date} className="atom-timeline__day" aria-current={date === today ? "date" : undefined}>
                  {!months && (days <= 31 || dayOf(date).getUTCDay() === 1) ? Number(date.slice(-2)) : ""}
                </div>
              ))}
              {items.map((item) => {
                if (item.kind === "band")
                  return (
                    <div key={item.id} className="atom-timeline__band">
                      <Box size={16} aria-hidden="true" />
                      {item.label}
                    </div>
                  );
                if (item.kind === "empty")
                  return (
                    <div key={item.id} className="atom-timeline__full">
                      <EmptyState size="compact" title={item.text} />
                    </div>
                  );
                const target = dropTarget === item.id ? " is-drop-target" : "";
                return (
                  <Fragment key={item.id}>
                    <div className={`atom-timeline__label${target}`} {...dropHandlers(item.id, item.personId)}>
                      <span className="atom-timeline__avatar" aria-hidden="true">
                        {item.name
                          .trim()
                          .split(/\s+/)
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")
                          .toLocaleUpperCase()}
                      </span>
                      <span className="atom-timeline__label-text">
                        <strong>{item.name}</strong>
                        <LoadMeter value={item.load} label={`Charge de ${item.name}`} />
                      </span>
                    </div>
                    <div
                      className={`atom-timeline__track${target}`}
                      data-person={item.personId}
                      {...dropHandlers(item.id, item.personId)}
                    >
                      {dates.map((date, index) => {
                        const day = item.days[index];
                        const status = day?.status ?? "available";
                        return (
                          <span
                            key={date}
                            className={`atom-timeline__slot${date.endsWith("-01") ? " is-month-start" : ""}${dayOf(date).getUTCDay() === 1 ? " is-week-start" : ""}${status !== "available" ? ` is-${status}` : ""}`}
                            style={{ gridColumn: index + 1 }}
                            title={day?.title}
                          />
                        );
                      })}
                      {item.bars.map((bar) => (
                        <button
                          key={bar.id}
                          type="button"
                          className={`atom-timeline__bar${bar.history ? " atom-timeline__bar--history" : ""}${!bar.history && drag.drag?.key === bar.key ? " is-dragging" : ""}`}
                          data-timeline-bar={bar.history ? undefined : bar.key}
                          disabled={bar.disabled}
                          onPointerDown={(event) => {
                            if (!busy && !bar.history) drag.start(event, bar.key, days);
                          }}
                          onKeyDown={bar.history ? undefined : bar.onKeyDown}
                          onClick={(event) => {
                            if (event.detail > 0 && drag.suppressClick(bar.key)) return;
                            bar.onOpen?.();
                          }}
                          aria-describedby={bar.history ? undefined : "atom-timeline-drag-help"}
                          aria-label={bar.ariaLabel}
                          title={drag.drag ? undefined : bar.title}
                          style={{
                            gridColumn: `${bar.column + 1} / span ${bar.span}`,
                            marginLeft: `calc(${(bar.offset / bar.span) * 100}% + 1px)`,
                            width: `calc(${(bar.duration / bar.span) * 100}% - 2px)`,
                          }}
                        >
                          {bar.label}
                        </button>
                      ))}
                    </div>
                  </Fragment>
                );
              })}
              {todayIndex >= 0 ? (
                <span
                  className="atom-timeline__today-line"
                  role="img"
                  aria-label={`Aujourd’hui, ${formatDay(today)}`}
                  style={{ "--atom-today-position": (todayIndex + 0.5) / days } as CSSProperties}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <span id="atom-timeline-drag-help" className="sr-only">
        {dragHelp}
      </span>
      <span className="sr-only" role="status">
        {announcement}
      </span>
      {dragPreview ? (
        <div
          className="atom-timeline__preview"
          data-valid={dragPreview.valid}
          aria-hidden="true"
          style={{
            left: Math.min(dragPreview.x + 16, window.innerWidth - 256),
            top: Math.min(dragPreview.y + 16, window.innerHeight - 116),
          }}
        >
          <div className="atom-timeline__preview-heading">
            <GripVertical size={16} aria-hidden="true" />
            <strong>{dragPreview.heading}</strong>
          </div>
          <div className="atom-timeline__preview-title">{dragPreview.title}</div>
          <div className="atom-timeline__preview-detail">{dragPreview.detail}</div>
        </div>
      ) : null}
    </section>
  );
}

/** Glisser d’une barre sur sa ligne, comme `useProjectPlanningDrag` de OneApp. */
function useBarDrag(
  onDrag: ((drag: TimelineDrag | undefined) => void) | undefined,
  onDrop: ((key: string, shiftDays: number) => void) | undefined,
) {
  const [drag, setDrag] = useState<TimelineDrag>();
  const cleanup = useRef<(() => void) | undefined>(undefined);
  const suppressed = useRef<string | undefined>(undefined);
  const handlers = useRef({ onDrag, onDrop });
  handlers.current = { onDrag, onDrop };
  useEffect(() => () => cleanup.current?.(), []);
  const update = (next: TimelineDrag | undefined) => {
    setDrag(next);
    handlers.current.onDrag?.(next);
  };
  const start = (event: ReactPointerEvent<HTMLButtonElement>, key: string, days: number) => {
    if (!handlers.current.onDrop || event.button !== 0 || !event.isPrimary) return;
    cleanup.current?.();
    suppressed.current = undefined;
    const track = event.currentTarget.closest<HTMLElement>(".atom-timeline__track");
    const root = track?.closest(".atom-timeline__grid");
    if (!track || !root) return;
    const width = track.getBoundingClientRect().width;
    if (!width) return;
    const origin = { x: event.clientX, y: event.clientY };
    const pointerId = event.pointerId;
    let active = false;
    let shift: number | undefined;
    const move = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      if (!active && (pointer.clientX - origin.x) ** 2 + (pointer.clientY - origin.y) ** 2 >= ACTIVATION ** 2) {
        active = true;
        suppressed.current = key;
      }
      if (!active) return;
      pointer.preventDefault();
      const target = document
        .elementFromPoint(pointer.clientX, pointer.clientY)
        ?.closest<HTMLElement>(".atom-timeline__track");
      shift =
        target && root.contains(target) && target.dataset.person === track.dataset.person
          ? ((pointer.clientX - origin.x) * days) / width
          : undefined;
      update({ key, shiftDays: shift ?? 0, x: pointer.clientX, y: pointer.clientY, valid: shift !== undefined });
    };
    const reset = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("blur", reset);
      update(undefined);
      cleanup.current = undefined;
    };
    const finish = (pointer: PointerEvent) => {
      if (pointer.pointerId !== pointerId) return;
      move(pointer);
      reset();
      if (active && shift !== undefined) handlers.current.onDrop?.(key, shift);
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
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", keydown);
    window.addEventListener("blur", reset);
  };
  return { drag, start, suppressClick: (key: string) => suppressed.current === key };
}

/** Styles de la vue, repris de OneApp (src/components/projects/projects.css) ; jetons de DESIGN.md seulement. */
/** Charge d’une personne (planning et tableau des équipes). */
export const CHARGE_CSS = `/* Charge d’une personne. */
.atom-load {
  display: flex;
  align-items: center;
  gap: 6px;
}
.atom-load__meter {
  width: 64px;
  height: 2px;
  flex: none;
  background: color-mix(in oklch, var(--fg-2) 45%, transparent);
}
.atom-load small {
  color: var(--fg-2);
  font-size: var(--fs-xs);
}
.atom-load.is-high small {
  color: var(--warning);
}
.atom-load.is-over small {
  color: var(--danger);
}

`;
export const PLANNING_CSS = `/* Planning : mesures reprises de OneApp (src/components/projects/projects.css, .oa-planning-layout et .oa-grid). */
.atom-timeline-view {
  /* Pleine largeur, comme le planning de OneApp : la marge de la page est reprise par la barre et la grille. */
  flex: 1;
  min-height: 0;
  margin: -16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--fg);
}
.atom-timeline__toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 12px 16px;
}
.atom-timeline__start {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-2);
  font-size: var(--fs-sm);
  white-space: nowrap;
}
.atom-timeline__date {
  height: 28px;
  padding: 0 8px;
  border: 1px solid var(--line-strong, var(--line));
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--fg);
  font: inherit;
  font-size: var(--fs-md);
}
.atom-timeline__date:focus-visible {
  outline: 2px solid var(--accent, var(--accent));
  outline-offset: 1px;
}
.atom-timeline__layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 224px minmax(0, 1fr);
}
.atom-timeline__layout--full {
  grid-template-columns: minmax(0, 1fr);
}
.atom-timeline__plan {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0 16px 16px;
}
.atom-timeline__head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin: 0 0 12px;
}
.atom-timeline__range {
  min-width: 170px;
  margin-left: 8px;
  font-size: var(--fs-md);
  font-weight: 600;
}
.atom-timeline__zoom {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
}
.atom-timeline__legend {
  flex-shrink: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
  color: var(--fg-2);
  font-size: var(--fs-xs);
}
.atom-timeline__legend > li {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.atom-timeline__legend i {
  width: 12px;
  height: 12px;
  border: 1px solid var(--line);
  border-radius: 2px;
}
.atom-timeline__legend .atom-timeline__legend-bar {
  background: var(--accent);
}
.atom-timeline__legend .atom-timeline__legend-history {
  border-color: var(--accent);
  border-style: dashed;
  background: var(--surface);
}
.atom-timeline__legend .atom-timeline__legend-off {
  background: var(--surface-raised);
}
.atom-timeline__legend .atom-timeline__legend-absence {
  background: var(--surface-side);
}
.atom-timeline__legend .atom-timeline__legend-outside,
.atom-timeline__slot.is-outside-presence {
  background: repeating-linear-gradient(135deg, transparent 0 4px, var(--line) 4px 5px);
}
.atom-timeline__legend .atom-timeline__legend-today {
  width: 2px;
  border: 0;
  border-radius: 0;
  background: var(--danger);
}
.atom-timeline__wrap {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
}
.atom-timeline__grid {
  position: relative;
  display: grid;
  grid-template-columns: 155px repeat(var(--atom-visible-days, 28), minmax(0, 1fr));
  min-width: 0;
  border-top: 1px solid var(--line);
  cursor: grab;
  user-select: none;
}
.atom-timeline__grid.is-panning {
  cursor: grabbing;
}
.atom-timeline__week {
  padding: 8px 2px;
  border-bottom: 1px solid var(--line);
  color: var(--fg-2);
  font-size: var(--fs-xs);
  text-align: center;
}
.atom-timeline__month {
  overflow: hidden;
  white-space: nowrap;
}
.atom-timeline__day {
  padding: 4px 0;
  background: var(--surface-raised);
  color: var(--fg-2);
  font-size: var(--fs-xs);
  text-align: center;
}
.atom-timeline__day[aria-current="date"] {
  color: var(--danger);
  font-weight: 600;
}
.atom-timeline__band {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 8px;
  border-bottom: 1px solid var(--line);
  background: var(--surface-raised);
  font-weight: 600;
}
.atom-timeline__full {
  grid-column: 1 / -1;
}
.atom-timeline__label {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 8px;
  border-bottom: 1px solid var(--line);
  font-size: var(--fs-sm);
  overflow-wrap: anywhere;
}
.atom-timeline__avatar {
  width: 24px;
  height: 24px;
  flex: none;
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
  background: var(--surface-side);
  color: var(--accent);
  font-size: var(--fs-xs);
  font-weight: 600;
}
.atom-timeline__label-text {
  min-width: 0;
  display: grid;
  gap: 4px;
}
.atom-timeline__label-text strong {
  font-weight: 600;
}
.atom-timeline__track {
  position: relative;
  grid-column: span var(--atom-visible-days, 28);
  display: grid;
  grid-template-columns: repeat(var(--atom-visible-days, 28), minmax(0, 1fr));
  align-items: stretch;
  gap: 0;
  min-height: 68px;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
}
.atom-timeline__label.is-drop-target,
.atom-timeline__track.is-drop-target {
  outline: 1px dashed var(--accent);
  outline-offset: -1px;
  background: color-mix(in oklch, var(--accent) 12%, transparent);
}
.atom-timeline__slot {
  grid-row: 1;
  min-width: 0;
  border-left: 1px solid var(--line);
}
.atom-timeline__slot.is-absence {
  background: var(--surface-side);
}
.atom-timeline__slot.is-non-working {
  background: var(--surface-raised);
}
.atom-timeline__grid[data-density="wide"] .atom-timeline__slot,
.atom-timeline__grid[data-scale="months"] .atom-timeline__slot {
  border-left: 0;
}
.atom-timeline__grid[data-density="wide"] .atom-timeline__slot.is-week-start {
  border-left: 1px solid var(--line);
}
.atom-timeline__grid[data-scale="months"] .atom-timeline__slot.is-week-start {
  border-left: 0;
}
.atom-timeline__grid[data-scale="months"] .atom-timeline__slot.is-month-start {
  border-left: 1px solid var(--line);
}
.atom-timeline__bar {
  z-index: 1;
  grid-row: 1;
  align-self: center;
  min-width: 0;
  min-height: 30px;
  margin: 0 1px;
  padding: 6px 4px;
  overflow: hidden;
  border: 0;
  border-radius: 3px;
  background: var(--accent);
  color: var(--accent-fg);
  font: inherit;
  font-size: var(--fs-sm);
  text-align: center;
  white-space: nowrap;
  cursor: grab;
  touch-action: none;
}
.atom-timeline__bar:hover {
  opacity: 0.85;
}
.atom-timeline__bar:focus-visible {
  outline: 2px solid var(--accent, var(--accent));
  outline-offset: 1px;
}
.atom-timeline__bar:disabled {
  cursor: default;
}
.atom-timeline__bar--history,
.atom-timeline__bar--history:hover {
  border: 1px dashed var(--accent);
  background: var(--surface);
  color: var(--fg);
  opacity: 1;
}
.atom-timeline__bar.is-dragging {
  z-index: 4;
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  opacity: 0.55;
  cursor: grabbing;
}
.atom-timeline__grid[data-scale="months"] .atom-timeline__bar {
  min-width: 2px;
  padding: 0;
  border-radius: 1px;
  font-size: 0;
}
.atom-timeline__grid[data-scale="months"] .atom-timeline__day {
  height: 8px;
  padding: 0;
}
.atom-timeline__today-line {
  position: absolute;
  z-index: 3;
  top: 32px;
  bottom: 0;
  left: calc(155px + (100% - 155px) * var(--atom-today-position));
  width: 2px;
  background: var(--danger);
  pointer-events: none;
}
.atom-timeline__today-line::before {
  position: absolute;
  top: 0;
  left: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
  content: "";
}
.atom-timeline__preview {
  position: fixed;
  z-index: 1000;
  width: 240px;
  padding: 12px 14px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-lg);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  color: var(--fg);
  pointer-events: none;
  user-select: none;
}
.atom-timeline__preview[data-valid="false"] {
  border-color: var(--line);
}
.atom-timeline__preview-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
  font-size: var(--fs-sm);
}
.atom-timeline__preview-title {
  margin: 6px 0;
  overflow: hidden;
  font-size: var(--fs-md);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.atom-timeline__preview-detail {
  color: var(--fg-2);
  font-size: var(--fs-xs);
}

/* Colonne des objets à planifier. */
.atom-timeline-backlog {
  min-height: 0;
  overflow: auto;
  padding: 12px 10px;
  border-right: 1px solid var(--line);
}
.atom-timeline-backlog h3 {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
}
.atom-timeline-backlog h3 span {
  color: var(--fg-2);
  font-weight: 400;
}
.atom-timeline-backlog p {
  margin: 2px 0 10px;
  color: var(--fg-2);
  font-size: var(--fs-xs);
}
.atom-timeline-backlog__action.atom-timeline-backlog__action {
  width: 100%;
  margin-bottom: 12px;
}
.atom-timeline-backlog ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.atom-timeline-backlog li {
  display: grid;
  gap: 2px;
  cursor: grab;
}
.atom-timeline-backlog li:active {
  cursor: grabbing;
}
.atom-timeline-backlog li > button {
  width: 100%;
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--fg);
  font: inherit;
  font-size: var(--fs-sm);
  text-align: left;
  cursor: pointer;
}
.atom-timeline-backlog li > button:hover:not(:disabled) {
  background: var(--surface-side);
}
.atom-timeline-backlog__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--fg-2);
  font-size: var(--fs-xs);
}
.atom-timeline-backlog__meta i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent, var(--fg-2));
}
.atom-timeline-backlog__meta small {
  margin-left: auto;
}
.atom-timeline-backlog__assign {
  justify-self: end;
  height: 22px;
  padding: 0 4px;
  border: 0;
  background: transparent;
  color: var(--fg-2);
  font: inherit;
  font-size: var(--fs-xs);
  cursor: pointer;
}

@media (forced-colors: active) {
  .atom-timeline__bar {
    forced-color-adjust: none;
    background: Highlight;
    color: HighlightText;
  }
  .atom-timeline__bar--history,
  .atom-timeline__bar--history:hover {
    border-color: ButtonText;
    background: Canvas;
    color: ButtonText;
  }
  .atom-timeline__slot.is-absence {
    border: 1px dashed CanvasText;
  }
}
` + CHARGE_CSS;
