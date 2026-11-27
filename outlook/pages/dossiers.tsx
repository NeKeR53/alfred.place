import { db, shell, useAlfredState } from "@alfred/sdk";
import { FolderOpen } from "lucide-react";
import { ListPage } from "socle-ui";
import { raisonIndisponible } from "../lib/affichage";

interface Dossier {
  id: string;
  nom: string;
  parent: string;
  profondeur: number;
  nonLus: number;
  total: number;
}

interface Ligne extends Dossier {
  nomAffiche: string;
}

/** Ouvre le dossier dans la boîte de réception, qui lit son choix dans les réglages du module. */
async function ouvrir(dossier: Ligne) {
  await db.execute(
    `INSERT INTO outlook_reglages (cle, valeur) VALUES ('dossier_actif', ?)
     ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`,
    [dossier.id],
  );
  await shell.navigate("outlook/boite-de-reception");
}

export default function DossiersPage() {
  const comptes = useAlfredState<{ pret: boolean }>("comptes");
  const pret = comptes.data?.pret === true;
  const indisponible = (Boolean(comptes.error) && !comptes.data) || (comptes.data !== undefined && !pret);
  const dossiers = useAlfredState<{ boite: string; dossiers: Dossier[] }, Ligne[]>(pret ? "dossiers" : null, {
    params: { compte: "" },
    select: (valeur) =>
      (valeur?.dossiers ?? []).map((dossier) => ({
        ...dossier,
        nomAffiche: `${"— ".repeat(dossier.profondeur)}${dossier.nom}`,
      })),
  });
  const lignes = indisponible ? [] : dossiers.data;
  const chargement = !indisponible && (comptes.loading || (pret && dossiers.loading));

  return (
    <ListPage<Ligne>
      title="Dossiers"
      rows={lignes}
      columns={[
        { id: "nomAffiche", label: "Dossier" },
        { id: "nonLus", label: "Non lus", type: "number" },
        { id: "total", label: "Messages", type: "number" },
      ]}
      search={{ label: "les dossiers", text: (dossier) => dossier.nomAffiche }}
      empty={
        indisponible
          ? { title: "Outlook ne répond pas", description: raisonIndisponible(comptes.error) }
          : { title: "Aucun dossier", description: "Les dossiers de votre boîte Outlook apparaîtront ici." }
      }
      onOpen={(dossier) => void ouvrir(dossier)}
      rowActions={(dossier) => [
        { id: "ouvrir", label: "Ouvrir le dossier", icon: <FolderOpen size={16} />, onPress: () => ouvrir(dossier) },
      ]}
      isLoading={chargement}
      hasError={Boolean(dossiers.error) && !dossiers.data}
      onRetry={() => void (pret ? dossiers.refresh() : comptes.refresh())}
    />
  );
}
