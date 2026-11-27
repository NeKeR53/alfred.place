import { docker, type Entree, portainer, segment, verifier } from "../lib/portainer";

// Donne à la console sa nouvelle taille (colonnes et lignes du Terminal).
export default async function ({ instance, exec, colonnes, lignes }: Entree & { exec: string; colonnes: number; lignes: number }) {
  verifier(
    await portainer(instance).request({
      method: "POST",
      path: docker(`/exec/${segment(exec)}/resize`),
      query: { h: Math.trunc(lignes), w: Math.trunc(colonnes) },
    }),
    "le redimensionnement de la console",
  );
  return { exec, colonnes, lignes };
}
