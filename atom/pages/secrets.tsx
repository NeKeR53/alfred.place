import { Notice, Row, Stack, Text } from "@alfred/kit";
import { matchesSearch, searchTerms, shell, useAsync, usePageState, usePeerMessage } from "@alfred/sdk";
import { ChevronsDownUp, ChevronsUpDown, Download, Folder, FolderOpen, KeyRound, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  type Action,
  Button,
  EmptyState,
  Page,
  PageSection,
  SearchInput,
  Select,
  Table,
  type TableColumn,
  Tabs,
  TreeView,
  type TreeNode,
  useConfirm,
} from "socle-ui";
import { environnementsAvec } from "../lib/environnements";
import {
  chargerCible,
  cheminComposant,
  cleChargee,
  cleCible,
  copierArborescence,
  decouvrirCibles,
  type EnvOpenBao,
  gerable,
  LIBELLES_PORTEE,
  type Ligne,
  libelleProduit,
  listeurPartage,
  manquantsParEnv,
  nomVariable,
  type Reference,
  referencesComposant,
  type ResultatCible,
  telechargerEnv,
  titreGroupe,
} from "../lib/secrets";
import { functions, useResumeAtom } from "../lib/source";
import { actionCopie, ChoixCopie, type SelectionVariable } from "../lib/choix-copie";
import { EditeurSecret, type Edition } from "../lib/editeur-secret";

type Vue = "ensemble" | "inventaire";

const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const cleLigne = (ligne: Ligne) => `${ligne.produit}|${ligne.composant}|${ligne.nom}`;

/** Choix de la vue, en tête de la barre de chaque vue. */
function ChoixVue({ vue, onChange }: { vue: Vue; onChange: (vue: Vue) => void }) {
  return (
    <Tabs
      pageTitle="Secrets"
      items={[
        { id: "ensemble", label: "Vue d’ensemble" },
        { id: "inventaire", label: "Inventaire" },
      ]}
      selectedId={vue}
      onSelectionChange={(valeur) => {
        if (valeur === "ensemble" || valeur === "inventaire") onChange(valeur);
      }}
    />
  );
}

/** Ce que chaque vue reçoit de la page : sa barre (vue, recherche) et l’actualisation. */
type Commun = {
  envs: EnvOpenBao[];
  requete: string;
  barre: ReactNode;
  actualiser: Action;
  actualisation: number;
};

/** Secrets : inventaire OpenBao de chaque composant, comme la page Secrets de OneApp (vue d’ensemble et inventaire). */
export default function SecretsPage() {
  const [vue, setVue] = usePageState<Vue>("vue", "ensemble");
  const [cibleInventaire, setCibleInventaire] = usePageState<string>("inventaire.cible", "");
  const [actualisation, setActualisation] = useState(0);
  const [requete, setRequete] = useState("");
  useResumeAtom((demo) => (demo ? "" : "Lus dans OpenBao, jamais enregistrés par Alfred"));
  const envs = useAsync(() => environnementsAvec("openbao"), []);
  const liste = envs.data ?? [];
  const changerVue = (suivante: Vue) => {
    setRequete("");
    setVue(suivante);
  };

  if (envs.error || !envs.data) return <Page state={envs.error ? "error" : "loading"} onRetry={envs.reload}>{null}</Page>;
  if (!liste.length)
    return (
      <Page>
        <EmptyState
          title="Aucun coffre de secrets"
          description="Associez une connexion OpenBao à un environnement pour consulter les secrets ici."
          action={
            <Button variant="primary" onPress={() => void shell.navigate("atom/atom")}>
              Ouvrir les environnements
            </Button>
          }
        />
      </Page>
    );
  const commun: Commun = {
    envs: liste,
    requete,
    actualisation,
    actualiser: { id: "actualiser", label: "Actualiser (F5)", icon: <RefreshCw size={16} />, onPress: () => setActualisation((n) => n + 1) },
    barre: (
      <>
        <ChoixVue vue={vue} onChange={changerVue} />
        <SearchInput
          key={vue}
          label={vue === "ensemble" ? "les variables, produits et composants" : "les variables et emplacements"}
          onChange={({ text }) => setRequete(text)}
        />
      </>
    ),
  };
  return vue === "ensemble" ? (
    <VueEnsemble
      {...commun}
      onOuvrirInventaire={(produit, composant) => {
        setCibleInventaire(`${produit}|${composant}`);
        changerVue("inventaire");
      }}
    />
  ) : (
    <Inventaire {...commun} cible={cibleInventaire} onCibleChange={setCibleInventaire} />
  );
}

