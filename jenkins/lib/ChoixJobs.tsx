import { useEffect, useState } from "react";
import {
  Button,
  EmptyState,
  FeedbackBanner,
  FormField,
  List,
  ListItem,
  LoadingSkeleton,
  SearchField,
  SelectControl,
  Stack,
  StatusBadge,
  Text,
} from "@alfred/ui";
import { functions, useAsync } from "@alfred/sdk";
import { type Compte, etatCouleur, type JobTrouve } from "./tableau";

/** Sélection partagée entre la recherche et l’action « Ajouter » de la modale. */
export interface Selection {
  instance: string;
  jobs: Set<string>;
}

interface Props {
  comptes: Compte[];
  dejaSuivis: Set<string>; // « instance\u0000job »
  selection: Selection;
}

export function ChoixJobs({ comptes, dejaSuivis, selection }: Props) {
  const [instance, setInstance] = useState(selection.instance);
  const [texte, setTexte] = useState("");
  const [recherche, setRecherche] = useState("");
  const [choisis, setChoisis] = useState<Set<string>>(new Set(selection.jobs));

  // Recherche lancée un instant après la frappe.
  useEffect(() => {
    const minuterie = setTimeout(() => setRecherche(texte), 250);
    return () => clearTimeout(minuterie);
  }, [texte]);

  const resultats = useAsync(
    () =>
      functions.call<{ total: number; jobs: JobTrouve[] }>("chercher-jobs", {
        ...(instance ? { instance } : {}),
        texte: recherche,
        limite: 100,
      }),
    [instance, recherche],
  );

  const changerCompte = (valeur: string) => {
    setInstance(valeur);
    setChoisis(new Set());
    selection.instance = valeur;
    selection.jobs = new Set();
  };

  const basculer = (chemin: string) => {
    const suivants = new Set(choisis);
    if (suivants.has(chemin)) suivants.delete(chemin);
    else suivants.add(chemin);
    setChoisis(suivants);
    selection.jobs = suivants;
  };

  return (
    <Stack gap="md">
      {comptes.length > 1 ? (
        <FormField label="Compte Jenkins">
          <SelectControl value={instance} onChange={(event) => changerCompte(event.target.value)}>
            {comptes.map((compte) => (
              <option key={compte.id} value={compte.default ? "" : compte.id}>
                {compte.label}
              </option>
            ))}
          </SelectControl>
        </FormField>
      ) : null}
      <SearchField label="Rechercher un job" value={texte} onChange={(event) => setTexte(event.target.value)} />
      {resultats.error && !resultats.data ? (
        <FeedbackBanner tone="danger" action={<Button onClick={resultats.reload}>Réessayer</Button>}>
          La liste des jobs n’a pas pu être lue : {resultats.error.message}
        </FeedbackBanner>
      ) : !resultats.data ? (
        <LoadingSkeleton variant="list" rows={5} label="Recherche des jobs…" />
      ) : resultats.data.jobs.length === 0 ? (
        <EmptyState size="compact" title="Aucun job trouvé" description="Essayez un autre nom ou une partie du dossier." />
      ) : (
        <Stack gap="xs">
          <Text size="meta" tone="muted">
            {choisis.size === 0
              ? "Cliquez sur les jobs à ajouter."
              : `${choisis.size} job${choisis.size > 1 ? "s" : ""} choisi${choisis.size > 1 ? "s" : ""}.`}
            {resultats.data.total > resultats.data.jobs.length
              ? ` ${resultats.data.total} jobs trouvés : précisez la recherche pour voir les autres.`
              : ""}
          </Text>
          <List label="Jobs Jenkins">
            {resultats.data.jobs.map((job) => {
              const suivi = dejaSuivis.has(`${instance}\u0000${job.chemin}`);
              const etat = etatCouleur(job.etat);
              return (
                <ListItem
                  key={job.chemin}
                  title={job.nom}
                  description={suivi ? `${job.dossier ? `${job.dossier} · ` : ""}Déjà sur ce tableau` : job.dossier || undefined}
                  selected={choisis.has(job.chemin)}
                  onClick={suivi ? undefined : () => basculer(job.chemin)}
                  trailing={
                    <StatusBadge size="compact" tone={etat.tone}>
                      {etat.label}
                    </StatusBadge>
                  }
                />
              );
            })}
          </List>
        </Stack>
      )}
    </Stack>
  );
}
