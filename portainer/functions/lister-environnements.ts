import { type Entree, portainer, verifier } from "../lib/portainer";

const TYPES: Record<number, string> = { 1: "docker", 2: "agent", 3: "azure", 4: "edge", 5: "kubernetes", 6: "kubernetes", 7: "edge" };

// Environnements Portainer (endpoints) visibles par le compte : leur numéro sert de réglage « Environnement ».
export default async function ({ instance }: Entree) {
  const lot = verifier<{ Id: number; Name: string; Type?: number; Status?: number; URL?: string }[]>(
    await portainer(instance).get("/api/endpoints"),
    "la liste des environnements",
  );
  return {
    environnements: lot.map((item) => ({
      id: item.Id,
      nom: item.Name,
      type: TYPES[item.Type ?? 0] ?? "inconnu",
      enLigne: item.Status === 1,
    })),
  };
}
