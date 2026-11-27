import { type Entree, equipe, grafana, verifier } from "../lib/grafana";

// Équipes de l’organisation Grafana, page par page, avec leur nombre de membres.
export default async function ({ instance, recherche }: Entree & { recherche?: string }) {
  const equipes = [];
  for (let page = 1; ; page += 1) {
    const corps = verifier<{ teams?: Parameters<typeof equipe>[0][]; totalCount?: number }>(
      await grafana(instance).get("/api/teams/search", { perpage: 500, page, ...(recherche?.trim() ? { query: recherche.trim() } : {}) }),
      "la liste des équipes",
    );
    const lot = corps.teams ?? [];
    equipes.push(...lot.map(equipe));
    if (lot.length < 500 || equipes.length >= (corps.totalCount ?? equipes.length)) break;
  }
  return { equipes: equipes.sort((a, b) => a.nom.localeCompare(b.nom, "fr")) };
}
