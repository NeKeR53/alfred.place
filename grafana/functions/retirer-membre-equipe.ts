import { type Entree, grafana, segment, verifier } from "../lib/grafana";

// Retire un compte d’une équipe ; une appartenance déjà absente n’est pas une erreur.
export default async function ({ instance, equipe, utilisateur }: Entree & { equipe: number; utilisateur: number }) {
  const reponse = await grafana(instance).delete(`/api/teams/${segment(equipe)}/members/${segment(utilisateur)}`);
  if (reponse.status !== 404) verifier(reponse, "le retrait de l’équipe");
  return { equipe, utilisateur, membre: false };
}
