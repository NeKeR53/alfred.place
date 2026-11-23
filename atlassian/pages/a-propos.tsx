import { functions, shell, useAsync, useSelection } from "@alfred/sdk";
import { ExternalLink, GitBranch, GitPullRequest } from "lucide-react";
import { DetailPanel } from "socle-ui";

interface Depot {
  slug: string;
  nom: string;
  description: string;
  projet: string;
  projetNom: string;
  archive: boolean;
  public?: boolean;
  brancheDefaut: string | null;
  url: string | null;
  clones?: Array<{ nom: string; url: string }>;
}

/** Colonne « À propos » d’un dépôt, comme sur GitHub. La page publie « compte|PROJET/dépôt ». */
export default function AProposDepot() {
  const selection = useSelection<{ id?: string } | string>();
  const brut = typeof selection === "string" ? selection : (selection?.id ?? "");
  const separateur = brut.indexOf("|");
  const instance = separateur >= 0 ? brut.slice(0, separateur) : "";
  const cle = separateur >= 0 ? brut.slice(separateur + 1) : brut;
  const [projet, ...reste] = cle.split("/");
  const depot = reste.join("/");

  const info = useAsync(
    () =>
      projet && depot
        ? functions.call<{ depot: Depot | null; branches: Array<{ nom: string }> }>("lire-depot", {
            instance: instance || undefined,
            projet,
            depot,
          })
        : Promise.resolve({ depot: null, branches: [] }),
    [instance, projet, depot],
  );
  const prs = useAsync(
    () =>
      projet && depot
        ? functions.call<{ prs: unknown[] }>("lister-prs", {
            instance: instance || undefined,
            projet,
            depot,
            etat: "OPEN",
            role: "ALL",
            limite: 50,
          })
        : Promise.resolve({ prs: [] }),
    [instance, projet, depot],
  );

  const fiche = info.data?.depot ?? null;
  const nbBranches = info.data?.branches.length ?? 0;
  const nbPrs = prs.data?.prs.length ?? 0;

  return (
    <DetailPanel
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
