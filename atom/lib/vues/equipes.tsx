/**
 * Liste de choix à gauche (210 px) et contenu à droite, pleine hauteur, repris des Équipes de OneApp
 * (`ProjectTeams`, `.oa-teamnav`) : un bouton pressé par élément avec son nombre, puis un bouton en pointillé qui
 * ouvre la saisie d’un nouvel élément (Entrée crée, Échap renonce). Le contenu porte son propre en-tête.
 */
import { type ReactNode, useState } from "react";
import { Button } from "socle-ui";
import { CHARGE_CSS } from "./planning";

export function SideNav({
  label,
  items,
  selected,
  onSelect,
  create,
  children,
}: {
  label: string;
  items: readonly { id: string; label: string; count?: number }[];
  selected?: string;
  onSelect: (id: string) => void;
  /** Création d’un élément : libellé du bouton (« + Nouvelle équipe »), du champ et de la validation. */
  create?: { label: string; field: string; placeholder: string; submit: string; onCreate: (name: string) => void };
  children: ReactNode;
}) {
  const [creating, setCreating] = useState(false);
  const editing = create && (creating || !items.length);
  return (
    <div className="atom-side-nav">
      <style>{EQUIPES_CSS + CHARGE_CSS}</style>
      <nav className="atom-side-nav__list" aria-label={label}>
        {items.map((item) => (
          <button
            type="button"
            key={item.id}
            className="atom-side-nav__item"
            aria-pressed={item.id === selected}
            onClick={() => onSelect(item.id)}
          >
            {item.label} {item.count === undefined ? null : <span className="atom-side-nav__count">{item.count}</span>}
          </button>
        ))}
        {create && editing ? (
          <form
            className="atom-side-nav__form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const name = String(new FormData(form).get("name") ?? "").trim();
              if (!name) return;
              create.onCreate(name);
              setCreating(false);
              form.reset();
            }}
          >
            <input
              data-slot="bare-input"
              className="atom-side-nav__input"
              aria-label={create.field}
              name="name"
              required
              maxLength={50}
              placeholder={create.placeholder}
              // biome-ignore lint/a11y/noAutofocus: la saisie s’ouvre à la demande de l’utilisateur.
              autoFocus={creating}
              onKeyDown={(event) => {
                if (event.key === "Escape") setCreating(false);
              }}
            />
            <Button type="submit" variant="subtle" size="sm">
              {create.submit}
            </Button>
          </form>
        ) : create ? (
          <button type="button" className="atom-side-nav__new" onClick={() => setCreating(true)}>
            {create.label}
          </button>
        ) : null}
      </nav>
      <div className="atom-side-nav__content">{children}</div>
    </div>
  );
}

/** En-tête du contenu d’une `SideNav` : titre, commandes qui le suivent (`children`), puis `end` poussé à droite. */
export function SideNavHeader({ title, children, end }: { title: string; children?: ReactNode; end?: ReactNode }) {
  return (
    <header className="atom-side-nav__head">
      <h3>{title}</h3>
      {children}
      {end ? <div className="atom-side-nav__end">{end}</div> : null}
    </header>
  );
}

/** Styles de la vue, repris de OneApp (src/components/projects/projects.css) ; jetons de DESIGN.md seulement. */
export const EQUIPES_CSS = `/* Liste à gauche et contenu : mesures reprises de OneApp (.oa-teams, .oa-teamnav, .oa-members__head). */
.atom-side-nav {
  flex: 1;
  min-height: 0;
  margin: -16px;
  display: grid;
  grid-template-columns: 210px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  align-items: stretch;
  overflow: hidden;
}
.atom-side-nav__list {
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding: 12px 10px;
  border-right: 1px solid var(--line);
}
.atom-side-nav__list > * {
  flex-shrink: 0;
}
.atom-side-nav__item {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 10px;
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg-2);
  font: inherit;
  font-size: var(--fs-md);
  text-align: left;
  cursor: pointer;
}
.atom-side-nav__item:hover {
  background: var(--hover);
  color: var(--fg);
}
.atom-side-nav__item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.atom-side-nav__item[aria-pressed="true"] {
  background: var(--surface-side);
  color: var(--fg);
  font-weight: 600;
}
.atom-side-nav__count {
  margin-left: auto;
  color: var(--fg-2);
  font-size: var(--fs-xs);
  font-weight: 400;
}
.atom-side-nav__new {
  height: 32px;
  margin-top: 8px;
  border: 1px dashed var(--line-strong, var(--line));
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--fg);
  font: inherit;
  font-size: var(--fs-md);
  cursor: pointer;
}
.atom-side-nav__new:hover {
  background: var(--surface-side);
}
.atom-side-nav__form {
  display: grid;
  gap: 6px;
  margin-top: 8px;
}
.atom-side-nav__input {
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--line-strong, var(--line));
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--fg);
  font: inherit;
  font-size: var(--fs-sm);
}
.atom-side-nav__content {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.atom-side-nav__head {
  min-height: 52px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  border-bottom: 1px solid var(--line);
}
.atom-side-nav__head h3 {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
}
.atom-side-nav__end {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
}
.atom-side-nav__end input {
  width: 200px;
}
`;
