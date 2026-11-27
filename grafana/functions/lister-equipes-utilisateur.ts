import { type Entree, equipe, grafana, segment, verifier } from "../lib/grafana";

// Équipes dont un compte est membre (demande les droits d’administration du serveur Grafana).
export default async function ({ instance, utilisateur }: Entree & { utilisateur: number }) {
  const lot = verifier<Parameters<typeof equipe>[0][]>(
    await grafana(instance).get(`/api/users/${segment(utilisateur)}/teams`),
    "les équipes du compte",
  );
  return { equipes: lot.map(equipe) };
}
