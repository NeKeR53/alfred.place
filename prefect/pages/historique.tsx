import { Text } from "@alfred/kit";
import { functions, notifyActionError, shell, useAsync, usePageContext, usePageState, usePeerMessage } from "@alfred/sdk";
import { ChevronsDown, ListFilter, Play, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useEffect } from "react";
import { type Action, Code, DetailPanel, DropdownMenu, List, useOpenForm } from "socle-ui";
import {
  ACTIFS,
  aDesParametres,
  avecInstance,
  dateCourte,
  type Deploiement,
  duree,
  etatAffiche,
  type EtatDeploiement,
  type Execution,
  formulaireParametres,
  lancer,
  lireSelection,
  nomComplet,
  planification,
  resume,
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
  const choisi = lireSelection(String((contexte?.selection as { id?: string } | null)?.id ?? ""));
  // Le panneau suit le compte de l’onglet ; la sélection le rappelle aussi.
  const instance = contexte?.instance ?? choisi.instance;
  const id = choisi.deploiement;
  const [filtre, setFiltre] = usePageState<string>("filtre", "tous");
  const [limite, setLimite] = usePageState<number>("limite", PAS);
  const openForm = useOpenForm();
  const etats = FILTRES.find((f) => f.id === filtre)?.etats;

  const fiche = useAsync(
    () =>
      id
        ? functions.call<{ deploiement: Deploiement | null }>("lire-deploiement", { ...avecInstance(instance), deploiement: id })
        : Promise.resolve({ deploiement: null }),
    [instance, id],
  );
  // Bilan des exécutions précédentes et prochaine exécution, retirés de la carte pour la garder courte.
  const bilan = useAsync(
    () =>
      id
        ? functions
            .call<{ deploiements: EtatDeploiement[] }>("lire-dernieres-executions", { ...avecInstance(instance), deploiements: [id] })
            .then((r) => r.deploiements[0] ?? null)
        : Promise.resolve(null),
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
    if ((message as { type?: string })?.type === "execution-modifiee")
      setTimeout(() => {
        runs.reload();
        bilan.reload();
      }, 1500);
  });
  const apresAction = () => {
    setTimeout(() => {
      runs.reload();
      bilan.reload();
    }, 1500);
    void shell.send({ type: "execution-modifiee" });
  };

  const d = fiche.data?.deploiement ?? null;
  const dernier = runs.data?.executions[0];
  const actions: Action[] = d
    ? [
        {
          id: "lancer",
          label: "Lancer",
          icon: <Play size={16} />,
          confirm: {
            title: `Lancer « ${nomComplet(d)} » ?`,
            message: "Une exécution démarre avec les paramètres par défaut du déploiement.",
            confirmLabel: "Lancer",
          },
          onPress: async () => {
            await lancer(instance, d.id);
            shell.notify({ title: "Exécution lancée", tone: "success" });
            apresAction();
          },
        },
        {
          id: "actualiser",
          label: "Actualiser",
          icon: <RefreshCw size={16} />,
          onPress: () => {
            fiche.reload();
            runs.reload();
            bilan.reload();
          },
        },
        {
          id: "parametres",
          label: "Lancer avec d’autres paramètres…",
          icon: <SlidersHorizontal size={16} />,
          isHidden: !aDesParametres(d),
          onPress: () => openForm(formulaireParametres(d, instance, apresAction)),
        },
      ]
    : [];

  const parametres = d && Object.keys(d.parametres).length > 0 ? JSON.stringify(d.parametres, null, 2) : "";
  const total = runs.data?.total ?? 0;
  const lignes = runs.data?.executions ?? [];
  const prochaine = bilan.data?.prochaine?.debutPrevu;

  return (
    <DetailPanel
      header={
        d
          ? {
              title: nomComplet(d),
              subtitle: planification(d),
              status: dernier ? etatAffiche(dernier.etat, dernier.etatNom) : undefined,
              actions,
            }
          : undefined
      }
      sections={
        d
          ? [
              {
                id: "detail",
                title: "Détail",
                fields: [
                  { label: "Planification", value: planification(d) },
                  {
                    label: "Exécutions précédentes",
                    value: !bilan.data
                      ? bilan.error
                        ? "Illisibles pour l’instant"
                        : "…"
                      : bilan.data.recentes.length > 1
                        ? resume(bilan.data.recentes.slice(1))
                        : "Aucune",
                  },
                  prochaine
                    ? { label: "Prochaine exécution", value: prochaine, type: "datetime" }
                    : { label: "Prochaine exécution", value: bilan.data ? "Aucune prévue" : "…" },
                ],
              },
              {
                id: "executions",
                title: "Exécutions",
                summary: runs.data ? `${total} exécution${total > 1 ? "s" : ""}${filtre === "tous" ? " au total" : ""}` : undefined,
                actions: [
                  {
                    id: "plus",
                    label: "Voir plus d’exécutions",
                    icon: <ChevronsDown size={16} />,
                    isHidden: total <= lignes.length,
                    onPress: () => setLimite(Math.min(limite + PAS, 200)),
                  },
                ],
                // Le filtre est une ligne : l’état choisi en texte, le choix dans le menu de la ligne.
                fields: [
                  {
                    id: "filtre",
                    label: "État",
                    value: FILTRES.find((f) => f.id === filtre)?.label ?? FILTRES[0].label,
                    action: {
                      type: "icon",
                      icon: <ListFilter size={16} />,
                      label: "Filtrer les exécutions par état",
                      menu: (
                        <DropdownMenu.Section
                          title="État des exécutions"
                          selectionMode="single"
                          selectedKeys={[filtre]}
                          onSelectionChange={(cles) => {
                            // Choisir l’état déjà coché le garde.
                            const choix = [...cles][0];
                            if (choix !== undefined) setFiltre(String(choix));
                          }}
                        >
                          {FILTRES.map((f) => (
                            <DropdownMenu.Item key={f.id} id={f.id} label={f.label} />
                          ))}
                        </DropdownMenu.Section>
                      ),
                    },
                  },
                ],
                content:
                  runs.data && lignes.length === 0 ? (
                    <Text tone="muted">
                      {filtre === "tous" ? "Ce déploiement n’a jamais été lancé." : "Aucune exécution dans cet état."}
                    </Text>
                  ) : (
                    <List
                      label="Exécutions du déploiement"
                      selectionMode="none"
                      isLoading={!runs.data}
                      hasError={Boolean(runs.error && !runs.data)}
                      onRetry={runs.reload}
                      items={lignes.map((r) => ({
                        id: r.id,
                        title: r.nom,
                        subtitle: `${dateCourte(r.debut ?? r.debutPrevu)}${r.duree ? ` · ${duree(r.duree)}` : ""}`,
                        status: etatAffiche(r.etat, r.etatNom),
                      }))}
                      onAction={(execution) => void shell.send({ type: "ouvrir-execution", execution })}
                    />
                  ),
              },
              {
                id: "deploiement",
                title: "Détails du déploiement",
                defaultCollapsed: true,
                fields: [
                  { label: "Description", value: d.description, type: "longtext", hideEmpty: true },
                  { label: "Flow", value: d.flux },
                  { label: "Déploiement", value: d.nom },
                  { label: "Pool de workers", value: d.pool },
                  {
                    label: "Disponibilité",
                    value: d.enPause ? "Suspendu" : d.statut === "NOT_READY" ? "Aucun worker à l’écoute" : "Prêt",
                  },
                  { label: "Planification", value: planification(d) },
                  { label: "Étiquettes", value: d.tags, type: "tags" },
                  { label: "Mis à jour", value: dateCourte(d.misAJour) },
                ],
                content: parametres ? (
                  <Code block label="Paramètres par défaut">
                    {parametres}
                  </Code>
                ) : undefined,
              },
            ]
          : undefined
      }
      isLoading={Boolean(id) && !fiche.data && !fiche.error}
      hasError={Boolean(fiche.error && !fiche.data)}
      onRetry={fiche.reload}
      isNotFound={Boolean(id) && Boolean(fiche.data) && !d}
      emptyMessage="Ouvrez l’historique d’un déploiement pour voir toutes ses exécutions ici."
      onActionError={notifyActionError}
    />
  );
}
