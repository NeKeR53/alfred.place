import { type Entree, grafana, segment, utilisateur, verifier } from "../lib/grafana";

// Membres d’une équipe Grafana.
export default async function ({ instance, equipe }: Entree & { equipe: number }) {
  const lot = verifier<Parameters<typeof utilisateur>[0][]>(
    await grafana(instance).get(`/api/teams/${segment(equipe)}/members`),
    "les membres de l’équipe",
  );
  return { membres: lot.map(utilisateur) };
}
