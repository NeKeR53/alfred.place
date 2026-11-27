import { type Entree, grafana, verifier } from "../lib/grafana";

// Dossiers de tableaux de bord visibles par le compte.
export default async function ({ instance }: Entree) {
  const dossiers = [];
  for (let page = 1; ; page += 1) {
    const lot = verifier<{ uid: string; title: string }[]>(
      await grafana(instance).get("/api/folders", { limit: 1000, page }),
      "la liste des dossiers",
    );
    dossiers.push(...lot.map((dossier) => ({ uid: dossier.uid, titre: dossier.title })));
    if (lot.length < 1000) break;
  }
  return { dossiers };
}
