import { Text } from "@alfred/kit";
import { StatusBadge } from "socle-ui";

type Ton = "neutral" | "warning" | "success" | "danger";

/** Étiquette d’état, pour une case de tableau. */
export function badge(libelle: string, ton: Ton) {
  if (!libelle) return <Text as="span" tone="muted">—</Text>;
  return <StatusBadge tone={ton}>{libelle}</StatusBadge>;
}

/** Texte secondaire d’une cellule (« il y a 3 h », un projet). */
export function discret(texte: string | null | undefined) {
  return (
    <Text as="span" tone="muted">
      {texte || "—"}
    </Text>
  );
}

/** Ton d’une catégorie d’état Jira. */
export function tonCategorie(categorie: string): Ton {
  if (categorie === "done") return "success";
  if (categorie === "indeterminate") return "warning";
  return "neutral";
}

/** Ton d’une priorité Jira, d’après son nom (français ou anglais). */
export function tonPriorite(priorite: string): Ton {
  const p = priorite.toLocaleLowerCase("fr");
  if (/(critique|bloquant|blocker|critical|highest|majeur)/.test(p)) return "danger";
  if (/(haute|high|élevée|elevee)/.test(p)) return "warning";
  return "neutral";
}

/** Date relative courte, en français. */
export function quand(valeur: string | number | null | undefined): string {
  if (valeur === null || valeur === undefined || valeur === "") return "—";
  const date = new Date(valeur);
  if (Number.isNaN(date.getTime())) return "—";
  const ecart = Math.round((Date.now() - date.getTime()) / 1000);
  if (ecart < 60) return "à l’instant";
  if (ecart < 3600) return `il y a ${Math.round(ecart / 60)} min`;
  if (ecart < 86400) return `il y a ${Math.round(ecart / 3600)} h`;
  if (ecart < 86400 * 7) return `il y a ${Math.round(ecart / 86400)} j`;
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(date);
}
