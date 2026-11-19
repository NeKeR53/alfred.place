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
import { functions, shell, useAsync, usePageContext, usePeerMessage } from "@alfred/sdk";
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
  const [recherche, setRecherche] = usePageState<string>("recherche", "");
  const [filtre, setFiltre] = usePageState<string>("filtre", "tous");
  const [selection, setSelection] = usePageState<string | null>("selection", null);

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

  // Le panneau garde le déploiement ouvert d’une visite à l’autre, et prévient après un lancement.
  useEffect(() => {
    if (selection) void shell.publish({ id: selection });
  }, []);
  usePeerMessage((message) => {
    if ((message as { type?: string })?.type === "execution-modifiee") setTimeout(etats.reload, 1500);
  });

  const actualiserTout = () => {
    setTimeout(etats.reload, 1500);
    void shell.send({ type: "execution-modifiee" });
  };

  const ouvrirHistorique = (d: Deploiement) => {
    const cle = cleSelection(compte, d.id);
    setSelection(cle);
    void shell.publish({ id: cle });
    void shell.setPanelVisible(true);
  };

  const texte = recherche.trim().toLowerCase();
  const visibles = deploiements.filter((d) => {
    if (texte && ![d.nom, d.flux, d.pool ?? "", ...d.tags].some((t) => t.toLowerCase().includes(texte))) return false;
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
    <Row gap="md" wrap>
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
              setRecherche("");
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
              onLancer={async () => {
                await lancer(compte, d.id);
                actualiserTout();
              }}
              onHistorique={() => ouvrirHistorique(d)}
              onDernier={async () => {
                const dernier = etats.data?.get(d.id)?.dernier;
                if (dernier) await ouvrirExecution(compte, dernier.id, actualiserTout);
              }}
              autres={actionsCarte(d)}
            />
          ))}
        </Grid>
      </>
    );
  }

  return (
    <Page search={{ label: "Rechercher un déploiement", value: recherche, onChange: setRecherche }} bar={bar} actions={actions}>
      {contenu}
    </Page>
  );
}
