import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { Page, PageSection } from "socle-ui";
import { useEtat } from "../lib/etat";
import { useJugements } from "../lib/progressif";
import { ListePrs, type Pr, useCompteBitbucket } from "../lib/bitbucket-commun";
import { PullRequestModale } from "../lib/pull-request-modale";

/** Onglet « À traiter » : les pull requests où l’on vous demande une revue, tous dépôts confondus. */
export default function ATraiterBitbucket() {
  const { compte, attente, selecteur } = useCompteBitbucket();
  const [prOuverte, setPrOuverte] = useState<Pr | null>(null);

  const prs = useEtat<{ prs: Pr[] }>(
    "pull-requests",
    compte ? { instance: compte, etat: "OPEN", role: "INCOMING", limite: 50 } : null,
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
          onOuvrir={setPrOuverte}
        />
      </PageSection>
      {prOuverte ? (
        <PullRequestModale
          instance={compte}
          cible={prOuverte}
          risque={risques.resultats.get(`${prOuverte.projet}/${prOuverte.depot}/${prOuverte.id}`)}
          onClose={() => setPrOuverte(null)}
          onChange={prs.reload}
        />
      ) : null}
    </Page>
  );
}
