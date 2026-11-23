import { Stack, Text } from "@alfred/kit";
import { functions, useAsync } from "@alfred/sdk";
import { useState } from "react";
import { Button, Dialog, EmptyState, List, SearchField, Select } from "socle-ui";
import { type Compte, etatCouleur, type JobTrouve } from "./tableau";

interface Props {
  comptes: Compte[];
  dejaSuivis: Set<string>; // « instance\u0000job »
  /** Nom de la vue qui reçoit les jobs. */
  vue?: string;
  onAjouter: (instance: string, jobs: string[]) => Promise<void>;
  onClose: () => void;
}

/** Modale « Ajouter des jobs » : un compte, une recherche, des jobs à cocher. */
export function ChoixJobs({ comptes, dejaSuivis, vue, onAjouter, onClose }: Props) {
  const [instance, setInstance] = useState("");
  const [recherche, setRecherche] = useState("");
  const [choisis, setChoisis] = useState<Set<string>>(new Set());
  const [envoi, setEnvoi] = useState(false);

  const resultats = useAsync(
    () =>
      functions.call<{ total: number; jobs: JobTrouve[] }>("chercher-jobs", {
        ...(instance ? { instance } : {}),
        texte: recherche,
        limite: 100,
      }),
    [instance, recherche],
  );
  const jobs = resultats.data?.jobs ?? [];

  const ajouter = async () => {
    setEnvoi(true);
    try {
      await onAjouter(instance, [...choisis]);
      onClose();
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <Dialog
      isOpen
      size="lg"
      title="Ajouter des jobs"
      description={vue ? `Ils s’ajoutent à la vue « ${vue} ».` : undefined}
      isBusy={envoi}
      onOpenChange={(ouverte) => {
        if (!ouverte) onClose();
      }}
      footer={
        <>
          <Button onPress={onClose} isDisabled={envoi}>
            Annuler
          </Button>
          <Button variant="primary" isPending={envoi} isDisabled={choisis.size === 0} onPress={() => void ajouter()}>
            Ajouter les jobs choisis
          </Button>
        </>
      }
    >
      <Stack gap="md">
        {comptes.length > 1 ? (
          <Select
            label="Compte Jenkins"
            value={instance || (comptes.find((compte) => compte.default) ? "" : comptes[0]?.id) || ""}
            options={comptes.map((compte) => ({ id: compte.default ? "" : compte.id, label: compte.label }))}
            onChange={(id) => {
              setInstance(id ?? "");
              setChoisis(new Set());
            }}
          />
        ) : null}
        <SearchField label="les jobs" onChange={({ text }) => setRecherche(text)} />
        {resultats.data && jobs.length === 0 ? (
          <EmptyState size="compact" title="Aucun job trouvé" description="Essayez un autre nom ou une partie du dossier." />
        ) : (
          <Stack gap="xs">
            <Text size="meta" tone="muted">
              {`${
                choisis.size === 0
                  ? "Cochez les jobs à ajouter."
                  : `${choisis.size} job${choisis.size > 1 ? "s" : ""} choisi${choisis.size > 1 ? "s" : ""}.`
              }${
                resultats.data && resultats.data.total > jobs.length
                  ? ` ${resultats.data.total} jobs trouvés : précisez la recherche pour voir les autres.`
                  : ""
              }`}
            </Text>
            <List
              label="Jobs Jenkins"
              selectionMode="multiple"
              isLoading={resultats.loading}
              hasError={Boolean(resultats.error)}
              onRetry={resultats.reload}
              selectedKeys={choisis}
              onSelectionChange={(cles) =>
                setChoisis(
                  new Set(
                    [...cles].map(String).filter((chemin) => !dejaSuivis.has(`${instance}\u0000${chemin}`)),
                  ),
                )
              }
              items={jobs.map((job) => {
                const suivi = dejaSuivis.has(`${instance}\u0000${job.chemin}`);
                const etat = etatCouleur(job.etat);
                return {
                  id: job.chemin,
                  title: job.nom,
                  subtitle: suivi ? `${job.dossier ? `${job.dossier} · ` : ""}Déjà sur ce tableau` : job.dossier || undefined,
                  status: etat,
                };
              })}
            />
          </Stack>
        )}
      </Stack>
    </Dialog>
  );
}
