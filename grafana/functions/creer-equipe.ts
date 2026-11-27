import { type Entree, grafana, verifier } from "../lib/grafana";

// Crée une équipe dans l’organisation Grafana.
export default async function ({ instance, nom, email }: Entree & { nom: string; email?: string }) {
  const propre = nom.trim();
  if (!propre) throw new Error("Le nom de l’équipe est vide.");
  const corps = verifier<{ teamId?: number }>(
    await grafana(instance).post("/api/teams", { name: propre, ...(email?.trim() ? { email: email.trim() } : {}) }),
    `la création de l’équipe « ${propre} »`,
  );
  return { id: corps.teamId ?? null, nom: propre };
}
