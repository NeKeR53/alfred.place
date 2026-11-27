import { type Entree, grafana, segment, verifier } from "../lib/grafana";

// Ajoute un compte Grafana à une équipe ; déjà membre, rien ne change.
export default async function ({ instance, equipe, utilisateur }: Entree & { equipe: number; utilisateur: number }) {
  const reponse = await grafana(instance).post(`/api/teams/${segment(equipe)}/members`, { userId: utilisateur });
  if (reponse.status === 400 || reponse.status === 409) {
    const message = String((reponse.body as { message?: string } | null)?.message ?? "");
    if (/already/i.test(message)) return { equipe, utilisateur, membre: true };
  }
  verifier(reponse, "l’ajout à l’équipe");
  return { equipe, utilisateur, membre: true };
}
