import { functions, useAsync } from "@alfred/sdk";
import { RefreshCw } from "lucide-react";
import { Page, PageSection } from "socle-ui";
import { useJugements } from "../lib/progressif";
import { ListePrs, ouvrirDansDepot, type Pr, useCompteBitbucket } from "../lib/bitbucket-commun";

/** Onglet « À traiter » : les pull requests où l’on vous demande une revue, tous dépôts confondus. */
export default function ATraiterBitbucket() {
  const { compte, attente, selecteur } = useCompteBitbucket();

  const prs = useAsync(
    () =>
      compte
        ? functions.call<{ prs: Pr[] }>("lister-prs", { instance: compte, etat: "OPEN", role: "INCOMING", limite: 50 })
        : Promise.resolve({ prs: [] as Pr[] }),
    [compte],
  );
  const liste = prs.data?.prs ?? [];

  // Risque de chaque pull request, jugé sur l’ordinateur.
  const risques = useJugements<{ cle: string; niveau: string; aVerifier: boolean }>(
    "evaluer-risque-pr",
    { instance: compte },
    "prs",
    liste.map((pr) => ({
      cle: `${pr.projet}/${pr.depot}/${pr.id}`,
      titre: pr.titre,
      description: pr.description,
      source: pr.source,
      cible: pr.cible,
      misAJour: pr.misAJour,
    })),
  );

  if (attente) return attente;

  return (
    <Page
      toolbar={selecteur ?? undefined}
      actions={[{ id: "actualiser", label: "Actualiser", icon: <RefreshCw size={16} />, onPress: () => prs.reload() }]}
    >
      <PageSection
        title="Revues demandées"
        state={prs.error ? "error" : prs.loading && !prs.data ? "loading" : "ready"}
        onRetry={prs.reload}
      >
        <ListePrs
          prs={liste}
          risques={risques.resultats}
          avecDepot
          onOuvrir={(pr) =>
            void ouvrirDansDepot({
              instance: compte,
              depot: `${pr.projet}/${pr.depot}`,
              pr: `${pr.projet}/${pr.depot}/${pr.id}`,
              origine: "a-traiter",
            })
          }
        />
      </PageSection>
    </Page>
  );
}
