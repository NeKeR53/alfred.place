import { shell, usePageContext } from "@alfred/sdk";
import { ChevronDown, FolderTree, ListTree } from "lucide-react";
import { useState } from "react";
import { Drawer, type DetailSection, DropdownMenu } from "socle-ui";
import { actionCopie, type SelectionVariable } from "../lib/choix-copie";
import { copierDocument, libelleProduit } from "../lib/secrets";

/** Détail d’une variable, comme le panneau de droite de la page Secrets de OneApp. */
export default function VariablePanneau() {
  const selection = usePageContext()?.selection as SelectionVariable | null | undefined;
  const copie = useCopieDocument(selection ?? null);
  if (!selection?.ligne)
    return <Drawer emptyMessage="Choisissez une variable pour voir sa présence dans chaque environnement." />;
  const { ligne, envs, copieArborescence } = selection;
  const sections: DetailSection[] = [
    {
      id: "variable",
      title: "Variable",
      fields: [
        { label: "Clé OpenBao", value: ligne.cle, type: "code" },
        { label: "Chemin", value: Object.values(ligne.emplacements)[0] ?? "", type: "code" },
        { label: "Utilisé par", value: `${ligne.composant} · variables du conteneur` },
      ],
    },
    {
      id: "environnements",
      title: "Par environnement",
      fields: envs.map((env) => ({
        id: env.id,
        label: env.nom,
        value: ligne.presente[env.id] ? "present" : "manquant",
        type: "status" as const,
        statuses: { present: { label: "présent", tone: "success" }, manquant: { label: "manquant", tone: "danger" } },
      })),
    },
  ];
  if (copie) sections.push(copie);
  return (
    <Drawer
      header={{
        title: ligne.nom,
        subtitle: `${libelleProduit(ligne.produit)} › ${ligne.composant}`,
        actions: [
          {
            id: "inventaire",
            label: "Ouvrir l’inventaire du composant",
            icon: <ListTree size={16} />,
            onPress: () => void shell.send({ ouvrirInventaire: { produit: ligne.produit, composant: ligne.composant } }),
          },
          {
            id: "arborescence",
            label: copieArborescence ? "Fermer la copie de l’arborescence" : "Copier l’arborescence du composant",
            icon: <FolderTree size={16} />,
            onPress: () =>
              void shell.send({ arborescence: copieArborescence ? null : { produit: ligne.produit, composant: ligne.composant } }),
          },
        ],
      }}
      sections={sections}
    />
  );
}

/** Section « Copier ce document » : toutes ses clés au même chemin, vers les environnements où il manque, sans écraser. */
function useCopieDocument(selection: SelectionVariable | null): DetailSection | null {
  const cle = selection ? `${selection.ligne.produit}|${selection.ligne.composant}|${selection.ligne.nom}` : "";
  const [etat, setEtat] = useState<{ cle: string; sourceId: string; destinations: string[] }>({ cle, sourceId: "", destinations: [] });
  const [enCours, setEnCours] = useState(false);
  // Une autre variable choisie repart d’un choix vide.
  const courant = etat.cle === cle ? etat : { cle, sourceId: "", destinations: [] };
  if (!selection?.ligne) return null;
  const { ligne, envs } = selection;
  const sources = envs.filter((env) => ligne.presente[env.id] && ligne.emplacements[env.id]);
  const source = sources.find((env) => env.id === courant.sourceId) ?? sources[0];
  const disponibles = envs.filter((env) => source && env.instance !== source.instance && !ligne.presente[env.id] && env.charge);
  if (!source || !disponibles.length) return null;
  const destinations = courant.destinations;

  const copier = async () => {
    if (!destinations.length || enCours) return;
    setEnCours(true);
    const { copies, echecs } = await copierDocument(
      source,
      disponibles.filter((env) => destinations.includes(env.id)),
      ligne.emplacements[source.id],
    );
    if (copies) {
      void shell.notify({ tone: "success", title: `Secret copié vers ${copies} environnement${copies > 1 ? "s" : ""}` });
      void shell.send({ relire: true });
    }
    if (echecs.length) void shell.notify({ tone: "error", title: "Certains secrets n’ont pas été copiés", description: echecs.join(" · ") });
    setEtat({ ...courant, destinations: [] });
    setEnCours(false);
  };

  return {
    id: "copie",
    title: "Copier ce document",
    actions: [actionCopie(destinations, enCours, () => void copier())],
    // La source se choisit dans le menu de sa ligne ; chaque destination a son interrupteur.
    fields: [
      {
        id: "source",
        label: "Source",
        value: source.nom,
        action:
          sources.length > 1
            ? {
                type: "icon" as const,
                icon: <ChevronDown size={16} />,
                label: "Changer l’environnement source",
                menu: (
                  <DropdownMenu.Section
                    title="Environnement source"
                    selectionMode="single"
                    selectedKeys={[source.id]}
                    onSelectionChange={(cles) => {
                      const id = [...cles][0];
                      if (id !== undefined && !enCours) setEtat({ cle, sourceId: String(id), destinations: [] });
                    }}
                  >
                    {sources.map((env) => (
                      <DropdownMenu.Item key={env.id} id={env.id} label={`Depuis ${env.nom}`} />
                    ))}
                  </DropdownMenu.Section>
                ),
              }
            : undefined,
      },
      ...disponibles.map((env) => ({
        id: `vers-${env.id}`,
        label: `Vers ${env.nom}`,
        value: destinations.includes(env.id),
        type: "boolean" as const,
        action: {
          type: "switch" as const,
          isSelected: destinations.includes(env.id),
          onChange: (coche: boolean) => {
            if (enCours) return;
            setEtat({ ...courant, destinations: coche ? [...destinations, env.id] : destinations.filter((id) => id !== env.id) });
          },
        },
      })),
    ],
    content: "Copie toutes ses clés au même chemin, sans écraser un document existant.",
  };
}
