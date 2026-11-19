import { useEffect } from "react";
import { Ban, Play } from "lucide-react";
import {
  type Action,
  Button,
  ChoiceButton,
  ChoiceGroup,
  Code,
  DataTable,
  EmptyState,
  FeedbackBanner,
  KeyValueList,
  LoadingSkeleton,
  openSubpage,
  Row,
  Section,
  Spinner,
  Stack,
  StatusBadge,
  Tabs,
  Text,
  usePageState,
} from "@alfred/ui";
import { functions, useAsync } from "@alfred/sdk";
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

const NIVEAUX: Record<number, string> = { 10: "DEBUG", 20: "INFO", 30: "WARNING", 40: "ERROR", 50: "CRITICAL" };
const FILTRES = [
  { id: 0, label: "Tout" },
  { id: 20, label: "Info" },
  { id: 30, label: "Avertissements" },
  { id: 40, label: "Erreurs" },
];

const lireFiche = (instance: string, id: string) =>
  functions.call<{ execution: FicheExecution; taches: Tache[] }>("lire-execution", { ...avecInstance(instance), execution: id });

/** Logs d’une exécution, relus toutes les trois secondes tant qu’elle tourne. */
function JournalExecution({ instance, id }: { instance: string; id: string }) {
  const [niveau, setNiveau] = usePageState<number>("logs.niveau", 0);
  const logs = useAsync(
    () =>
      functions.call<Logs>("lire-logs-execution", { ...avecInstance(instance), execution: id, ...(niveau ? { niveauMin: niveau } : {}) }),
    [instance, id, niveau],
  );
  const enCours = logs.data?.enCours ?? false;
  useEffect(() => {
    if (!enCours) return;
    const minuterie = setInterval(logs.reload, 3000);
    return () => clearInterval(minuterie);
  }, [enCours, logs.reload]);

  const texte = (logs.data?.lignes ?? [])
    .map((l) => {
      const niveauTexte = (NIVEAUX[l.niveau] ?? String(l.niveau)).padEnd(8);
      return `${heure(l.horodatage)}  ${niveauTexte} ${l.tache ? `[${l.tache}] ` : ""}${l.message}`;
    })
    .join("\n");

  return (
    <Stack gap="sm">
      <Row justify="between" wrap>
        <ChoiceGroup appearance="segmented" label="Niveau des logs">
          {FILTRES.map((f) => (
            <ChoiceButton
              key={f.id}
              label={f.label}
              variant="label"
              size="compact"
              selected={niveau === f.id}
              onClick={() => setNiveau(f.id)}
            >
              {f.label}
            </ChoiceButton>
          ))}
        </ChoiceGroup>
        {enCours ? (
          <Row gap="xs">
            <Spinner />
            <Text as="span" size="meta" tone="muted">
              Exécution en cours : les logs se mettent à jour tout seuls.
            </Text>
          </Row>
        ) : null}
      </Row>
      {logs.error && !logs.data ? (
        <FeedbackBanner tone="danger" action={<Button onClick={logs.reload}>Réessayer</Button>}>
          Les logs n’ont pas pu être lus : {logs.error.message}
        </FeedbackBanner>
      ) : !logs.data ? (
        <LoadingSkeleton variant="page" rows={8} label="Lecture des logs…" />
      ) : logs.data.lignes.length === 0 ? (
        <EmptyState size="compact" title="Aucun log" description={niveau ? "Aucune ligne à ce niveau : essayez « Tout »." : "Cette exécution n’a encore rien écrit."} />
      ) : (
        <>
          {logs.data.tronque ? (
            <Text size="meta" tone="muted">
              Les logs sont très longs : seules les 1 000 dernières lignes sont affichées.
            </Text>
          ) : null}
          <Code block label="Logs de l’exécution">
            {texte}
          </Code>
        </>
      )}
    </Stack>
  );
}

