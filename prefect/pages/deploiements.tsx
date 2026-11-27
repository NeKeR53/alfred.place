import { Row } from "@alfred/kit";
import {
  functions,
  notifyActionError,
  shell,
  useAlfredState,
  useAsync,
  usePageContext,
  usePageState,
  usePeerMessage,
} from "@alfred/sdk";
import { Pause, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type Action, Page, PageGrid, PageSection, SearchInput, Tabs, useOpenForm } from "socle-ui";
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

/** Lots de 60 déploiements au plus : la limite de l’état « etats-deploiements ». */
const TAILLE_LOT = 60;

type ReceptionLot = (cle: string, etats: EtatDeploiement[] | undefined, erreur: Error | undefined) => void;

/** Abonnement à l’état partagé d’un lot de déploiements : la valeur remonte à la page à chaque changement. Tant
 * qu’une exécution du lot tourne, l’état est relu toutes les 10 s ; `relance` le fait relire après une action. */
function AbonnementLot({
  compte,
  ids,
  relance,
  onLot,
}: {
  compte: string;
  ids: string[];
  relance: { n: number; delai: number };
  onLot: ReceptionLot;
}) {
  const cle = ids.join("|");
  const lot = useAlfredState<{ deploiements: EtatDeploiement[] }>("prefect/etats-deploiements", {
    instance: compte || undefined,
    params: { deploiements: ids },
  });
  useEffect(() => onLot(cle, lot.data?.deploiements, lot.error), [cle, lot.data, lot.error, onLot]);
  const tourne = (lot.data?.deploiements ?? []).some((e) => e.enCours > 0);
  useEffect(() => {
    if (!tourne) return;
    const minuterie = setInterval(() => void lot.refresh(), 10_000);
    return () => clearInterval(minuterie);
  }, [tourne, lot.refresh]);
  useEffect(() => {
    if (relance.n === 0) return;
    const minuterie = setTimeout(() => void lot.refresh(), relance.delai);
    return () => clearTimeout(minuterie);
  }, [relance, lot.refresh]);
  return null;
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

  // Les déploiements et leurs dernières exécutions sont des états partagés : la page reçoit chaque changement.
  const liste = useAlfredState<{ total: number; deploiements: Deploiement[] }>("prefect/deploiements", {
    instance: compte || undefined,
  });
  const deploiements = liste.data?.deploiements ?? [];

  const cleIds = deploiements.map((d) => d.id).join("|");
  const lots = useMemo(() => {
    const ids = cleIds ? cleIds.split("|") : [];
    const resultat: string[][] = [];
    for (let i = 0; i < ids.length; i += TAILLE_LOT) resultat.push(ids.slice(i, i + TAILLE_LOT));
    return resultat;
  }, [cleIds]);
  const [parLot, setParLot] = useState<Record<string, { etats?: EtatDeploiement[]; erreur?: Error }>>({});
  const recevoirLot = useCallback<ReceptionLot>(
    (cle, etatsLot, erreur) => setParLot((actuel) => ({ ...actuel, [cle]: { etats: etatsLot, erreur } })),
    [],
  );
  const [relance, setRelance] = useState({ n: 0, delai: 0 });
  const relire = (delai: number) => setRelance((actuel) => ({ n: actuel.n + 1, delai }));
  const etats = useMemo(() => {
    const data = new Map<string, EtatDeploiement>();
    let error: Error | undefined;
    for (const lot of lots) {
      const recu = parLot[lot.join("|")];
      for (const etat of recu?.etats ?? []) data.set(etat.id, etat);
      error ??= recu?.erreur;
    }
    return { data, error };
  }, [lots, parLot]);

  // Une exécution tourne : l’avancement des cartes avance toutes les 2 s.
  const [maintenant, setMaintenant] = useState(Date.now());
  const uneTourne = [...etats.data.values()].some((e) => e.enCours > 0);
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
      void shell.notify({
        title: "L’analyse de l’échec n’a pas abouti",
        description: (erreur as Error).message,
        tone: "error",
      });
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
    if (m?.type === "execution-modifiee") relire(1500);
    // Le panneau demande d’ouvrir les logs d’une exécution : la modale s’ouvre sur la page, pas dans le panneau.
    if (m?.type === "ouvrir-execution" && m.execution)
      setFenetre({ kind: "execution", instance: compte, id: m.execution });
  });

  const actualiserTout = () => {
    relire(1500);
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
  const plier = (texte: string) =>
    texte
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase("fr");
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

  const enEchec = deploiements.filter((d) =>
    ["FAILED", "CRASHED"].includes(etats.data?.get(d.id)?.dernier?.etat ?? ""),
  ).length;
  const enCours = deploiements.filter((d) => ACTIFS.has(etats.data?.get(d.id)?.dernier?.etat ?? "")).length;
  const compteDe: Record<string, number> = {
    tous: deploiements.length,
    echec: enEchec,
    cours: enCours,
    suspendus: deploiements.filter((d) => d.enPause).length,
  };

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
        await functions.call("suspendre-deploiement", {
          ...avecInstance(compte),
          deploiement: d.id,
          suspendre: !d.enPause,
        });
        shell.notify({ title: d.enPause ? "Déploiement repris" : "Déploiement suspendu", tone: "success" });
        void liste.refresh();
      },
    },
  ];

  const barre =
    deploiements.length > 0 ? (
      <Row gap="md" wrap>
        {/* Les nombres sont dans les onglets : la barre tient dans une fenêtre étroite. */}
        <Tabs
          pageTitle="Déploiements Prefect"
          items={FILTRES.map((f) => ({ id: f.id, label: `${f.label} (${compteDe[f.id]})` }))}
          selectedId={filtre}
          onSelectionChange={setFiltre}
        />
        <SearchInput label="les déploiements" onChange={({ text }) => setRecherche(text)} />
      </Row>
    ) : undefined;

  const actions: Action[] = [
    {
      id: "actualiser",
      label: "Actualiser",
      icon: <RefreshCw size={16} />,
      onPress: () => {
        void liste.refresh();
        relire(0);
      },
    },
  ];

  return (
    <Page
      toolbar={barre}
      actions={actions}
      onActionError={notifyActionError}
      state={liste.error && !liste.data ? "error" : !liste.data ? "loading" : "ready"}
      onRetry={() => void liste.refresh()}
      loadingLabel="Chargement des déploiements…"
    >
      {deploiements.length === 0 ? (
        <PageSection
          title="Déploiements"
          empty={{
            title: "Aucun déploiement",
            description:
              "Les déploiements créés sur cette instance Prefect apparaîtront ici, avec leur dernière exécution.",
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
        <PageGrid columns={3}>
          {visibles.map((d) => {
            const etat = etats.data?.get(d.id);
            return (
                <CarteDeploiement
                  key={d.id}
                  deploiement={d}
                  etat={
                    etats.error
                      ? {
                          ...(etat as EtatDeploiement),
                          erreur: `Les dernières exécutions n’ont pas pu être lues : ${etats.error.message}`,
                        }
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
          })}
        </PageGrid>
      )}
      {lots.map((ids) => (
        <AbonnementLot key={ids.join("|")} compte={compte} ids={ids} relance={relance} onLot={recevoirLot} />
      ))}
      <Fenetres fenetre={fenetre} onClose={() => setFenetre(null)} ouvrir={setFenetre} apres={rapports.reload} />
    </Page>
  );
}
