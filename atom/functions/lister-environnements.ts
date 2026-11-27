import { db } from "@alfred/sdk";

type Outil = "keycloak" | "grafana" | "openbao" | "portainer";

// Environnements d’Atom dans leur ordre, avec le compte (identifiant d’instance) de chaque outil.
export default async function ({ environnement }: { environnement?: string }) {
  const lignes = await db.query<{ id: string; nom: string; code: string; nature: string; couleur: string; ordre: number }>(
    environnement
      ? "SELECT id, nom, code, nature, couleur, ordre FROM atom_environnements WHERE id = ? OR code = upper(?) ORDER BY ordre"
      : "SELECT id, nom, code, nature, couleur, ordre FROM atom_environnements ORDER BY ordre, nom",
    environnement ? [environnement, environnement] : [],
  );
  const liens = await db.query<{ environnement: string; outil: Outil; instance: string }>(
    "SELECT environnement, outil, instance FROM atom_rattachements",
  );
  return {
    environnements: lignes.map((ligne) => {
      const instances: Record<Outil, string | null> = { keycloak: null, grafana: null, openbao: null, portainer: null };
      for (const lien of liens) if (lien.environnement === ligne.id) instances[lien.outil] = lien.instance;
      return { ...ligne, instances };
    }),
  };
}
