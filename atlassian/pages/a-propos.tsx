import { shell, usePageContext } from "@alfred/sdk";
import { ExternalLink, GitBranch, GitPullRequest } from "lucide-react";
import { Drawer } from "socle-ui";
import { type Depot, lireVueDepot, separerDepot } from "../lib/bitbucket-commun";
import { useEtat } from "../lib/etat";

/** Colonne « À propos » du dépôt affiché dans l’onglet. */
export default function AProposDepot() {
  const ouverture = lireVueDepot(usePageContext()?.view?.params);
  const instance = ouverture?.instance;
  const { projet, depot } = separerDepot(ouverture?.depot ?? "");

  const info = useEtat<{ depot: Depot | null; branches: Array<{ nom: string }> }>(
    "depot",
    projet && depot ? { instance, projet, depot } : null,
  );
  const prs = useEtat<{ prs: unknown[] }>(
    "pull-requests",
    projet && depot ? { instance, projet, depot, etat: "OPEN", role: "ALL", limite: 50 } : null,
  );

  const fiche = info.data?.depot ?? null;
  const nbBranches = info.data?.branches.length ?? 0;
  const nbPrs = prs.data?.prs.length ?? 0;

  return (
    <Drawer
      header={
        fiche
          ? {
              title: `${fiche.projet} / ${fiche.nom}`,
              subtitle: fiche.projetNom || fiche.projet,
              status: fiche.archive ? { label: "Archivé", tone: "warning" } : { label: fiche.public ? "Public" : "Privé", tone: "neutral" },
              actions: [
                {
                  id: "branches",
                  label: `Voir les ${nbBranches} branche${nbBranches > 1 ? "s" : ""}`,
                  icon: <GitBranch size={16} />,
                  onPress: () => shell.send({ aller: "branches" }),
                },
                {
                  id: "prs",
                  label: `Voir les ${nbPrs} pull request${nbPrs > 1 ? "s" : ""} ouverte${nbPrs > 1 ? "s" : ""}`,
                  icon: <GitPullRequest size={16} />,
                  onPress: () => shell.send({ aller: "prs" }),
                },
                {
                  id: "bitbucket",
                  label: "Ouvrir dans Bitbucket",
                  icon: <ExternalLink size={16} />,
                  isHidden: !fiche.url,
                  onPress: () => shell.openExternal(fiche.url ?? ""),
                },
              ],
            }
          : undefined
      }
      sections={
        fiche
          ? [
              {
                id: "a-propos",
                title: "À propos",
                content: fiche.description || "Aucune description.",
                fields: [
                  { label: "Branches", value: nbBranches, type: "number" },
                  { label: "Pull requests ouvertes", value: nbPrs, type: "number" },
                  { label: "Branche par défaut", value: fiche.brancheDefaut, type: "code", hideEmpty: true },
                ],
              },
            ]
          : undefined
      }
      isLoading={info.loading && !fiche}
      hasError={Boolean(info.error)}
      onRetry={info.reload}
      isNotFound={Boolean(projet && depot) && !info.loading && !info.error && !fiche}
      emptyMessage="Ouvrez un dépôt pour voir sa fiche ici."
    />
  );
}
