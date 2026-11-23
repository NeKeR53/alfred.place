import { Stack, Text } from "@alfred/kit";
import { functions, shell, useAsync } from "@alfred/sdk";
import { Ban, Play } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Button,
  Code,
  Dialog,
  EmptyState,
  type LogLevel,
  type LogLine,
  LogViewer,
  PropertyRow,
  RadioGroup,
  Skeleton,
  StatusBadge,
  Table,
  useConfirm,
} from "socle-ui";
import { ACTIFS, avecInstance, dateCourte, duree, etatAffiche, type Execution, heure, lancer } from "./prefect";

interface Tache {
  id: string;
  nom: string;
  etat: string;
  etatNom: string;
  debut: string | null;
  fin: string | null;
  duree: number | null;
}

interface FicheExecution extends Execution {
  flux: string;
  deploiement: string | null;
  parametres: Record<string, unknown>;
  tags: string[];
  tentatives: number;
  pool: string | null;
  file: string | null;
  creePar: string | null;
  cree: string | null;
}

interface Logs {
  etat: string;
  enCours: boolean;
  tronque: boolean;
  lignes: { horodatage: string; niveau: number; message: string; source: string | null; tache: string | null }[];
}

/** Niveau Prefect (10 à 50) vers le niveau d’une ligne du journal. */
const niveauDe = (niveau: number): LogLevel => (niveau >= 40 ? "error" : niveau >= 30 ? "warning" : "info");

const lireFiche = (instance: string, id: string) =>
  functions.call<{ execution: FicheExecution; taches: Tache[] }>("lire-execution", { ...avecInstance(instance), execution: id });

/** Logs d’une exécution, relus toutes les trois secondes tant qu’elle tourne ; filtre de niveau du journal. */
function JournalExecution({ instance, id }: { instance: string; id: string }) {
  const logs = useAsync(
    () => functions.call<Logs>("lire-logs-execution", { ...avecInstance(instance), execution: id }),
    [instance, id],
  );
  const enCours = logs.data?.enCours ?? false;
  useEffect(() => {
    if (!enCours) return;
    const minuterie = setInterval(logs.reload, 3000);
    return () => clearInterval(minuterie);
  }, [enCours, logs.reload]);

  const lignes: LogLine[] = [
    ...(logs.data?.tronque
      ? [{ text: "Les logs sont très longs : seules les 1 000 dernières lignes sont affichées.", level: "warning" as const }]
      : []),
    ...(logs.data?.lignes ?? []).map((l) => ({
      text: `${l.tache ? `[${l.tache}] ` : ""}${l.message}`,
      time: l.horodatage,
      level: niveauDe(l.niveau),
    })),
  ];
  return (
    <LogViewer
      label="Logs de l’exécution"
      lines={lignes}
      levels
      live={enCours}
      loading={!logs.data && !logs.error}
      empty={
        <EmptyState
          size="compact"
          title={logs.error ? "Les logs n’ont pas pu être lus" : "Aucun log"}
          description={logs.error ? logs.error.message : "Cette exécution n’a encore rien écrit."}
        />
      }
    />
  );
}

/** Contenu de la fenêtre d’une exécution : logs, tâches et détails. */
function DetailExecution({ fiche, instance }: { fiche: { execution: FicheExecution; taches: Tache[] }; instance: string }) {
  const [onglet, setOnglet] = useState("logs");
  const { execution: e, taches } = fiche;
  const etat = etatAffiche(e.etat, e.etatNom);
  const parametres = Object.keys(e.parametres).length > 0 ? JSON.stringify(e.parametres, null, 2) : "";

  const details = (
    <Stack gap="md">
      <Stack gap="none">
        <PropertyRow label="État" value={<StatusBadge tone={etat.tone}>{etat.label}</StatusBadge>} />
        <PropertyRow label="Flow" value={e.flux || undefined} />
        <PropertyRow label="Déploiement" value={e.deploiement ?? undefined} />
        <PropertyRow label="Début prévu" value={dateCourte(e.debutPrevu)} />
        <PropertyRow label="Début" value={dateCourte(e.debut)} />
        <PropertyRow label="Fin" value={dateCourte(e.fin)} />
        <PropertyRow label="Durée" value={duree(e.duree)} />
        <PropertyRow label="Tentatives" value={String(e.tentatives || 1)} />
        <PropertyRow label="Pool de workers" value={[e.pool, e.file].filter(Boolean).join(" · ") || undefined} />
        <PropertyRow label="Lancée par" value={e.creePar ?? undefined} />
        <PropertyRow label="Étiquettes" value={e.tags.length ? e.tags.join(", ") : undefined} />
      </Stack>
      {e.message ? (
        <Stack gap="xs">
          <Text weight="strong">Message</Text>
          <Code block label="Message de l’état">
            {e.message}
          </Code>
        </Stack>
      ) : null}
      <Stack gap="xs">
        <Text weight="strong">Paramètres</Text>
        {parametres ? (
          <Code block label="Paramètres de l’exécution">
            {parametres}
          </Code>
        ) : (
          <Text size="meta" tone="muted">
            Aucun paramètre.
          </Text>
        )}
      </Stack>
    </Stack>
  );

  const listeTaches =
    taches.length === 0 ? (
      <EmptyState size="compact" title="Aucune tâche" description="Cette exécution n’a lancé aucune tâche pour l’instant." />
    ) : (
      <Table<Tache>
        label="Tâches de l’exécution"
        rows={taches}
        selectionMode="none"
        density="compact"
        columns={[
          { id: "nom", label: "Tâche" },
          { id: "etat", label: "État", width: 140 },
          { id: "debut", label: "Début", width: 100 },
          { id: "duree", label: "Durée", align: "end", width: 100 },
        ]}
        renderCell={(t, colonne) => {
          if (colonne === "etat") {
            const a = etatAffiche(t.etat, t.etatNom);
            return <StatusBadge tone={a.tone}>{a.label}</StatusBadge>;
          }
          if (colonne === "debut") return t.debut ? heure(t.debut) : "—";
          if (colonne === "duree") return duree(t.duree);
          return t.nom;
        }}
      />
    );

  return (
    <Stack gap="md">
      <RadioGroup label="Vue de l’exécution" hideLabel orientation="horizontal" value={onglet} onChange={setOnglet}>
        <RadioGroup.Option value="logs">Logs</RadioGroup.Option>
        <RadioGroup.Option value="taches">{`Tâches (${taches.length})`}</RadioGroup.Option>
        <RadioGroup.Option value="details">Détails</RadioGroup.Option>
      </RadioGroup>
      {onglet === "taches" ? listeTaches : onglet === "details" ? details : <JournalExecution instance={instance} id={e.id} />}
    </Stack>
  );
}

