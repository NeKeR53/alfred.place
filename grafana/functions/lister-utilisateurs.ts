import { type Entree, grafana, utilisateur, verifier } from "../lib/grafana";

// Comptes de l’organisation Grafana (une personne n’y apparaît qu’après sa première connexion).
export default async function ({ instance, recherche }: Entree & { recherche?: string }) {
  const compte = grafana(instance);
  const filtre = recherche?.trim() ? { query: recherche.trim() } : {};
  const utilisateurs = [];
  for (let page = 1; ; page += 1) {
    const reponse = await compte.get("/api/org/users/search", { perpage: 1000, page, ...filtre });
    if (reponse.status === 404 && page === 1) {
      // Grafana ancien, sans recherche paginée.
      const lot = verifier<Parameters<typeof utilisateur>[0][]>(await compte.get("/api/org/users", filtre), "les comptes");
      return { utilisateurs: lot.map(utilisateur) };
    }
    const lot = verifier<{ orgUsers?: Parameters<typeof utilisateur>[0][] }>(reponse, "les comptes").orgUsers ?? [];
    utilisateurs.push(...lot.map(utilisateur));
    if (lot.length < 1000) break;
  }
  return { utilisateurs };
}
