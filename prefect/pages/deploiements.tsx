import { Row, Text } from "@alfred/kit";
import { functions, notifyActionError, shell, useAsync, usePageContext, usePageState, usePeerMessage } from "@alfred/sdk";
import { Pause, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import { type Action, Page, PageSection, RadioGroup, SearchField, useOpenForm } from "socle-ui";
import { CarteDeploiement } from "../lib/CarteDeploiement";
import { type Fenetre, Fenetres, ouvrirRapport } from "../lib/ouvrir-rapport";
import { type Rapport, rapportsParExecution } from "../lib/rapport";
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

/** États de tous les déploiements, par lots de 60 (la limite de `lire-dernieres-executions`), un lot après l’autre
 * pour ne pas surcharger Prefect. */
async function lireEtats(compte: string, ids: string[]): Promise<Map<string, EtatDeploiement>> {
  const etats = new Map<string, EtatDeploiement>();
  for (let i = 0; i < ids.length; i += 60) {
    const lot = await functions.call<{ deploiements: EtatDeploiement[] }>("lire-dernieres-executions", {
      ...avecInstance(compte),
      deploiements: ids.slice(i, i + 60),
    });
    for (const etat of lot.deploiements) etats.set(etat.id, etat);
  }
  return etats;
}

export default function Deploiements() {
  // Chaque onglet est la page d’un compte Prefect : Alfred lui donne son instance.
  const compte = usePageContext()?.instance ?? "";
  const [recherche, setRecherche] = useState("");
  const openForm = useOpenForm();
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const [filtre, setFiltre] = usePageState<string>("filtre", "tous");
  const [selection, setSelection] = usePageState<string | null>("selection", null);
  // Le panneau Historique reste fermé tant que l’historique d’une carte n’a pas été demandé.
  const [historiqueDemande, setHistoriqueDemande] = usePageState<boolean>("historique.demande", false);

  const liste = useAsync(
    () =>
      functions.call<{ total: number; deploiements: Deploiement[] }>("lister-deploiements", { ...avecInstance(compte) }),
    [compte],
  );
  const deploiements = liste.data?.deploiements ?? [];

  const cleIds = deploiements.map((d) => d.id).join("|");
  const etats = useAsync(
    () =>
      deploiements.length === 0
        ? Promise.resolve(new Map<string, EtatDeploiement>())
        : lireEtats(compte, deploiements.map((d) => d.id)),
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

  // Rapports d’échec : relus avec les états, pour mettre la cause sous chaque déploiement en échec.
  const rapports = useAsync(() => rapportsParExecution(compte), [compte, etats.data]);
  const [enAnalyse, setEnAnalyse] = useState<Set<string>>(new Set());
  const analyser = async (execution: string) => {
    setEnAnalyse((actuel) => new Set(actuel).add(execution));
    try {
      const rapport = await functions.call<Rapport>("analyser-echec", { ...avecInstance(compte), execution });
      rapports.reload();
      setFenetre(ouvrirRapport(rapport, rapports.reload));
    } catch (erreur) {
      rapports.reload();
      void shell.notify({ title: "L’analyse de l’échec n’a pas abouti", description: (erreur as Error).message, tone: "error" });
    } finally {
      setEnAnalyse((actuel) => {
        const suivant = new Set(actuel);
        suivant.delete(execution);
        return suivant;
      });
    }
  };

  // Le panneau est masqué par défaut ; une fois l’historique demandé, il garde son déploiement d’une visite à l’autre.
  useEffect(() => {
    if (!historiqueDemande) void shell.setPanelVisible(false);
    else if (selection) void shell.publish({ id: selection });
  }, []);
  usePeerMessage((message) => {
    const m = message as { type?: string; execution?: string };
    if (m?.type === "execution-modifiee") setTimeout(etats.reload, 1500);
    // Le panneau demande d’ouvrir les logs d’une exécution : la modale s’ouvre sur la page, pas dans le panneau.
    if (m?.type === "ouvrir-execution" && m.execution) setFenetre({ kind: "execution", instance: compte, id: m.execution });
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

  /** Sans casse ni accents : chaque mot cherché doit apparaître dans le nom, le flow, le pool ou une étiquette. */
  const plier = (texte: string) => texte.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr");
  const mots = plier(recherche).split(/\s+/).filter(Boolean);
  const visibles = deploiements.filter((d) => {
    const texte = plier([d.nom, d.flux, d.pool ?? "", ...d.tags].join(" "));
    if (!mots.every((mot) => texte.includes(mot))) return false;
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
      id: "parametres",
      label: "Lancer avec d’autres paramètres…",
      icon: <SlidersHorizontal size={16} />,
      isHidden: !aDesParametres(d),
      onPress: () => openForm(formulaireParametres(d, compte, actualiserTout)),
    },
    {
      id: "suspendre",
      label: d.enPause ? "Reprendre les planifications" : "Suspendre les planifications",
      icon: <Pause size={16} />,
      isHidden: !d.enPause && d.planifications.length === 0,
      confirm: d.enPause
        ? undefined
        : {
            title: `Suspendre « ${nomComplet(d)} » ?`,
            message: "Ses planifications ne créeront plus d’exécutions jusqu’à la reprise.",
            confirmLabel: "Suspendre",
          },
      onPress: async () => {
        await functions.call("suspendre-deploiement", { ...avecInstance(compte), deploiement: d.id, suspendre: !d.enPause });
        shell.notify({ title: d.enPause ? "Déploiement repris" : "Déploiement suspendu", tone: "success" });
        liste.reload();
      },
    },
  ];

  const barre =
    deploiements.length > 0 ? (
      <Row gap="md">
        <SearchField label="les déploiements" onChange={({ text }) => setRecherche(text)} />
        <RadioGroup
          label="Filtrer les déploiements"
          hideLabel
          orientation="horizontal"
          value={filtre}
          onChange={setFiltre}
        >
          {FILTRES.map((f) => (
            <RadioGroup.Option key={f.id} value={f.id}>
              {f.label}
            </RadioGroup.Option>
          ))}
        </RadioGroup>
        <Text as="span" size="meta" tone="muted">
          {`${deploiements.length} déploiement${deploiements.length > 1 ? "s" : ""}${
            enCours > 0 ? ` · ${enCours} en cours` : ""
          }${enEchec > 0 ? ` · ${enEchec} en échec` : ""}`}
        </Text>
      </Row>
    ) : undefined;

  const actions: Action[] = [
    {
      id: "actualiser",
      label: "Actualiser",
      icon: <RefreshCw size={16} />,
      onPress: () => {
        liste.reload();
        etats.reload();
      },
    },
  ];

  return (
    <Page
      toolbar={barre}
      actions={actions}
      onActionError={notifyActionError}
      state={liste.error && !liste.data ? "error" : !liste.data ? "loading" : "ready"}
      onRetry={liste.reload}
      loadingLabel="Chargement des déploiements…"
    >
      {deploiements.length === 0 ? (
        <PageSection
          title="Déploiements"
          empty={{
            title: "Aucun déploiement",
            description: "Les déploiements créés sur cette instance Prefect apparaîtront ici, avec leur dernière exécution.",
          }}
        >
          {null}
        </PageSection>
      ) : visibles.length === 0 ? (
        <PageSection
          title="Déploiements"
          empty={{
            title: "Aucun résultat",
            description: "Aucun déploiement ne correspond à la recherche ou au filtre.",
            action: { id: "effacer", label: "Afficher tous les déploiements", onPress: () => setFiltre("tous") },
          }}
        >
          {null}
        </PageSection>
      ) : (
        visibles.map((d) => {
          const etat = etats.data?.get(d.id);
          return (
            <CarteDeploiement
              key={d.id}
              deploiement={d}
              etat={
                etats.error
                  ? { ...(etat as EtatDeploiement), erreur: `Les dernières exécutions n’ont pas pu être lues : ${etats.error.message}` }
                  : etat
              }
              maintenant={maintenant}
              onLogs={() => {
                const dernier = etat?.dernier;
                if (dernier) setFenetre({ kind: "execution", instance: compte, id: dernier.id });
              }}
              onLancer={async () => {
                await lancer(compte, d.id);
                shell.notify({ title: "Exécution lancée", tone: "success" });
                actualiserTout();
              }}
              onHistorique={() => ouvrirHistorique(d)}
              selectionnee={historiqueDemande && selection === cleSelection(compte, d.id)}
              rapport={etat?.dernier ? rapports.data?.get(etat.dernier.id) : undefined}
              enAnalyse={enAnalyse.has(etat?.dernier?.id ?? "")}
              onRapport={(rapport) => setFenetre(ouvrirRapport(rapport, rapports.reload))}
              onAnalyser={() => (etat?.dernier ? analyser(etat.dernier.id) : Promise.resolve())}
              autres={actionsCarte(d)}
            />
          );
        })
      )}
      <Fenetres fenetre={fenetre} onClose={() => setFenetre(null)} ouvrir={setFenetre} apres={rapports.reload} />
    </Page>
  );
}