/**
 * Une exécution en modale, au-dessus de la page, comme le log d’un build Jenkins : logs, tâches et détails, avec
 * la relance et l’annulation.
 */
export function ExecutionDialog({
  instance,
  id,
  apresAction,
  onClose,
}: {
  instance: string;
  id: string;
  apresAction?: () => void;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const fiche = useAsync(() => lireFiche(instance, id), [instance, id]);
  const enCours = ACTIFS.has(fiche.data?.execution.etat ?? "");
  useEffect(() => {
    if (!enCours) return;
    const minuterie = setInterval(fiche.reload, 5000);
    return () => clearInterval(minuterie);
  }, [enCours, fiche.reload]);

  const e = fiche.data?.execution;
  const actif = e ? ACTIFS.has(e.etat) || e.etat === "SCHEDULED" || e.etat === "PAUSED" : false;
  const etat = e ? etatAffiche(e.etat, e.etatNom) : null;
  const contexte = e
    ? [
        etat?.label,
        e.flux && e.deploiement ? `${e.flux} / ${e.deploiement}` : e.flux,
        e.debut ? `lancée le ${dateCourte(e.debut)}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;

  const relancer = async () => {
    if (!e?.deploiementId) return;
    const oui = await confirm({
      title: `Relancer « ${e.deploiement ?? e.nom} » avec les paramètres de cette exécution ?`,
      confirmLabel: "Relancer",
      tone: "default",
    });
    if (!oui) return;
    await lancer(instance, e.deploiementId, e.parametres);
    shell.notify({ title: "Exécution lancée", tone: "success" });
    apresAction?.();
  };
  const annuler = async () => {
    if (!e) return;
    const oui = await confirm({
      title: `Annuler l’exécution « ${e.nom} » ?`,
      message: "Prefect demandera au worker de l’arrêter.",
      confirmLabel: "Annuler l’exécution",
    });
    if (!oui) return;
    await functions.call("annuler-execution", { ...avecInstance(instance), execution: e.id });
    shell.notify({ title: "Annulation demandée", tone: "success" });
    apresAction?.();
  };

  return (
    <Dialog
      isOpen
      size="xl"
      title={e ? `Logs de « ${e.nom} »` : "Exécution"}
      description={contexte}
      onOpenChange={(ouverte) => {
        if (!ouverte) onClose();
      }}
      footer={
        e ? (
          <>
            {actif ? (
              <Button variant="danger" icon={<Ban size={16} />} onPress={() => void annuler()}>
                Annuler l’exécution
              </Button>
            ) : null}
            {e.deploiementId ? (
              <Button variant="primary" icon={<Play size={16} />} onPress={() => void relancer()}>
                Relancer avec les mêmes paramètres
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {fiche.error && !fiche.data ? (
        <EmptyState
          size="compact"
          title="L’exécution n’a pas pu être lue"
          description={fiche.error.message}
          action={<Button onPress={fiche.reload}>Réessayer</Button>}
        />
      ) : fiche.data ? (
        <DetailExecution fiche={fiche.data} instance={instance} />
      ) : (
        <Skeleton shape="rect" width="100%" height={320} />
      )}
    </Dialog>
  );
}
