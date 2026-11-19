import { db, functions } from "@alfred/sdk";

export interface Vue {
  id: string;
  nom: string;
  position: number;
}

export interface Carte {
  id: string;
  vue_id: string;
  instance: string;
  job: string;
  position: number;
}

export interface Build {
  numero: number;
  resultat: string | null;
  enCours: boolean;
  debut: string | null;
  duree: number | null;
  dureeEstimee: number | null;
  url: string | null;
}

export interface EtatJob {
  chemin: string;
  nom: string;
  url: string | null;
  existe: boolean;
  erreur: string | null;
  desactive: boolean;
  enFile: boolean;
  parametre: boolean;
  dernier: Build | null;
  dernierTermine: { numero: number; resultat: string | null; debut: string | null; duree: number | null } | null;
}

export interface Compte {
  id: string;
  label: string;
  default: boolean;
}

export interface JobTrouve {
  chemin: string;
  nom: string;
  dossier: string;
  etat: string;
  url: string;
}

export type Ton = "neutral" | "warning" | "success" | "danger";

export const RESULTATS: Record<string, { label: string; tone: Ton }> = {
  SUCCESS: { label: "Réussi", tone: "success" },
  FAILURE: { label: "En échec", tone: "danger" },
  UNSTABLE: { label: "Instable", tone: "warning" },
  ABORTED: { label: "Annulé", tone: "neutral" },
  NOT_BUILT: { label: "Non construit", tone: "neutral" },
};

/** État affiché d’un job : libellé et ton. */
export function etatAffiche(etat: EtatJob | undefined): { label: string; tone: Ton } {
  if (!etat) return { label: "Chargement…", tone: "neutral" };
  if (!etat.existe) return { label: "Introuvable", tone: "danger" };
  if (etat.erreur) return { label: "Illisible", tone: "warning" };
  if (etat.dernier?.enCours) return { label: "En cours", tone: "warning" };
  if (etat.enFile) return { label: "En file d’attente", tone: "neutral" };
  if (etat.desactive) return { label: "Désactivé", tone: "neutral" };
  if (!etat.dernier) return { label: "Jamais lancé", tone: "neutral" };
  return RESULTATS[etat.dernier.resultat ?? ""] ?? { label: "Inconnu", tone: "neutral" };
}

/** Couleur Jenkins (blue, red_anime…) → état affiché dans la recherche. */
export function etatCouleur(couleur: string): { label: string; tone: Ton } {
  if (couleur.endsWith("_anime")) return { label: "En cours", tone: "warning" };
  if (couleur === "blue" || couleur === "green") return RESULTATS.SUCCESS;
  if (couleur === "red") return RESULTATS.FAILURE;
  if (couleur === "yellow") return RESULTATS.UNSTABLE;
  if (couleur === "aborted") return RESULTATS.ABORTED;
  if (couleur === "disabled") return { label: "Désactivé", tone: "neutral" };
  return { label: "Jamais lancé", tone: "neutral" };
}

export function duree(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "—";
  const secondes = Math.round(ms / 1000);
  if (secondes < 60) return `${secondes} s`;
  const minutes = Math.floor(secondes / 60);
  if (minutes < 60) return `${minutes} min ${String(secondes % 60).padStart(2, "0")} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}

export function nomCourt(chemin: string): string {
  const morceaux = chemin.split("/");
  return decodeURIComponent(morceaux[morceaux.length - 1] ?? chemin);
}

export function dossierDe(chemin: string): string {
  return chemin
    .split("/")
    .slice(0, -1)
    .map((morceau) => decodeURIComponent(morceau))
    .join(" / ");
}

export const cleEtat = (instance: string, job: string) => `${instance}\u0000${job}`;

/** États de toutes les cartes, lus compte par compte. */
export async function lireEtats(cartes: Carte[]): Promise<Map<string, EtatJob>> {
  const parCompte = new Map<string, string[]>();
  for (const carte of cartes) parCompte.set(carte.instance, [...(parCompte.get(carte.instance) ?? []), carte.job]);
  const etats = new Map<string, EtatJob>();
  await Promise.all(
    [...parCompte].map(async ([instance, jobs]) => {
      const { jobs: lus } = await functions.call<{ jobs: EtatJob[] }>("lire-etats-jobs", {
        ...(instance ? { instance } : {}),
        jobs: [...new Set(jobs)],
      });
      for (const etat of lus) etats.set(cleEtat(instance, etat.chemin), etat);
    }),
  );
  return etats;
}

export const lireVues = () => db.query<Vue>("SELECT id, nom, position FROM jenkins_vues ORDER BY position, cree_le");

export const lireCartes = (vue: string) =>
  db.query<Carte>(
    "SELECT id, vue_id, instance, job, position FROM jenkins_cartes WHERE vue_id = ? ORDER BY position, ajoute_le",
    [vue],
  );

export async function creerVue(nom: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.execute(
    "INSERT INTO jenkins_vues (id, nom, position) VALUES (?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM jenkins_vues))",
    [id, nom.trim()],
  );
  return id;
}

export const renommerVue = (id: string, nom: string) =>
  db.execute("UPDATE jenkins_vues SET nom = ? WHERE id = ?", [nom.trim(), id]);

export const supprimerVue = (id: string) => db.execute("DELETE FROM jenkins_vues WHERE id = ?", [id]);

export async function ajouterCartes(vue: string, instance: string, jobs: string[]) {
  for (const job of jobs)
    await db.execute(
      `INSERT OR IGNORE INTO jenkins_cartes (id, vue_id, instance, job, position)
       VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM jenkins_cartes WHERE vue_id = ?))`,
      [crypto.randomUUID(), vue, instance, job, vue],
    );
}

export const retirerCarte = (id: string) => db.execute("DELETE FROM jenkins_cartes WHERE id = ?", [id]);

export async function deplacerCarte(carte: Carte, vue: string) {
  await db.execute("DELETE FROM jenkins_cartes WHERE vue_id = ? AND instance = ? AND job = ?", [vue, carte.instance, carte.job]);
  await db.execute(
    "UPDATE jenkins_cartes SET vue_id = ?, position = (SELECT COALESCE(MAX(position), -1) + 1 FROM jenkins_cartes WHERE vue_id = ?) WHERE id = ?",
    [vue, vue, carte.id],
  );
}

export async function enregistrerOrdre(ids: string[]) {
  await Promise.all(ids.map((id, position) => db.execute("UPDATE jenkins_cartes SET position = ? WHERE id = ?", [position, id])));
}

/** Toutes les cartes de toutes les vues : leurs états se lisent en un seul lot. */
export const lireToutesCartes = () =>
  db.query<Carte>("SELECT id, vue_id, instance, job, position FROM jenkins_cartes ORDER BY position, ajoute_le");

/** Nombre de jobs suivis (comptés une fois) dont un build tourne ou attend en file. */
export function compterEnCours(etats: Map<string, EtatJob>): number {
  return [...etats.values()].filter((etat) => etat.dernier?.enCours || etat.enFile).length;
}
