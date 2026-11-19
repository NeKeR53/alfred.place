import { useEffect } from "react";
import { Play, RefreshCw } from "lucide-react";
import {
  type Action,
  Button,
  Code,
  Disclosure,
  EmptyState,
  FeedbackBanner,
  KeyValueList,
  List,
  ListItem,
  LoadingSkeleton,
  openForm,
  Page,
  Section,
  SelectControl,
  Stack,
  StatusBadge,
  Text,
  usePageState,
} from "@alfred/ui";
import { functions, shell, useAsync, usePageContext, usePeerMessage } from "@alfred/sdk";
import { ouvrirExecution } from "../lib/Execution";
import {
  ACTIFS,
  aDesParametres,
  avecInstance,
  dateCourte,
  type Deploiement,
  duree,
  etatAffiche,
  type Execution,
  formulaireParametres,
  lancer,
  lireSelection,
  nomComplet,
  planification,
} from "../lib/prefect";

const PAS = 25;
const FILTRES: { id: string; label: string; etats?: string[] }[] = [
  { id: "tous", label: "Tous les états" },
  { id: "reussies", label: "Réussies", etats: ["COMPLETED"] },
  { id: "echecs", label: "En échec", etats: ["FAILED", "CRASHED"] },
  { id: "cours", label: "En cours", etats: ["RUNNING", "PENDING", "CANCELLING"] },
  { id: "annulees", label: "Annulées", etats: ["CANCELLED"] },
];