// ------------------------------------------------------------------------------------------------ Vue d’ensemble
type Resultat = ResultatCible & { perime?: boolean };

function VueEnsemble({
  envs,
  requete,
  barre,
  actualiser,
  actualisation,
  onOuvrirInventaire,
}: Commun & { onOuvrirInventaire: (produit: string, composant: string) => void }) {
  const [relecture, setRelecture] = useState(0);
  const [cibles, setCibles] = useState<{ produit: string; composant: string }[]>();
  const [resultats, setResultats] = useState<ReadonlyMap<string, Resultat>>(new Map());
  const [erreursCibles, setErreursCibles] = useState<string[]>([]);
  const [choisie, setChoisie] = usePageState<string>("variable", "");
  const [arborescence, setArborescence] = useState<{ produit: string; composant: string }>();
  const relire = () => setRelecture((n) => n + 1);

  // Le bouton Actualiser de la barre et F5 relisent OpenBao.
  const premiere = useRef(actualisation);
  // biome-ignore lint/correctness/useExhaustiveDependencies: seule une nouvelle actualisation relit.
  useEffect(() => {
    if (premiere.current !== actualisation) relire();
    premiere.current = actualisation;
  }, [actualisation]);
  useEffect(() => {
    const touche = (event: KeyboardEvent) => {
      if (event.key !== "F5") return;
      event.preventDefault();
      relire();
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, []);
  // Chaque composant est lu dans tous les environnements, puis affiché dès qu’il arrive ; les résultats déjà là restent
  // visibles (périmés) jusqu’à l’arrivée des nouveaux.
  useEffect(() => {
    let annule = false;
    setResultats((courants) => new Map([...courants].map(([cle, resultat]) => [cle, { ...resultat, perime: true }])));
    void decouvrirCibles(envs).then(({ cibles: trouvees, erreurs }) => {
      if (annule) return;
      setCibles(trouvees);
      setErreursCibles(erreurs);
      const lister = listeurPartage();
      for (const cible of trouvees)
        void chargerCible(cible, envs, lister)
          .catch((erreur: unknown): ResultatCible => ({ lignes: [], charges: [], erreurs: [`${titreGroupe(cible)} · ${(erreur as Error).message}`] }))
          .then((resultat) => {
            if (!annule) setResultats((courants) => new Map(courants).set(cleCible(cible), resultat));
          });
    });
    return () => {
      annule = true;
    };
  }, [envs, relecture]);

  const cibleListe = cibles ?? [];
  const faits = cibleListe.flatMap((cible) => {
    const resultat = resultats.get(cleCible(cible));
    return resultat ? [resultat] : [];
  });
  const lignes = faits.flatMap((resultat) => resultat.lignes);
  const charges = new Set(faits.flatMap((resultat) => resultat.charges));
  const erreurs = [...erreursCibles, ...faits.flatMap((resultat) => resultat.erreurs)];
  const enAttente = cibleListe.filter((cible) => !resultats.has(cleCible(cible)) || resultats.get(cleCible(cible))?.perime);
  const sansResultat = cibleListe.filter((cible) => !resultats.has(cleCible(cible)));
  const chargement = !cibles || enAttente.length > 0;
  const lu = (ligne: Ligne, env: string) => charges.has(cleChargee(ligne.produit, ligne.composant, env));
  const manquesDe = (ligne: Ligne) => envs.filter((env) => lu(ligne, env.id) && !ligne.presente[env.id]).map((env) => env.nom);
  const visibles = lignes.filter((ligne) => {
    const manques = manquesDe(ligne);
    return matchesSearch(requete, [ligne.nom, ligne.cle, libelleProduit(ligne.produit), ligne.composant, ...manques, manques.length ? "manquant" : undefined]);
  });
  const ecarts = manquantsParEnv(lignes, envs, charges);
  // Comme OneApp : la variable choisie, ou la première affichée.
  const courante = visibles.find((ligne) => cleLigne(ligne) === choisie) ?? visibles[0];
  const copieCourante = Boolean(courante) && arborescence?.produit === courante?.produit && arborescence?.composant === courante?.composant;

  // Le panneau Variable reçoit la ligne choisie et ce qu’il faut pour copier, sans relire OpenBao.
  const publiee = courante
    ? JSON.stringify({
        ligne: courante,
        envs: envs.map((env) => ({ id: env.id, nom: env.nom, instance: env.instance, charge: lu(courante, env.id) })),
        copieArborescence: copieCourante,
      } satisfies SelectionVariable)
    : "";
  const dejaOuvert = useRef(false);
  useEffect(() => {
    if (!publiee) return;
    void shell.publish(JSON.parse(publiee));
    if (!dejaOuvert.current) {
      dejaOuvert.current = true;
      void shell.setPanelVisible(true);
    }
  }, [publiee]);
  usePeerMessage((message) => {
    const m = message as { relire?: boolean; ouvrirInventaire?: { produit: string; composant: string }; arborescence?: { produit: string; composant: string } | null };
    if (m.relire) relire();
    if (m.ouvrirInventaire) onOuvrirInventaire(m.ouvrirInventaire.produit, m.ouvrirInventaire.composant);
    if (m.arborescence !== undefined) setArborescence(m.arborescence ?? undefined);
  });

  const colonnes: TableColumn[] = [
    // La variable prend la place restante ; le code de l’environnement suffit en en-tête pour que six colonnes tiennent.
    { id: "variable", label: "Variable d’environnement" },
    ...envs.map((env): TableColumn => ({ id: env.id, label: env.code || env.nom, width: 100 })),
  ];
  const resume = chargement
    ? `Chargement… ${cibleListe.length - enAttente.length}/${pluriel(cibleListe.length, "composant")}`
    : [
        `${pluriel(visibles.length, "variable")} affichée${visibles.length > 1 ? "s" : ""}`,
        ...ecarts.map(({ nom, nombre }) => `${nombre} manquant${nombre > 1 ? "s" : ""} en ${nom}`),
      ].join(" · ");
  return (
    <Page
      fill
      toolbar={<Row gap="sm">{barre}</Row>}
      actions={[actualiser]}
    >
      {/* Le résumé va en tête du contenu, où il passe à la ligne : dans la barre, il débordait. Un seul bloc, comme
          la page Accès, pour que le résumé ne prenne pas une part de la hauteur. */}
      <Stack gap="sm">
      <Text tone={chargement || !ecarts.length ? "muted" : "warning"} size="meta">
        {resume}
      </Text>
      {arborescence ? (
        <CopieArborescence key={cleCible(arborescence)} {...arborescence} envs={envs} charges={charges} onCopie={relire} />
      ) : null}
      {erreurs.length || sansResultat.length ? (
        <Stack gap="xs">
          {erreurs.map((erreur) => (
            <Text key={erreur} tone="danger" size="meta">{`OpenBao · ${erreur}`}</Text>
          ))}
          {sansResultat.map((cible) => (
            <Text key={cleCible(cible)} tone="muted" size="meta">{`${titreGroupe(cible)} · Lecture des secrets…`}</Text>
          ))}
        </Stack>
      ) : null}
      {visibles.length || !cibles ? (
        <Table<Ligne & { id: string }>
          label="Variables d’environnement par environnement"
          density="compact"
          selectionMode="single"
          columns={colonnes}
          rows={visibles.map((ligne) => ({ ...ligne, id: cleLigne(ligne) }))}
          searchTerms={searchTerms(requete)}
          groupBy={(ligne) => titreGroupe(ligne)}
          selectedKeys={courante ? [cleLigne(courante)] : []}
          onSelectionChange={(cles) => {
            const [cle] = [...cles];
            if (cle === undefined) return;
            setChoisie(String(cle));
            void shell.setPanelVisible(true);
          }}
          isLoading={!cibles}
          renderCell={(ligne, colonne) => {
            if (colonne === "variable") return ligne.nom;
            // Comme OneApp : une variable manquante est signalée en rouge ; une case non lue reste « — ».
            if (!lu(ligne, colonne))
              return (
                <Text tone="muted" as="span">
                  —
                </Text>
              );
            return ligne.presente[colonne] ? (
              <Text tone="success" as="span">
                ✓
              </Text>
            ) : (
              <Text tone="danger" weight="strong" as="span">
                ◆ manquant
              </Text>
            );
          }}
        />
      ) : (
        <EmptyState title={chargement ? "Lecture des secrets…" : "Aucune variable trouvée"} />
      )}
      </Stack>
    </Page>
  );
}

/** Copie de tous les documents d’un composant vers d’autres environnements, ouverte depuis le panneau d’une variable. */
function CopieArborescence({
  produit,
  composant,
  envs,
  charges,
  onCopie,
}: {
  produit: string;
  composant: string;
  envs: EnvOpenBao[];
  charges: ReadonlySet<string>;
  onCopie: () => void;
}) {
  const sources = envs.filter((env) => charges.has(cleChargee(produit, composant, env.id)));
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [destinations, setDestinations] = useState<string[]>([]);
  const [enCours, setEnCours] = useState(false);
  const source = sources.find((env) => env.id === sourceId) ?? sources[0];
  const disponibles = envs.filter((env) => source && env.instance !== source.instance && charges.has(cleChargee(produit, composant, env.id)));
  if (!source || !disponibles.length) return null;

  const copier = async () => {
    if (!destinations.length || enCours) return;
    setEnCours(true);
    try {
      const { documents, copies, ignores, echecs } = await copierArborescence(source, disponibles.filter((env) => destinations.includes(env.id)), produit, composant);
      if (copies) {
        void shell.notify({
          tone: "success",
          title: `${pluriel(copies, "document")} copié${copies > 1 ? "s" : ""}`,
          description: ignores ? `${ignores} déjà présent${ignores > 1 ? "s" : ""} ignoré${ignores > 1 ? "s" : ""}.` : undefined,
        });
        onCopie();
      } else if (ignores && !echecs.length) {
        void shell.notify({ tone: "info", title: "Aucun document à copier", description: `${ignores} déjà présent${ignores > 1 ? "s" : ""}.` });
      } else if (!documents) {
        void shell.notify({ tone: "info", title: "Aucun document dans cette arborescence" });
      }
      if (echecs.length) void shell.notify({ tone: "error", title: "Certains documents n’ont pas été copiés", description: echecs.join(" · ") });
    } catch (erreur) {
      void shell.notify({ tone: "error", title: "Lecture de l’arborescence impossible", description: (erreur as Error).message || "Réessayez." });
    } finally {
      setDestinations([]);
      setEnCours(false);
    }
  };

  return (
    <PageSection
      title={`Copier l’arborescence de ${libelleProduit(produit)} › ${composant}`}
      description="Les documents déjà présents à destination sont ignorés. Aucune valeur n’est affichée."
      actions={[actionCopie(destinations, enCours, () => void copier(), "Copier les documents")]}
    >
      <ChoixCopie
        sources={sources}
        sourceId={source.id}
        onSource={(id) => {
          setSourceId(id);
          setDestinations([]);
        }}
        disponibles={disponibles}
        destinations={destinations}
        onDestinations={setDestinations}
        enCours={enCours}
      />
    </PageSection>
  );
}

// ------------------------------------------------------------------------------------------------ Inventaire
type Affichage = "tableau" | "arborescence";

function Inventaire({
  envs,
  requete,
  barre,
  actualiser,
  actualisation,
  cible,
  onCibleChange,
}: Commun & { cible: string; onCibleChange: (cible: string) => void }) {
  const [envId, setEnvId] = usePageState<string>("inventaire.environnement", "");
  const [affichage, setAffichage] = usePageState<Affichage>("inventaire.affichage", "tableau");
  const [replies, setReplies] = useState<ReadonlySet<string>>(new Set());
  const [modification, setModification] = useState(0);
  const [enCours, setEnCours] = useState(false);
  const [telechargement, setTelechargement] = useState(false);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [tri, setTri] = useState<{ column: string; direction: "ascending" | "descending" }>({ column: "variable", direction: "ascending" });
  const confirm = useConfirm();
  const env = envs.find((e) => e.id === envId) ?? envs[0];
  const decouverte = useAsync(() => decouvrirCibles(envs), [envs, actualisation, modification]);
  const produits = [...new Set((decouverte.data?.cibles ?? []).map((c) => c.produit))];
  const [produitChoisi, composantChoisi] = cible.split("|");
  const produit = produits.includes(produitChoisi) ? produitChoisi : (produits[0] ?? "");
  const composants = (decouverte.data?.cibles ?? [])
    .filter((c) => c.produit === produit)
    .map((c) => c.composant)
    .sort((a, b) => a.localeCompare(b, "fr"));
  const composant = composants.includes(composantChoisi ?? "") ? composantChoisi : (composants[0] ?? "");
  const references = useAsync(
    () => (env && produit && composant ? referencesComposant(env, produit, composant, listeurPartage()) : Promise.resolve([] as Reference[])),
    [env?.id, produit, composant, actualisation, modification],
  );
  const relire = () => setModification((n) => n + 1);
  // Comme OneApp : l’inventaire n’a pas de panneau de détail ; la vue d’ensemble le rouvre sur sa variable.
  useEffect(() => {
    void shell.setPanelVisible(false);
  }, []);
  const items = references.data ?? [];
  const visibles = useMemo(
    () => items.filter((item) => matchesSearch(requete, [nomVariable(item.emplacement, item.cle), LIBELLES_PORTEE[item.portee], item.emplacement])),
    [items, requete],
  );
  const parNoeud = useMemo(() => new Map(visibles.map((item) => [`k:${item.id}`, item])), [visibles]);
  const arbre = useMemo(() => construireArbre(visibles), [visibles]);
  const toutReplie = arbre.dossiers.length > 0 && arbre.dossiers.every((id) => replies.has(id));
  const rechercheActive = Boolean(requete.trim());
  const chargement = decouverte.loading || references.loading;
  const cheminCourant = produit && composant ? cheminComposant(produit, composant) : "";

  const portees = [
    { id: "component", libelle: "Composant", base: cheminCourant },
    ...(produit ? [{ id: "product", libelle: "Produit logiciel", base: `${produit.toLowerCase()}/shared` }] : []),
  ];
  const titreSuppression = (item: Reference) => `Supprimer la clé « ${item.cle} » du document « ${item.emplacement} » ?`;
  const supprimer = async (item: Reference) => {
    if (!env || !gerable(item)) return;
    setEnCours(true);
    try {
      await functions.call("openbao/supprimer-cle", { instance: env.instance, chemin: item.emplacement, cle: item.cle });
      relire();
    } catch (erreur) {
      void shell.notify({
        tone: "error",
        title: "Suppression impossible",
        description: (erreur as Error).message || "Impossible de supprimer le secret OpenBao.",
      });
    } finally {
      setEnCours(false);
    }
  };
  const demanderSuppression = (item: Reference) =>
    confirm({ title: titreSuppression(item), confirmLabel: "Supprimer", onConfirm: () => supprimer(item) });
  const telecharger = async () => {
    if (!env || !composant || !items.length) return;
    setTelechargement(true);
    try {
      await telechargerEnv(env, composant, items);
    } catch (erreur) {
      void shell.notify({ tone: "error", title: "Fichier .env non téléchargé", description: (erreur as Error).message || "Téléchargement impossible." });
    } finally {
      setTelechargement(false);
    }
  };
  const modifier = (item: Reference) => setEdition({ mode: "edit", chemin: item.emplacement, portees: [] });

  // Barre de l’inventaire, comme OneApp : produit, composant, environnement, affichage, puis les actions à droite.
  const toolbar = (
    <Row gap="sm">
      {barre}
      <Select
        label="Produit logiciel"
        hideLabel
        isRequired
        width="sm"
        value={produit || null}
        options={produits.map((p) => ({ id: p, label: libelleProduit(p) }))}
        onChange={(p) => p && onCibleChange(`${p}|`)}
      />
      <Select
        label="Composant logiciel"
        hideLabel
        isRequired
        width="sm"
        placeholder="Aucun composant"
        isDisabled={!composants.length}
        value={composant || null}
        options={composants.map((c) => ({ id: c, label: c }))}
        onChange={(c) => c && onCibleChange(`${produit}|${c}`)}
      />
      <Select
        label="Environnement"
        hideLabel
        isRequired
        width="sm"
        value={env?.id ?? null}
        options={envs.map((e) => ({ id: e.id, label: e.nom }))}
        onChange={(id) => id && setEnvId(id)}
      />
      <Select
        label="Affichage"
        hideLabel
        isRequired
        width="sm"
        value={affichage}
        options={[
          { id: "tableau", label: "Tableau" },
          { id: "arborescence", label: "Arborescence" },
        ]}
        onChange={(v) => (v === "tableau" || v === "arborescence") && setAffichage(v)}
      />
    </Row>
  );
  const actions: Action[] = [
    {
      id: "ajouter",
      label: "Ajouter un secret",
      icon: <Plus size={16} />,
      isHidden: !env || !composant,
      onPress: () => setEdition({ mode: "create", chemin: "", portees }),
    },
    {
      id: "replier",
      label: toutReplie ? "Tout déplier" : "Tout replier",
      icon: toutReplie ? <ChevronsUpDown size={16} /> : <ChevronsDownUp size={16} />,
      isHidden: affichage !== "arborescence",
      isDisabled: !arbre.dossiers.length || rechercheActive,
      onPress: () => setReplies(toutReplie ? new Set() : new Set(arbre.dossiers)),
    },
    {
      id: "telecharger",
      label: "Télécharger le fichier .env",
      icon: <Download size={16} />,
      isDisabled: !items.length || chargement || enCours || telechargement,
      onPress: telecharger,
    },
    actualiser,
  ];

  const colonnes: TableColumn[] = [
    { id: "variable", label: "Variable d’environnement", width: 300, sortable: true },
    { id: "portee", label: "Portée", width: 190, sortable: true },
    { id: "emplacement", label: "Emplacement", sortable: true },
  ];
  const valeurTri = (item: Reference) =>
    tri.column === "portee" ? LIBELLES_PORTEE[item.portee] : tri.column === "emplacement" ? `${item.emplacement}#${item.cle}` : nomVariable(item.emplacement, item.cle);
  const lignes = [...visibles].sort((a, b) => {
    const ordre = valeurTri(a).localeCompare(valeurTri(b), "fr");
    return tri.direction === "ascending" ? ordre : -ordre;
  });
  const actionsReference = (item: Reference): Action[] =>
    gerable(item)
      ? [
          { id: "modifier", label: `Modifier ${item.cle}`, icon: <Pencil size={16} />, isDisabled: enCours, onPress: () => modifier(item) },
          {
            id: "supprimer",
            label: `Supprimer ${item.cle}`,
            icon: <Trash2 size={16} />,
            danger: true,
            isDisabled: enCours,
            confirm: { title: titreSuppression(item), confirmLabel: "Supprimer" },
            onPress: () => supprimer(item),
          },
        ]
      : [];

  const erreur = decouverte.error ?? references.error;
  const vide = !composants.length ? (
    <EmptyState
      title="Aucun dossier de composant dans OpenBao"
      description={produit ? `Aucun dossier de composant n’existe sous « ${produit} ».` : "Aucun produit n’existe dans les coffres OpenBao."}
    />
  ) : (
    <EmptyState title="Aucun élément visible" description="Aucun élément n’est accessible depuis ce dossier de composant." />
  );
  const contenu = () => {
    if (!items.length) {
      if (chargement) return <EmptyState title={decouverte.loading ? "Chargement des dossiers OpenBao…" : "Chargement des références…"} />;
      return erreur ? null : vide;
    }
    if (!visibles.length)
      return <EmptyState title="Aucun résultat" description={`Aucune ligne ne correspond à « ${requete.trim()} ».`} />;
    if (affichage === "tableau")
      return (
        <Table<Reference>
          label="Secrets accessibles par composant"
          density="compact"
          selectionMode="none"
          columns={colonnes}
          rows={lignes}
          searchTerms={searchTerms(requete)}
          isLoading={references.loading}
          sortDescriptor={tri}
          onSortChange={(d) => setTri({ column: String(d.column), direction: d.direction })}
          onAction={(id) => {
            const item = lignes.find((ligne) => ligne.id === id);
            if (item && gerable(item)) modifier(item);
          }}
          renderCell={(item, colonne) =>
            colonne === "portee"
              ? `${LIBELLES_PORTEE[item.portee]}${gerable(item) ? "" : " · Lecture seule"}`
              : colonne === "emplacement"
                ? `${item.emplacement}#${item.cle}`
                : nomVariable(item.emplacement, item.cle)
          }
          rowActions={(item) =>
            gerable(item)
              ? [
                  { icon: <Pencil size={16} />, label: `Modifier ${item.cle}`, onPress: () => modifier(item) },
                  { icon: <Trash2 size={16} />, label: `Supprimer ${item.cle}`, onPress: () => void demanderSuppression(item) },
                ]
              : []
          }
        />
      );
    return (
      <TreeView
        aria-label="Arborescence des références"
        nodes={arbre.noeuds}
        selectionMode="none"
        expandedIds={rechercheActive ? arbre.dossiers : arbre.dossiers.filter((id) => !replies.has(id))}
        onExpandedChange={(ids) => {
          if (!rechercheActive) setReplies(new Set(arbre.dossiers.filter((id) => !ids.includes(id))));
        }}
        onAction={(noeud) => {
          const item = parNoeud.get(noeud.id);
          if (item && gerable(item)) modifier(item);
        }}
        actions={(noeud) => {
          const item = parNoeud.get(noeud.id);
          return item ? actionsReference(item) : [];
        }}
      />
    );
  };

  return (
    <Page toolbar={toolbar} actions={actions} fill={items.length > 0}>
      {erreur ? <Notice tone="danger">{`OpenBao : ${erreur.message || "chargement impossible"} · Actualisez pour réessayer.`}</Notice> : null}
      {contenu()}
      {edition && env ? <EditeurSecret env={env} edition={edition} fermer={() => setEdition(null)} onEnregistre={relire} /> : null}
    </Page>
  );
}

/** Arbre des documents (dossiers par segment du chemin), avec le nombre de clés de chaque dossier, comme OneApp. */
function construireArbre(items: readonly Reference[]): { noeuds: TreeNode[]; dossiers: string[] } {
  type Branche = { id: string; label: string; branches: Map<string, Branche>; items: Reference[] };
  const racine: Branche = { id: "", label: "", branches: new Map(), items: [] };
  for (const item of items) {
    let parent = racine;
    let chemin = "";
    for (const segment of item.emplacement.split("/").filter(Boolean)) {
      chemin = chemin ? `${chemin}/${segment}` : segment;
      let branche = parent.branches.get(segment);
      if (!branche) {
        branche = { id: chemin, label: segment, branches: new Map(), items: [] };
        parent.branches.set(segment, branche);
      }
      parent = branche;
    }
    parent.items.push(item);
  }
  const dossiers: string[] = [];
  const compte = (branche: Branche): number => branche.items.length + [...branche.branches.values()].reduce((n, b) => n + compte(b), 0);
  const feuille = (item: Reference): TreeNode => ({
    id: `k:${item.id}`,
    label: item.cle,
    icon: <KeyRound size={16} />,
    meta: `${nomVariable(item.emplacement, item.cle)} · ${LIBELLES_PORTEE[item.portee]}${gerable(item) ? "" : " · Lecture seule"}`,
  });
  const noeud = (branche: Branche): TreeNode => {
    dossiers.push(`d:${branche.id}`);
    return {
      id: `d:${branche.id}`,
      label: branche.label,
      icon: <Folder size={16} />,
      openIcon: <FolderOpen size={16} />,
      meta: String(compte(branche)),
      children: [
        ...[...branche.branches.values()].sort((a, b) => a.label.localeCompare(b.label, "fr")).map(noeud),
        ...branche.items.map(feuille),
      ],
    };
  };
  const noeuds = [...[...racine.branches.values()].sort((a, b) => a.label.localeCompare(b.label, "fr")).map(noeud), ...racine.items.map(feuille)];
  return { noeuds, dossiers };
}
