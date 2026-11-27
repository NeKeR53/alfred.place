/**
 * Mois d’un calendrier de présence, repris de OneApp (`ProjectMemberCalendar`, `.oa-month-grid`) : semaines du lundi
 * au dimanche, un bouton par jour du mois, pressé quand le jour est marqué (absence) ; les jours non travaillés et
 * hors période sont grisés et désactivés. Un clic appelle `onToggle` avec la date (AAAA-MM-JJ).
 */

export type MonthDayState = "available" | "marked" | "non-working" | "outside";

const weekdayLabels = ["L", "M", "M", "J", "V", "S", "D"];
const plus = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

/** Jours affichés pour le mois de `date`, complétés pour former des semaines du lundi au dimanche. */
export function monthDays(date: string): { date: string; inMonth: boolean }[] {
  const month = date.slice(0, 7);
  const first = `${month}-01`;
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const days: { date: string; inMonth: boolean }[] = [];
  for (let current = plus(first, -lead); ; current = plus(current, 1)) {
    const inMonth = current.startsWith(month);
    if (!inMonth && current > first && days.length % 7 === 0) break;
    days.push({ date: current, inMonth });
  }
  return days;
}

export function MonthCalendar({
  legend,
  month,
  state,
  dayLabel,
  onToggle,
  disabled = false,
}: {
  /** Nom du groupe pour les lecteurs d’écran : « Absences de Léa Martin en novembre 2026 ». */
  legend: string;
  /** Un jour du mois affiché (AAAA-MM-JJ). */
  month: string;
  state: (date: string) => MonthDayState;
  /** Nom complet d’un jour : « lundi 17 novembre : absent ». */
  dayLabel: (date: string, state: MonthDayState) => string;
  onToggle: (date: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="atom-month">
      <style>{CALENDRIER_CSS}</style>
      <legend className="sr-only">{legend}</legend>
      {weekdayLabels.map((label, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: les initiales des jours se répètent ; leur rang est stable.
        <span key={index} className="atom-month__weekday" aria-hidden="true">
          {label}
        </span>
      ))}
      {monthDays(month).map(({ date, inMonth }) => {
        if (!inMonth) return <span key={date} aria-hidden="true" />;
        const current = state(date);
        return (
          <button
            key={date}
            type="button"
            className={`atom-month__day atom-month__day--${current}`}
            aria-pressed={current === "marked"}
            aria-label={dayLabel(date, current)}
            disabled={disabled || current === "non-working" || current === "outside"}
            onClick={() => onToggle(date)}
          >
            {Number(date.slice(-2))}
          </button>
        );
      })}
    </fieldset>
  );
}

/** Styles de la vue, repris de OneApp (src/components/projects/projects.css) ; jetons de DESIGN.md seulement. */
export const CALENDRIER_CSS = `/* Calendrier d’un mois : mesures reprises de OneApp (.oa-month-grid). */
.atom-month {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
  margin: 8px 0 12px;
  padding: 0;
  border: 0;
}
.atom-month__weekday {
  color: var(--fg-2);
  font-size: var(--fs-xs);
  text-align: center;
}
.atom-month__day {
  height: 30px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-raised);
  color: var(--fg);
  font: inherit;
  font-size: var(--fs-sm);
  font-weight: 600;
  cursor: pointer;
}
.atom-month__day:hover:not(:disabled, [aria-pressed="true"]) {
  background: var(--surface-side);
}
.atom-month__day:focus-visible {
  outline: 2px solid var(--accent, var(--accent));
  outline-offset: 1px;
}
.atom-month__day[aria-pressed="true"] {
  border-color: transparent;
  background: repeating-linear-gradient(
    -45deg,
    var(--surface-side) 0 4px,
    color-mix(in oklch, var(--fg-2) 30%, transparent) 4px 7px
  );
}
.atom-month__day:disabled {
  border-color: transparent;
  background: transparent;
  color: var(--fg-2);
  font-weight: 400;
  cursor: default;
}
`;
