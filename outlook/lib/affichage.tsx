import { StatusBadge, Text } from "@alfred/ui";

type Ton = "neutral" | "warning" | "success" | "danger";

/** Badge d’état compact, pour une cellule de tableau. */
export function badge(libelle: string, ton: Ton) {
  if (!libelle) return <Text as="span" tone="muted">—</Text>;
  return (
    <StatusBadge tone={ton} size="compact">
      {libelle}
    </StatusBadge>
  );
}

/** Texte secondaire d’une cellule (« il y a 3 h », un projet). */
export function discret(texte: string | null | undefined) {
  return (
    <Text as="span" tone="muted">
      {texte || "—"}
    </Text>
  );
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

/** Phrase compréhensible quand Outlook ne peut pas être piloté sur ce poste. */
export function raisonIndisponible(erreur: Error | undefined): string {
  const texte = erreur?.message ?? "";
  if (/powershell|pwsh|interpr/i.test(texte)) {
    return "Outlook se pilote depuis un PC Windows où l’application est installée. Sur cet ordinateur, la boîte ne peut pas être lue.";
  }
  if (/com|outlook/i.test(texte)) {
    return "Microsoft Outlook ne répond pas. Ouvrez l’application Outlook sur ce PC, puis actualisez la page.";
  }
  return "Outlook n’a pas pu être joint. Vérifiez que l’application est ouverte sur ce PC, puis actualisez la page.";
}
