import { Row } from "@alfred/kit";
import { db, functions, useAsync, usePageState } from "@alfred/sdk";
import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { Page, PageSection, SearchField } from "socle-ui";
import { type Depot, ListeDepots, ouvrirDansDepot, useCompteBitbucket } from "../lib/bitbucket-commun";

/** Onglet « Dépôts » : tous les dépôts du compte. Un clic ouvre le dépôt dans l’onglet « Dépôt ouvert ». */
export default function DepotsBitbucket() {
  // En ouvrant la page, la pastille du menu se remet à jour (sans notification : vous avez la liste sous les yeux).
  useEffect(() => {
    functions.call("relever-bitbucket", { notifier: false }).catch(() => undefined);
  }, []);

  const { compte, attente, selecteur } = useCompteBitbucket();
  const [recherche, setRecherche] = usePageState<string>("bitbucket.recherche", "");

  const depots = useAsync(
    () =>
      compte
        ? functions.call<{ depots: Depot[] }>("lister-depots", {
            instance: compte,
            recherche: recherche.trim() || undefined,
            limite: 100,
          })
        : Promise.resolve({ depots: [] as Depot[] }),
    [compte, recherche],
  );
  const favoris = useAsync(
    () =>
      compte
        ? db.query<{ cle: string }>("SELECT cle FROM atlassian_favoris WHERE service = 'bitbucket' AND instance = ?", [compte])
        : Promise.resolve([] as Array<{ cle: string }>),
    [compte],
  );
  const clesFavorites = new Set((Array.isArray(favoris.data) ? favoris.data : []).map((f) => f.cle));

  if (attente) return attente;

  const liste = depots.data?.depots ?? [];

  return (
    <Page
      toolbar={
        <Row gap="sm">
          <SearchField label="les dépôts" onChange={({ text }) => setRecherche(text)} />
          {selecteur}
        </Row>
      }
      actions={[
        {
          id: "actualiser",
          label: "Actualiser",
          icon: <RefreshCw size={16} />,
          onPress: () => {
            depots.reload();
            favoris.reload();
          },
        },
      ]}
    >
      <PageSection
        title="Dépôts"
        state={depots.error ? "error" : depots.loading && !depots.data ? "loading" : "ready"}
        onRetry={depots.reload}
        empty={
          depots.data && liste.length === 0
            ? { title: "Aucun dépôt", description: "Aucun dépôt ne correspond à cette recherche." }
            : undefined
        }
      >
        <ListeDepots
          depots={liste}
          favoris={clesFavorites}
          onOuvrir={(cle) => void ouvrirDansDepot({ instance: compte, depot: cle, origine: "bitbucket" })}
        />
      </PageSection>
    </Page>
  );
}
