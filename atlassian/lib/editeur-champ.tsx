/** « 2026-11-17T14:30:00.000+0100 » ↔ « 2026-11-17T14:30 » (champ date et heure). */
export function versLocal(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}T${deux(date.getHours())}:${deux(date.getMinutes())}`;
}
export function versJira(saisie: string): string {
  if (!saisie) return "";
  const local = saisie.trim().replace(" ", "T");
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return saisie;
  const decalage = -date.getTimezoneOffset();
  const abs = Math.abs(decalage);
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${local}:00.000${decalage >= 0 ? "+" : "-"}${deux(Math.floor(abs / 60))}${deux(abs % 60)}`;
}
