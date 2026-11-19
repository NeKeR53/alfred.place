import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  type Action,
  Button,
  ChoiceButton,
  ChoiceGroup,
  EmptyState,
  FeedbackBanner,
  Grid,
  LoadingSkeleton,
  openForm,
  Page,
  Row,
  Text,
  usePageState,
} from "@alfred/ui";
import { functions, shell, useAsync, usePageContext, usePeerMessage, useTopBarSearch } from "@alfred/sdk";
import { CarteDeploiement } from "../lib/CarteDeploiement";
import { ouvrirExecution } from "../lib/Execution";
import {
  ACTIFS,
  aDesParametres,
  avecInstance,
  cleSelection,
  type Deploiement,
  type EtatDeploiement,
  formulaireParametres,
  lancer,
  nomComplet,
} from "../lib/prefect";

const FILTRES = [
  { id: "tous", label: "Tous" },
  { id: "echec", label: "En échec" },
  { id: "cours", label: "En cours" },
  { id: "suspendus", label: "Suspendus" },
] as const;

export default function Deploiements() {
  // Chaque onglet est la page d’un compte Prefect : Alfred lui donne son instance.
  const compte = usePageContext()?.instance ?? "";
  const recherche = useTopBarSearch({ label: "Rechercher un déploiement", placeholder: "Nom, flow, pool, étiquette…" });
  const [filtre, setFiltre] = usePageState<string>("filtre", "tous");
  const [selection, setSelection] = usePageState<string | null>("selection", null);
  // Le panneau Historique reste fermé tant que l’historique d’une carte n’a pas été demandé.
  const [historiqueDemande, setHistoriqueDemande] = usePageState<boolean>("historique.demande", false);

  const liste = useAsync(
    () =>
      functions.call<{ total: number; deploiements: Deploiement[] }>("lister-deploiements", { ...avecInstance(compte), limite: 200 }),
    [compte],
  );
  const deploiements = liste.data?.deploiements ?? [];

  const cleIds = deploiements.map((d) => d.id).join("|");
  const etats = useAsync(
    () =>
      deploiements.length === 0
        ? Promise.resolve(new Map<string, EtatDeploiement>())
        : functions
            .call<{ deploiements: EtatDeploiement[] }>("lire-dernieres-executions", {
              ...avecInstance(compte),
              deploiements: deploiements.slice(0, 60).map((d) => d.id),
            })
            .then((r) => new Map(r.deploiements.map((e) => [e.id, e]))),
    [compte, cleIds],
  );

  // Relecture : toutes les 10 s quand une exécution tourne, sinon toutes les 30 s.
  const [maintenant, setMaintenant] = useState(Date.now());
  const uneTourne = [...(etats.data?.values() ?? [])].some((e) => e.enCours > 0);
  useEffect(() => {
    const minuterie = setInterval(etats.reload, uneTourne ? 10_000 : 30_000);
    return () => clearInterval(minuterie);
  }, [uneTourne, etats.reload]);
  useEffect(() => {
    setMaintenant(Date.now());
    if (!uneTourne) return;
    const minuterie = setInterval(() => setMaintenant(Date.now()), 2_000);
    return () => clearInterval(minuterie);
  }, [uneTourne, etats.data]);

  // Le panneau est masqué par défaut ; une fois l’historique demandé, il garde son déploiement d’une visite à l’autre.
  useEffect(() => {
    if (!historiqueDemande) void shell.setPanelVisible(false);
    else if (selection) void shell.publish({ id: selection });
  }, []);
  usePeerMessage((message) => {
    const m = message as { type?: string; execution?: string };
    if (m?.type === "execution-modifiee") setTimeout(etats.reload, 1500);
    // Le panneau demande d’ouvrir les logs d’une exécution : la modale s’ouvre sur la page, pas dans le panneau.
    if (m?.type === "ouvrir-execution" && m.execution) void ouvrirExecution(compte, m.execution, actualiserTout);
  });

  const actualiserTout = () => {
    setTimeout(etats.reload, 1500);
    void shell.send({ type: "execution-modifiee" });
  };

  const ouvrirHistorique = (d: Deploiement) => {
    const cle = cleSelection(compte, d.id);
    setSelection(cle);
    setHistoriqueDemande(true);
    void shell.publish({ id: cle });
    void shell.setPanelVisible(true);
  };

  const visibles = deploiements.filter((d) => {
    if (!recherche.matches(d.nom, d.flux, d.pool, d.tags)) return false;
    const dernier = etats.data?.get(d.id)?.dernier;
    if (filtre === "echec") return Boolean(dernier && ["FAILED", "CRASHED"].includes(dernier.etat));
    if (filtre === "cours") return Boolean(dernier && ACTIFS.has(dernier.etat));
    if (filtre === "suspendus") return d.enPause;
    return true;
  });

  const enEchec = deploiements.filter((d) => ["FAILED", "CRASHED"].includes(etats.data?.get(d.id)?.dernier?.etat ?? "")).length;
  const enCours = deploiements.filter((d) => ACTIFS.has(etats.data?.get(d.id)?.dernier?.etat ?? "")).length;

  const actionsCarte = (d: Deploiement): Action[] => [
    {
      label: "Lancer avec d’autres paramètres…",
      hidden: !aDesParametres(d),
      onClick: () => openForm(formulaireParametres(d, compte, actualiserTout)),
    },
    {
      label: d.enPause ? "Reprendre les planifications" : "Suspendre les planifications",
      hidden: !d.enPause && d.planifications.length === 0,
      confirm: d.enPause ? undefined : `Suspendre « ${nomComplet(d)} » ?`,
      confirmMessage: d.enPause ? undefined : "Ses planifications ne créeront plus d’exécutions jusqu’à la reprise.",
      success: d.enPause ? "Déploiement repris" : "Déploiement suspendu",
      onClick: async () => {
        await functions.call("suspendre-deploiement", { ...avecInstance(compte), deploiement: d.id, suspendre: !d.enPause });
        liste.reload();
      },
    },
  ];

  const bar = (
    <Row gap="md">
      {deploiements.length > 0 ? (
        <ChoiceGroup appearance="segmented" label="Filtrer les déploiements">
          {FILTRES.map((f) => (
            <ChoiceButton key={f.id} label={f.label} variant="label" size="compact" selected={filtre === f.id} onClick={() => setFiltre(f.id)}>
              {f.label}
            </ChoiceButton>
          ))}
        </ChoiceGroup>
      ) : null}
      {deploiements.length > 0 ? (
        <Text as="span" size="meta" tone="muted">
          {deploiements.length} déploiement{deploiements.length > 1 ? "s" : ""}
          {enCours > 0 ? ` · ${enCours} en cours` : ""}
          {enEchec > 0 ? ` · ${enEchec} en échec` : ""}
        </Text>
      ) : null}
    </Row>
  );

  const actions: Action[] = [
    {
      label: "Actualiser",
      icon: RefreshCw,
      onClick: () => {
        liste.reload();
        etats.reload();
      },
    },
  ];

  let contenu;
  if (liste.error && !liste.data) {
    contenu = (
      <FeedbackBanner tone="danger" action={<Button onClick={liste.reload}>Réessayer</Button>}>
        Les déploiements n’ont pas pu être lus : {liste.error.message}
      </FeedbackBanner>
    );
  } else if (!liste.data) {
    contenu = <LoadingSkeleton variant="page" rows={4} label="Chargement des déploiements…" />;
  } else if (deploiements.length === 0) {
    contenu = (
      <EmptyState
        title="Aucun déploiement"
        description="Les déploiements créés sur cette instance Prefect apparaîtront ici, avec leur dernière exécution."
      />
    );
  } else if (visibles.length === 0) {
    contenu = (
      <EmptyState
        title="Aucun résultat"
        description="Aucun déploiement ne correspond à la recherche ou au filtre."
        action={
          <Button
            onClick={() => {
              recherche.clear();
              setFiltre("tous");
            }}
          >
            Effacer les filtres
          </Button>
        }
      />
    );
  } else {
    contenu = (
      <>
        {etats.error ? (
          <FeedbackBanner tone="danger" action={<Button onClick={etats.reload}>Réessayer</Button>}>
            Les dernières exécutions n’ont pas pu être lues : {etats.error.message}
          </FeedbackBanner>
        ) : null}
        <Grid minColumnWidth={300}>
          {visibles.map((d) => (
            <CarteDeploiement
              key={d.id}
              deploiement={d}
              etat={etats.data?.get(d.id)}
              maintenant={maintenant}
              onLogs={() => {
                const dernier = etats.data?.get(d.id)?.dernier;
                if (dernier) return ouvrirExecution(compte, dernier.id, actualiserTout);
              }}
              onLancer={async () => {
                await lancer(compte, d.id);
                actualiserTout();
              }}
              onHistorique={() => ouvrirHistorique(d)}
              autres={actionsCarte(d)}
            />
          ))}
        </Grid>
      </>
    );
  }

  return (
    <Page bar={bar} actions={actions}>
      {contenu}
    </Page>
  );
}
