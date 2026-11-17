import { functions, db, shell, useAsync } from "@alfred/sdk";
import { raisonIndisponible } from "../lib/affichage";
import { CollectionPage, FeedbackBanner, usePageState } from "@alfred/ui";

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

export default function DossiersPage() {
  const [, setDossier] = usePageState<string>("outlook.boite.dossier", "");
  const comptes = useAsync(() => functions.call<{ pret: boolean }>("comptes-outlook"), []);
  const pret = comptes.data?.pret === true;

  async function ouvrir(dossier: Ligne) {
    setDossier(dossier.id);
    await db.execute(
      `INSERT INTO outlook_reglages (cle, valeur) VALUES ('dossier_actif', ?)
       ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`,
      [dossier.id],
    );
    await shell.navigate("outlook/boite-de-reception");
  }

  return (
    <CollectionPage<Ligne>
      label="Dossiers"
      load={async () => {
        const etat = await functions.call<{ pret: boolean }>("comptes-outlook").catch(() => null);
        if (!etat?.pret) return [];
        const reponse = await functions.call<{ boite: string; dossiers: Dossier[] }>("lister-dossiers", {});
        return reponse.dossiers.map((dossier) => ({
          ...dossier,
          nomAffiche: `${"— ".repeat(dossier.profondeur)}${dossier.nom}`,
        }));
      }}
      rowKey={(dossier) => dossier.id}
      columns={[
        { key: "nomAffiche", header: "Dossier" },
        { key: "nonLus", header: "Non lus", type: "number" },
        { key: "total", header: "Messages", type: "number", align: "right" },
      ]}
      search={{ label: "Rechercher un dossier", text: (dossier) => dossier.nomAffiche }}
      emptyTitle="Aucun dossier"
      emptyDescription="Les dossiers de votre boîte Outlook apparaîtront ici."
      onOpen={ouvrir}
      banner={
        comptes.error || (comptes.data && !pret) ? (
          <FeedbackBanner tone="warning">{raisonIndisponible(comptes.error)}</FeedbackBanner>
        ) : undefined
      }
    />
  );
}