export function DetailExecution({ instance, id }: { instance: string; id: string }) {
  const [onglet, setOnglet] = usePageState<string>("execution.onglet", "logs");
  const fiche = useAsync(() => lireFiche(instance, id), [instance, id]);
  const enCours = ACTIFS.has(fiche.data?.execution.etat ?? "");
  useEffect(() => {
    if (!enCours) return;
    const minuterie = setInterval(fiche.reload, 5000);
    return () => clearInterval(minuterie);
  }, [enCours, fiche.reload]);

  if (fiche.error && !fiche.data)
    return (
      <FeedbackBanner tone="danger" action={<Button onClick={fiche.reload}>Réessayer</Button>}>
        L’exécution n’a pas pu être lue : {fiche.error.message}
      </FeedbackBanner>
    );
  if (!fiche.data) return <LoadingSkeleton variant="page" rows={6} label="Lecture de l’exécution…" />;

  const { execution: e, taches } = fiche.data;
  const etat = etatAffiche(e.etat, e.etatNom);
  const parametres = Object.keys(e.parametres).length > 0 ? JSON.stringify(e.parametres, null, 2) : "";

  const details = (
    <Stack gap="md">
      <KeyValueList
        items={[
          { label: "État", value: <StatusBadge tone={etat.tone}>{etat.label}</StatusBadge> },
          { label: "Flow", value: e.flux || "—" },
          { label: "Déploiement", value: e.deploiement ?? "—" },
          { label: "Début prévu", value: dateCourte(e.debutPrevu) },
          { label: "Début", value: dateCourte(e.debut) },
          { label: "Fin", value: dateCourte(e.fin) },
          { label: "Durée", value: duree(e.duree) },
          { label: "Tentatives", value: String(e.tentatives || 1) },
          { label: "Pool de workers", value: [e.pool, e.file].filter(Boolean).join(" · ") || "—" },
          { label: "Lancée par", value: e.creePar ?? "—" },
          { label: "Étiquettes", value: e.tags.length ? e.tags.join(", ") : "—" },
        ]}
      />
      {e.message ? (
        <Section title="Message">
          <Code block label="Message de l’état">
            {e.message}
          </Code>
        </Section>
      ) : null}
      <Section title="Paramètres">
        {parametres ? (
          <Code block label="Paramètres de l’exécution">
            {parametres}
          </Code>
        ) : (
          <Text size="meta" tone="muted">
            Aucun paramètre.
          </Text>
        )}
      </Section>
    </Stack>
  );

  const listeTaches =
    taches.length === 0 ? (
      <EmptyState size="compact" title="Aucune tâche" description="Cette exécution n’a lancé aucune tâche pour l’instant." />
    ) : (
      <DataTable
        label="Tâches de l’exécution"
        rows={taches}
        rowKey={(t: Tache) => t.id}
        columns={[
          { key: "nom", header: "Tâche" },
          {
            key: "etat",
            header: "État",
            render: (t: Tache) => {
              const a = etatAffiche(t.etat, t.etatNom);
              return (
                <StatusBadge size="compact" tone={a.tone}>
                  {a.label}
                </StatusBadge>
              );
            },
          },
          { key: "debut", header: "Début", render: (t: Tache) => (t.debut ? heure(t.debut) : "—") },
          { key: "duree", header: "Durée", align: "right", render: (t: Tache) => duree(t.duree) },
        ]}
      />
    );

  return (
    <Stack gap="md">
      <Tabs
        label="Exécution"
        activeId={onglet}
        onChange={setOnglet}
        items={[
          { id: "logs", label: "Logs" },
          { id: "taches", label: `Tâches (${taches.length})` },
          { id: "details", label: "Détails" },
        ]}
      />
      {onglet === "taches" ? listeTaches : onglet === "details" ? details : <JournalExecution instance={instance} id={id} />}
    </Stack>
  );
}

/** Ouvre une exécution en sous-page : logs, tâches et détails. */
export async function ouvrirExecution(instance: string, id: string, apresAction?: () => void) {
  const { execution: e } = await lireFiche(instance, id);
  const actif = ACTIFS.has(e.etat) || e.etat === "SCHEDULED" || e.etat === "PAUSED";
  const actions: Action[] = [
    {
      label: "Relancer avec les mêmes paramètres",
      icon: Play,
      hidden: !e.deploiementId,
      confirm: `Relancer « ${e.deploiement ?? e.nom} » avec les paramètres de cette exécution ?`,
      success: "Exécution lancée",
      onClick: async () => {
        await lancer(instance, e.deploiementId ?? "", e.parametres);
        apresAction?.();
      },
    },
    {
      label: "Annuler l’exécution",
      icon: Ban,
      danger: true,
      hidden: !actif,
      confirm: `Annuler l’exécution « ${e.nom} » ?`,
      confirmMessage: "Prefect demandera au worker de l’arrêter.",
      success: "Annulation demandée",
      onClick: async () => {
        await functions.call("annuler-execution", { ...avecInstance(instance), execution: e.id });
        apresAction?.();
      },
    },
  ];
  return openSubpage({
    title: e.nom,
    subtitle: [e.flux && e.deploiement ? `${e.flux} / ${e.deploiement}` : e.flux, e.debut ? `lancée le ${dateCourte(e.debut)}` : null]
      .filter(Boolean)
      .join(" · "),
    status: etatAffiche(e.etat, e.etatNom),
    actions,
    content: <DetailExecution instance={instance} id={e.id} />,
  });
}
