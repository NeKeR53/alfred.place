// Commun à la page Secrets et à son panneau Variable : ce que la page publie, et le choix d’une copie.
import { Stack } from "@alfred/kit";
import { Copy } from "lucide-react";
import { type Action, Checkbox, Select } from "socle-ui";
import type { Ligne } from "./secrets";

/** Ce que la page envoie à son panneau (Variable) : la ligne choisie, les environnements, la copie d’arborescence ouverte. */
export type SelectionVariable = {
  ligne: Ligne;
  envs: { id: string; nom: string; instance: string; charge: boolean }[];
  copieArborescence: boolean;
};

/** Source et destinations cochées : commun à la copie d’un document et d’une arborescence. */
export function ChoixCopie({
  sources,
  sourceId,
  onSource,
  disponibles,
  destinations,
  onDestinations,
  enCours,
}: {
  sources: readonly { id: string; nom: string }[];
  sourceId: string;
  onSource: (id: string) => void;
  disponibles: readonly { id: string; nom: string }[];
  destinations: string[];
  onDestinations: (ids: string[]) => void;
  enCours: boolean;
}) {
  return (
    <Stack gap="sm">
      <Select
        label="Environnement source"
        isRequired
        value={sourceId}
        isDisabled={enCours}
        options={sources.map(({ id, nom }) => ({ id, label: `Depuis ${nom}` }))}
        onChange={(id) => {
          if (id) onSource(id);
        }}
      />
      {disponibles.map(({ id, nom }) => (
        <Checkbox
          key={id}
          isSelected={destinations.includes(id)}
          isDisabled={enCours}
          onChange={(coche) => onDestinations(coche ? [...destinations, id] : destinations.filter((valeur) => valeur !== id))}
        >
          {`Copier vers ${nom}`}
        </Checkbox>
      ))}
    </Stack>
  );
}

/** Bouton de copie, en action de la section qui porte le choix. */
export function actionCopie(destinations: readonly string[], enCours: boolean, onCopier: () => void, libelle?: string): Action {
  return {
    id: "copier",
    label: libelle ?? `Copier vers ${destinations.length} environnement${destinations.length > 1 ? "s" : ""}`,
    icon: <Copy size={16} />,
    primary: true,
    isDisabled: !destinations.length || enCours,
    onPress: onCopier,
  };
}
