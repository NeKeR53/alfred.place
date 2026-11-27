import { Row } from "@alfred/kit";
import { db, functions, useAsync, usePageState } from "@alfred/sdk";
import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { Page, PageSection } from "socle-ui";
import { type Depot, ListeDepots, ouvrirDepot, useCompteBitbucket } from "../lib/bitbucket-commun";
import { useEtat } from "../lib/etat";
import { RechercheRetenue } from "../lib/recherche-retenue";

/** Onglet « Dépôts » : tous les dépôts du compte. Un clic ouvre un onglet pour le dépôt. */
export default function DepotsBitbucket() {
  // En ouvrant la page, la pastille du menu se remet à jour (sans notification : vous avez la liste sous les yeux).
  useEffect(() => {
    functions.call("relever-bitbucket", { notifier: false }).catch(() => undefined);
  }, []);

  const { compte, attente, selecteur } = useCompteBitbucket();
  const [recherche, setRecherche] = usePageState<string>("bitbucket.recherche", "");

  const depots = useEtat<{ depots: Depot[] }>(
    "depots",
    compte ? { instance: compte, recherche: recherche.trim() || undefined, limite: 100 } : null,
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
          <RechercheRetenue label="les dépôts" recherche={recherche} onChange={setRecherche} />
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
          onOuvrir={(depot) => ouvrirDepot(compte, depot)}
        />
      </PageSection>
    </Page>
  );
}