export default function Historique() {
  const contexte = usePageContext();
  const { instance, deploiement: id } = lireSelection(String((contexte?.selection as { id?: string } | null)?.id ?? ""));
  const [filtre, setFiltre] = usePageState<string>("filtre", "tous");
  const [limite, setLimite] = usePageState<number>("limite", PAS);
  const etats = FILTRES.find((f) => f.id === filtre)?.etats;

  const fiche = useAsync(
    () =>
      id
        ? functions.call<{ deploiement: Deploiement | null }>("lire-deploiement", { ...avecInstance(instance), deploiement: id })
        : Promise.resolve({ deploiement: null }),
    [instance, id],
  );
  const runs = useAsync(
    () =>
      id
        ? functions.call<{ total: number; executions: Execution[] }>("lister-executions", {
            ...avecInstance(instance),
            deploiement: id,
            limite,
            ...(etats ? { etats } : {}),
          })
        : Promise.resolve({ total: 0, executions: [] as Execution[] }),
    [instance, id, filtre, limite],
  );

  useEffect(() => setLimite(PAS), [id]);
  const uneTourne = (runs.data?.executions ?? []).some((r) => ACTIFS.has(r.etat));
  useEffect(() => {
    if (!id) return;
    const minuterie = setInterval(runs.reload, uneTourne ? 5_000 : 30_000);
    return () => clearInterval(minuterie);
  }, [id, uneTourne, runs.reload]);

  usePeerMessage((message) => {
    if ((message as { type?: string })?.type === "execution-modifiee") setTimeout(runs.reload, 1500);
  });
  const apresAction = () => {
    setTimeout(runs.reload, 1500);
    void shell.send({ type: "execution-modifiee" });
  };

  if (!id)
    return (
      <Page>
        <EmptyState
          size="compact"
          title="Aucun déploiement choisi"
          description="Cliquez sur l’historique d’une carte pour voir toutes ses exécutions ici."
        />
      </Page>
    );

  const d = fiche.data?.deploiement ?? null;
  if (fiche.error && !fiche.data)
    return (
      <Page>
        <FeedbackBanner tone="danger" action={<Button onClick={fiche.reload}>Réessayer</Button>}>
          Le déploiement n’a pas pu être lu : {fiche.error.message}
        </FeedbackBanner>
      </Page>
    );
  if (!fiche.data)
    return (
      <Page>
        <LoadingSkeleton variant="page" rows={6} label="Chargement de l’historique…" />
      </Page>
    );
  if (!d)
    return (
      <Page>
        <EmptyState size="compact" title="Déploiement introuvable" description="Il a peut-être été supprimé de Prefect." />
      </Page>
    );

  const dernier = runs.data?.executions[0];
  const actions: Action[] = [
    {
      label: "Lancer",
      icon: Play,
      confirm: `Lancer « ${nomComplet(d)} » ?`,
      confirmMessage: "Une exécution démarre avec les paramètres par défaut du déploiement.",
      success: "Exécution lancée",
      onClick: async () => {
        await lancer(instance, d.id);
        apresAction();
      },
    },
    {
      label: "Actualiser",
      icon: RefreshCw,
      onClick: () => {
        fiche.reload();
        runs.reload();
      },
    },
    {
      label: "Lancer avec d’autres paramètres…",
      hidden: !aDesParametres(d),
      onClick: () => openForm(formulaireParametres(d, instance, apresAction)),
    },
  ];

  const parametres = Object.keys(d.parametres).length > 0 ? JSON.stringify(d.parametres, null, 2) : "";
  const total = runs.data?.total ?? 0;
  const lignes = runs.data?.executions ?? [];

  return (
    <Page
      header={{
        title: nomComplet(d),
        subtitle: planification(d),
        status: dernier ? etatAffiche(dernier.etat, dernier.etatNom) : undefined,
        actions,
      }}
      bar={
        <SelectControl aria-label="État des exécutions" value={filtre} onChange={(event) => setFiltre(event.target.value)}>
          {FILTRES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </SelectControl>
      }
    >
      <Section title="Exécutions" description={runs.data ? `${total} exécution${total > 1 ? "s" : ""}${filtre === "tous" ? " au total" : ""}` : undefined}>
        {runs.error && !runs.data ? (
          <FeedbackBanner tone="danger" action={<Button onClick={runs.reload}>Réessayer</Button>}>
            L’historique n’a pas pu être lu : {runs.error.message}
          </FeedbackBanner>
        ) : !runs.data ? (
          <LoadingSkeleton variant="list" rows={6} label="Lecture de l’historique…" />
        ) : lignes.length === 0 ? (
          <EmptyState
            size="compact"
            title="Aucune exécution"
            description={filtre === "tous" ? "Ce déploiement n’a jamais été lancé." : "Aucune exécution dans cet état."}
          />
        ) : (
          <Stack gap="sm">
            <List label="Exécutions du déploiement">
              {lignes.map((r) => {
                const a = etatAffiche(r.etat, r.etatNom);
                return (
                  <ListItem
                    key={r.id}
                    title={r.nom}
                    description={`${dateCourte(r.debut ?? r.debutPrevu)}${r.duree ? ` · ${duree(r.duree)}` : ""}`}
                    trailing={
                      <StatusBadge size="compact" tone={a.tone}>
                        {a.label}
                      </StatusBadge>
                    }
                    onClick={() => void ouvrirExecution(instance, r.id, apresAction)}
                  />
                );
              })}
            </List>
            {total > lignes.length ? (
              <Button onClick={() => setLimite(Math.min(limite + PAS, 200))}>Voir plus d’exécutions</Button>
            ) : null}
          </Stack>
        )}
      </Section>

      <Disclosure label="Détails du déploiement">
        <Stack gap="md">
          {d.description ? <Text>{d.description}</Text> : null}
          <KeyValueList
            items={[
              { label: "Flow", value: d.flux || "—" },
              { label: "Déploiement", value: d.nom },
              { label: "Pool de workers", value: d.pool ?? "—" },
              {
                label: "Disponibilité",
                value: d.enPause ? "Suspendu" : d.statut === "NOT_READY" ? "Aucun worker à l’écoute" : "Prêt",
              },
              { label: "Planification", value: planification(d) },
              { label: "Étiquettes", value: d.tags.length ? d.tags.join(", ") : "—" },
              { label: "Mis à jour", value: dateCourte(d.misAJour) },
            ]}
          />
          {parametres ? (
            <Code block label="Paramètres par défaut">
              {parametres}
            </Code>
          ) : null}
        </Stack>
      </Disclosure>
    </Page>
  );
}
