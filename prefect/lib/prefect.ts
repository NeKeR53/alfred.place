import { type FormSpec } from "@alfred/ui";
import { functions } from "@alfred/sdk";

export type Ton = "neutral" | "warning" | "success" | "danger";

export interface Compte {
  id: string;
  label: string;
  default: boolean;
}

export interface Deploiement {
  id: string;
  nom: string;
  flux: string;
  fluxId?: string;
  description: string | null;
  tags: string[];
  pool: string | null;
  enPause: boolean;
  statut: string | null;
  planifications: string[];
  parametres: Record<string, unknown>;
  schemaParametres: { properties?: Record<string, ProprieteSchema>; required?: string[] } | null;
  misAJour: string | null;
}

interface ProprieteSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  format?: string;
  position?: number;
}

export interface Execution {
  id: string;
  nom: string;
  deploiementId: string | null;
  deploiement?: string | null;
  flux?: string;
  etat: string;
  etatNom: string;
  message: string | null;
  debutPrevu: string | null;
  debut: string | null;
  fin: string | null;
  duree: number | null;
  parametres?: Record<string, unknown>;
}

export interface EtatDeploiement {
  id: string;
  erreur: string | null;
  dernier: Execution | null;
  recentes: { id: string; nom: string; etat: string; etatNom: string; debut: string | null }[];
  enCours: number;
  dureeHabituelle: number | null;
  prochaine: { id: string; nom: string; debutPrevu: string | null } | null;
}

export const ETATS: Record<string, { label: string; tone: Ton }> = {
  COMPLETED: { label: "Réussie", tone: "success" },
  FAILED: { label: "En échec", tone: "danger" },
  CRASHED: { label: "Plantée", tone: "danger" },
  RUNNING: { label: "En cours", tone: "warning" },
  PENDING: { label: "En attente", tone: "warning" },
  CANCELLING: { label: "Annulation…", tone: "warning" },
  SCHEDULED: { label: "Planifiée", tone: "neutral" },
  CANCELLED: { label: "Annulée", tone: "neutral" },
  PAUSED: { label: "En pause", tone: "neutral" },
};

export const ACTIFS = new Set(["RUNNING", "PENDING", "CANCELLING"]);

/** État affiché d’une exécution : « Late » et « AwaitingRetry » ont leur propre libellé. */
export function etatAffiche(etat: string | undefined, nom?: string | null): { label: string; tone: Ton } {
  if (!etat) return { label: "Jamais lancé", tone: "neutral" };
  if (etat === "SCHEDULED" && nom === "Late") return { label: "En retard", tone: "warning" };
  if (etat === "SCHEDULED" && nom === "AwaitingRetry") return { label: "Nouvel essai prévu", tone: "warning" };
  if (etat === "RUNNING" && nom === "Retrying") return { label: "Nouvel essai", tone: "warning" };
  if (etat === "COMPLETED" && nom === "Cached") return { label: "Réussie (cache)", tone: "success" };
  return ETATS[etat] ?? { label: nom || "Inconnu", tone: "neutral" };
}

