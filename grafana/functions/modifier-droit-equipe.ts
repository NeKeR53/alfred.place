import { type Entree, grafana, segment, verifier } from "../lib/grafana";

const NIVEAUX: Record<string, number> = { lecture: 1, modification: 2, administration: 4 };

type Droit = { teamId?: number; userId?: number; role?: string; permission: number };

// Donne à une équipe un droit sur un dossier (lecture, modification, administration) ou le lui retire (« aucun ») ;
// les autres droits du dossier sont gardés tels quels.
export default async function ({ instance, dossier, equipe, droit }: Entree & { dossier: string; equipe: number; droit: string }) {
  if (droit !== "aucun" && !(droit in NIVEAUX)) throw new Error("Droit inconnu : lecture, modification, administration ou aucun.");
  const compte = grafana(instance);
  const chemin = `/api/folders/${segment(dossier)}/permissions`;
  const actuels = verifier<Droit[]>(await compte.get(chemin), "les droits du dossier");
  const gardes = actuels
    .filter((item) => item.teamId !== equipe)
    .map((item) => ({
      ...(item.teamId ? { teamId: item.teamId } : {}),
      ...(item.userId ? { userId: item.userId } : {}),
      ...(item.role ? { role: item.role } : {}),
      permission: item.permission,
    }));
  const items = droit === "aucun" ? gardes : [...gardes, { teamId: equipe, permission: NIVEAUX[droit] }];
  verifier(await compte.post(chemin, { items }), "la modification des droits du dossier");
  return { dossier, equipe, droit };
}
