import { type Entree, grafana, LIBELLES_DROITS, segment, verifier } from "../lib/grafana";

type Droit = { teamId?: number; team?: string; userId?: number; userLogin?: string; role?: string; permission: number };

// Droits d’un dossier : par équipe, par compte ou par rôle de l’organisation.
export default async function ({ instance, dossier }: Entree & { dossier: string }) {
  const lot = verifier<Droit[]>(await grafana(instance).get(`/api/folders/${segment(dossier)}/permissions`), "les droits du dossier");
  return {
    droits: lot.map((droit) => ({
      equipe: droit.teamId ? { id: droit.teamId, nom: droit.team ?? "" } : null,
      utilisateur: droit.userId ? { id: droit.userId, login: droit.userLogin ?? "" } : null,
      role: droit.role ?? null,
      droit: droit.permission,
      libelle: LIBELLES_DROITS[droit.permission] ?? `Droit ${droit.permission}`,
    })),
  };
}