export function duree(secondes: number | null | undefined): string {
  if (secondes === null || secondes === undefined || secondes <= 0) return "—";
  const s = Math.round(secondes);
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return s % 60 === 0 ? `${minutes} min` : `${minutes} min ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

const FORMAT_DATE = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const FORMAT_HEURE = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export const dateCourte = (iso: string | null | undefined) => (iso ? FORMAT_DATE.format(new Date(iso)) : "—");
export const heure = (iso: string) => FORMAT_HEURE.format(new Date(iso));

export const nomComplet = (d: { flux?: string | null; nom: string }) => (d.flux ? `${d.flux} / ${d.nom}` : d.nom);

export const planification = (d: Deploiement) =>
  d.planifications.length > 0 ? d.planifications.join(" · ") : "Lancement à la demande";

/** Résumé des exécutions récentes : « 6 réussies, 1 en échec ». */
export function resume(recentes: { etat: string; etatNom?: string }[]): string {
  const compte = new Map<string, number>();
  for (const r of recentes) {
    const label = etatAffiche(r.etat, r.etatNom).label.toLowerCase();
    compte.set(label, (compte.get(label) ?? 0) + 1);
  }
  return [...compte].map(([label, n]) => `${n} ${n > 1 && label.endsWith("e") ? `${label}s` : label}`).join(", ");
}

/** « instance|deploiement » ↔ sélection publiée au panneau. */
export const cleSelection = (instance: string, deploiement: string) => `${instance}|${deploiement}`;
export function lireSelection(texte: string): { instance: string; deploiement: string } {
  const i = texte.indexOf("|");
  return i < 0 ? { instance: "", deploiement: texte } : { instance: texte.slice(0, i), deploiement: texte.slice(i + 1) };
}

export const avecInstance = (instance: string) => (instance ? { instance } : {});

export const lancer = (instance: string, deploiement: string, parametres?: Record<string, unknown>) =>
  functions.call<{ lance: boolean; execution: { id: string; nom: string } }>("lancer-deploiement", {
    ...avecInstance(instance),
    deploiement,
    ...(parametres ? { parametres } : {}),
  });

// ——— Formulaire « Lancer avec d’autres paramètres » ———

const typeDe = (p: ProprieteSchema) => (Array.isArray(p.type) ? p.type.find((t) => t !== "null") : p.type);
const simple = (p: ProprieteSchema) => ["string", "integer", "number", "boolean"].includes(typeDe(p) ?? "");

const enTexte = (valeur: unknown) =>
  valeur === undefined || valeur === null ? "" : typeof valeur === "object" ? JSON.stringify(valeur, null, 2) : String(valeur);

export function aDesParametres(d: Deploiement): boolean {
  return Object.keys(d.schemaParametres?.properties ?? {}).length > 0 || Object.keys(d.parametres).length > 0;
}

export function formulaireParametres(d: Deploiement, instance: string, apres: () => void): FormSpec {
  const proprietes = Object.entries(d.schemaParametres?.properties ?? {}).sort(
    ([, a], [, b]) => (a.position ?? 0) - (b.position ?? 0),
  );
  const parChamp = proprietes.length > 0 && proprietes.length <= 6 && proprietes.every(([, p]) => simple(p));

  if (!parChamp) {
    return {
      title: "Lancer avec d’autres paramètres",
      description: `${nomComplet(d)} : les paramètres en JSON. Ceux que vous retirez gardent leur valeur par défaut.`,
      fields: [{ name: "json", label: "Paramètres (JSON)", type: "textarea" }],
      initial: { json: JSON.stringify(d.parametres, null, 2) },
      submitLabel: "Lancer",
      success: "Exécution lancée",
      onSubmit: async (v) => {
        let parametres: Record<string, unknown>;
        try {
          parametres = JSON.parse(v.json || "{}");
        } catch {
          throw new Error("Le JSON des paramètres n’est pas valide.");
        }
        await lancer(instance, d.id, parametres);
        apres();
      },
    };
  }

  const fields = proprietes.map(([nom, p]) => {
    const type = typeDe(p);
    const base = { name: nom, label: p.title || nom, hint: p.description, optional: true };
    if (type === "boolean") return { ...base, type: "checkbox" as const };
    if (p.enum?.length) return { ...base, type: "select" as const, options: p.enum.map((e) => ({ value: String(e), label: String(e) })) };
    if (type === "integer" || type === "number") return { ...base, type: "number" as const };
    if (p.format === "date") return { ...base, type: "date" as const };
    return base;
  });
  const initial: Record<string, string> = {};
  for (const [nom, p] of proprietes) {
    const valeur = nom in d.parametres ? d.parametres[nom] : p.default;
    initial[nom] = typeDe(p) === "boolean" ? (valeur ? "1" : "0") : enTexte(valeur);
  }

  return {
    title: "Lancer avec d’autres paramètres",
    description: `${nomComplet(d)} : un champ laissé vide garde sa valeur par défaut.`,
    fields,
    initial,
    submitLabel: "Lancer",
    success: "Exécution lancée",
    onSubmit: async (v) => {
      const parametres: Record<string, unknown> = {};
      for (const [nom, p] of proprietes) {
        const brut = v[nom] ?? "";
        const type = typeDe(p);
        if (type === "boolean") parametres[nom] = brut === "1";
        else if (brut === "") continue;
        else if (type === "integer" || type === "number") parametres[nom] = Number(brut.replace(",", "."));
        else parametres[nom] = brut;
      }
      await lancer(instance, d.id, parametres);
      apres();
    },
  };
}
