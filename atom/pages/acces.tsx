import { Notice, Row, Stack, Text } from "@alfred/kit";
import { files, matchesSearch, shell, useAsync, usePageState, usePeerMessage } from "@alfred/sdk";
import { Check, Clock, Download, Minus, Plus, RefreshCw, SquareArrowOutUpRight, UserPlus, Wrench } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  type ComboBoxItem,
  Checkbox,
  CheckboxGroup,
  ComboBox,
  Modal,
  Accordion,
  EmptyState,
  Link,
  List,
  Page,
  PageSection,
  SearchInput,
  Select,
  Badge,
  Table,
  type TableColumn,
  TextInput,
} from "socle-ui";
import {
  type CaseAcces,
  type Changement,
  chargerAudit,
  chercherPersonnes,
  type CompteKc,
  csvAudit,
  executables,
  libelleChangement,
  libellePersonne,
  type LigneVue,
  lireProfils,
  nomFichierAudit,
  type Plan,
  preparerPlans,
  preparerPlansGroupes,
  preparerRealignement,
  appliquerPlans,
  type Probleme,
  type Profil,
  relie,
  texteProbleme,
  vueEnsemble,
} from "../lib/acces";
import { type Environnement, lireEnvironnements } from "../lib/environnements";
import { useLargeurPage } from "../lib/largeur";
import { useResumeAtom } from "../lib/source";

/** Une case en écart avant une case sans profil, puis conforme ; une personne sans accès vient en dernier. */
const RANG = { ecart: 0, "sans-profil": 1, conforme: 2 } as const;

/**
 * Pastille d’une case : « — », « ✓ Conforme », « Sans profil » ou « Écart ». Le nom des profils, trop long pour six
 * colonnes, se lit au panneau de droite de la personne.
 */
function Case({ acces, court }: { acces?: CaseAcces; court?: boolean }) {
  if (!acces)
    return (
      <Text tone="muted" as="span">
        —
      </Text>
    );
  // Fenêtre étroite : « Conforme » seul ; « sans profil géré » se lit au panneau de la personne.
  if (acces.etat === "conforme")
    return <Badge tone="success">{court ? "Conforme" : acces.profils ? "✓ Conforme" : "✓ Aucun profil"}</Badge>;
  if (acces.etat === "sans-profil") return <Badge>Sans profil</Badge>;
  return <Badge tone="warning">Écart</Badge>;
}

type Configuration = { environnement: string; problemes: Probleme[] }[];
type Vue = { lignes: LigneVue[]; configuration: Configuration };
type Saisie = {
  /** Saisie libre : identifiant, nom ou adresse e-mail, complétée par la recherche Keycloak. */
  personne: string;
  compte?: CompteKc;
  /** Identifiant du compte à créer quand la recherche ne trouve personne. */
  identifiant?: string;
  profil: string;
  envs: string[];
};
/** Fenêtre ouverte : l’ajout d’une personne, ou l’aperçu des changements (avec la saisie d’où il vient). */
type Fenetre = { kind: "ajout"; saisie: Saisie } | { kind: "apercu"; plans: Plan[]; resume: string; retour?: Saisie };

/** Adresse e-mail d’une saisie libre ou d’une suggestion « Nom <adresse> ». */
const emailDe = (valeur: string) => (/<([^>]+)>\s*$/.exec(valeur)?.[1] ?? valeur).trim().toLocaleLowerCase();
const estEmail = (valeur: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(valeur);
const estIdentifiant = (valeur: string) => /^[^\s<>@]+$/.test(valeur.trim());
/** Libellé d’un compte dans les suggestions : nom, identifiant puis adresse. */
const optionCompte = (compte: CompteKc) =>
  [[compte.prenom, compte.nom].filter(Boolean).join(" ").trim(), compte.identifiant, compte.email]
    .filter((part, index, toutes) => part && toutes.indexOf(part) === index)
    .join(" · ");
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const erreur = (cause: unknown, defaut: string) => (cause instanceof Error && cause.message ? cause.message : defaut);
const notifier = (tone: "success" | "warning" | "error", title: string, description: string) => void shell.notify({ tone, title, description });

export default function AccesPage() {
  const base = useAsync(async () => {
    const [profils, envs] = await Promise.all([lireProfils(), lireEnvironnements()]);
    return { profils, envs };
  }, []);
  const profils = base.data?.profils ?? [];
  const envs = base.data?.envs ?? [];
  // Les accès s’affichent pour tous les environnements reliés à Keycloak et Grafana ; l’environnement d’une action est
  // celui de la case choisie. L’ajout d’une personne cherche dans le premier.
  const relies = useMemo(() => envs.filter(relie), [envs]);
  const reference = relies[0];
  // Vue d’ensemble lue. Elle n’est pas retenue d’une visite à l’autre : l’état de page d’Alfred garde 20 000
  // caractères au plus, trop peu pour une équipe entière ; chaque ouverture relit donc les environnements.
  const [vue, setVue] = useState<Vue | null>(null);
  const [lecture, setLecture] = useState(false);
  const [revision, setRevision] = useState(0);
  const [requete, setRequete] = useState("");
  const [ouverte, setOuverte] = usePageState<string>("personne", "");
  const [cochees, setCochees] = usePageState<string[]>("selection", []);
  // Une fenêtre (ajout ou aperçu) est ouverte : les autres gestes attendent.
  const [ouvert, setOuvert] = useState<Fenetre | null>(null);
  const fenetre = ouvert !== null;
  const [preparation, setPreparation] = useState(false);
  const [export_, setExport] = useState(false);

  useEffect(() => {
    void revision;
    if (!base.data || !base.data.profils.length || !relies.length) return;
    let actif = true;
    setLecture(true);
    chargerAudit(base.data.profils, relies, { tousGroupes: false })
      .then(({ lignes, illisibles, configuration }) => {
        if (!actif) return;
        setVue({ lignes: vueEnsemble(lignes), configuration });
        if (illisibles.length) notifier("warning", "Vue d’ensemble partielle", `Environnements illisibles : ${illisibles.join(", ")}.`);
      })
      .catch((cause: unknown) => {
        if (actif) notifier("error", "Vue d’ensemble indisponible", erreur(cause, "Les accès n’ont pas pu être lus."));
      })
      .finally(() => {
        if (actif) setLecture(false);
      });
    return () => {
      actif = false;
    };
  }, [base.data, relies, revision]);
  const actualiser = useCallback(() => setRevision((valeur) => valeur + 1), []);

  const lignes = vue?.lignes ?? [];
  const configuration = vue?.configuration ?? [];
  // Une seule recherche remplace les filtres : nom, adresse, identifiant, profil, environnement, ou « écart ».
  const affichees = lignes.filter((ligne) => {
    const cases = Object.entries(ligne.cases);
    return matchesSearch(requete, [
      ligne.personne,
      ligne.email,
      ligne.identifiant,
      ...cases.flatMap(([env, { profils: p }]) => [env, p]),
      cases.some(([, { etat }]) => etat === "ecart") ? "écart" : undefined,
    ]);
  });
  const ecartsAffiches = affichees.filter((ligne) => Object.values(ligne.cases).some(({ etat }) => etat === "ecart"));
  const enEcart = lignes.filter((ligne) => Object.values(ligne.cases).some(({ etat }) => etat === "ecart")).length;
  const pret = Boolean(reference && profils.length);
  const nonConfiguree = Boolean(base.data) && (!profils.length || !relies.length);

  // Personne ouverte dans le panneau, ou personnes cochées pour une attribution groupée (elles la remplacent).
  const cocheesLignes = lignes.filter(({ cle }) => cochees.includes(cle));
  const ouverteLigne = lignes.find(({ cle }) => cle === ouverte);
  const panneau = cocheesLignes.length ? cocheesLignes : ouverteLigne ? [ouverteLigne] : [];
  const occupe = preparation || fenetre;
  const publication = JSON.stringify({
    // Cocher une personne de plus garde le profil et les environnements déjà choisis.
    cle: cocheesLignes.length ? "selection" : (panneau[0]?.cle ?? ""),
    lignes: panneau,
    profils: profils.map(({ id, nom }) => ({ id, nom })),
    envs: relies.map(({ id, nom }) => ({ id, nom })),
    occupe,
  });
  useEffect(() => {
    if (!base.data) return;
    void shell.publish(JSON.parse(publication));
    void shell.setPanelVisible(panneau.length > 0);
  }, [publication, base.data]);

  /** Prépare des plans ; un échec est notifié (ou levé, pour laisser la fenêtre d’ajout ouverte). */
  const preparer = async (calcul: () => Promise<Plan[]>, { lever = false } = {}) => {
    setPreparation(true);
    try {
      return await calcul();
    } catch (cause) {
      if (lever) throw new Error(erreur(cause, "Keycloak ou Grafana a refusé la demande."));
      notifier("error", "Aperçu des changements impossible", erreur(cause, "Keycloak ou Grafana a refusé la demande."));
      return undefined;
    } finally {
      setPreparation(false);
    }
  };

  /** Aperçu « Changements à appliquer », puis application ; « Retour » ramène à la saisie de l’ajout. */
  const ouvrirApercu = (plans: Plan[], resume: string, retour?: Saisie) => setOuvert({ kind: "apercu", plans, resume, ...(retour ? { retour } : {}) });

  /** Ajout d’une personne (AccessPersonDialog de OneApp) : « Voir les changements » prépare l’aperçu. */
  const ouvrirAjout = (depart?: Saisie) => {
    if (!reference || fenetre) return;
    setOuvert({ kind: "ajout", saisie: depart ?? { personne: "", profil: profils[0]?.id ?? "", envs: [reference.id] } });
  };

  /** Prépare l’aperçu d’une saisie complète ; une erreur est levée pour rester dans la fenêtre d’ajout. */
  const preparerAjout = async (saisie: Saisie) => {
    if (!reference) return;
    const cibles = profils.filter(({ id }) => id === saisie.profil);
    const visees = envs.filter(({ id }) => saisie.envs.includes(id));
    const email = saisie.compte ? saisie.compte.email : saisie.identifiant !== undefined ? "" : emailDe(saisie.personne);
    const plans = await preparer(
      () =>
        preparerPlans(
          profils,
          { compte: saisie.compte, email, identifiant: saisie.compte ? undefined : saisie.identifiant?.trim(), profils: cibles },
          visees,
          reference.id,
        ),
      { lever: true },
    );
    const trouve = saisie.compte ?? plans?.find(({ compte }) => compte)?.compte;
    ouvrirApercu(
      plans ?? [],
      [trouve ? libellePersonne(trouve) : email || saisie.identifiant || "", cibles[0]?.nom ?? "Aucun profil", visees.map(({ nom }) => nom).join(", ")].join(" · "),
      saisie,
    );
  };

  const appliquer = async (plans: Plan[]) => {
    const bilan = await appliquerPlans(plans);
    void shell.notify({ tone: bilan.tone, title: bilan.title, description: bilan.description, persistent: !bilan.reussi });
    setOuvert(null);
    actualiser();
  };

  /**
   * Applique un seul profil aux personnes du panneau dans les environnements cochés : chaque environnement est relu,
   * la personne y est retrouvée (ou son compte créé), puis l’aperçu montre le réalignement complet sur ce profil.
   */
  const appliquerDepuisPanneau = async (profilId: string, envIds: string[]) => {
    if (!panneau.length || fenetre || preparation) return;
    const cibles = profils.filter(({ id }) => id === profilId);
    const visees = relies.filter(({ id }) => envIds.includes(id));
    const personnes = panneau.map(({ email, identifiant }) => ({ email, identifiant }));
    const plans = await preparer(() =>
      panneau.length === 1
        ? preparerPlans(profils, { ...personnes[0], profils: cibles }, visees)
        : preparerPlansGroupes(profils, personnes, cibles, visees),
    );
    if (!plans) return;
    await ouvrirApercu(
      plans,
      [panneau.length === 1 ? panneau[0].personne : `${panneau.length} personnes`, cibles[0]?.nom ?? "Aucun profil", visees.map(({ nom }) => nom).join(", ")].join(" · "),
    );
  };

  usePeerMessage((message) => {
    const m = message as { appliquer?: { profil: string; envs: string[] } };
    if (m?.appliquer) void appliquerDepuisPanneau(m.appliquer.profil, m.appliquer.envs);
  });

  /**
   * Réalignement groupé des personnes affichées en écart : avec une recherche, seuls ces écarts sont corrigés. Chaque
   * personne retrouve ses propres profils, environnement par environnement, après aperçu.
   */
  const corrigerEcarts = async () => {
    if (!ecartsAffiches.length || fenetre) return;
    const cle = (valeur?: string) => (valeur ?? "").trim().toLocaleLowerCase("fr");
    const voulues = new Set(ecartsAffiches.flatMap((l) => [cle(l.identifiant), cle(l.email)].filter(Boolean)));
    const visees = relies.filter(({ nom }) => ecartsAffiches.some((l) => l.cases[nom]?.etat === "ecart"));
    const plans = await preparer(() => preparerRealignement(profils, visees, (compte) => voulues.has(cle(compte.identifiant)) || voulues.has(cle(compte.email))));
    if (!plans) return;
    const nombre = new Set(plans.map(({ compte }) => compte?.id)).size;
    await ouvrirApercu(plans, [`${nombre} personne${nombre > 1 ? "s" : ""} à réaligner`, visees.map(({ nom }) => nom).join(", ")].filter(Boolean).join(" · "));
  };

  /** Audit de tous les environnements reliés à Keycloak et Grafana, enregistré en CSV. */
  const exporterAudit = async () => {
    if (export_) return;
    setExport(true);
    try {
      const nonRelies = envs.filter((env) => !relie(env)).map(({ nom }) => nom);
      const { lignes: audit, illisibles } = await chargerAudit(profils, relies);
      if (!audit.length && illisibles.length) throw new Error(`Environnements illisibles : ${illisibles.join(", ")}.`);
      const fichier = await files.save({ name: nomFichierAudit(new Date().toISOString().slice(0, 10)), text: csvAudit(audit), mime: "text/csv" });
      if (!(await files.export(fichier.id))) return;
      const lus = relies.length - illisibles.length;
      const manques = [
        illisibles.length ? `illisibles : ${illisibles.join(", ")}` : "",
        nonRelies.length ? `sans connexion Keycloak et Grafana : ${nonRelies.join(", ")}` : "",
      ].filter(Boolean);
      if (manques.length)
        notifier("warning", "Audit exporté partiellement", `${pluriel(audit.length, "ligne")} sur ${pluriel(lus, "environnement")}. Non audités : ${manques.join(" ; ")}.`);
      else notifier("success", "Audit des accès exporté", `${pluriel(audit.length, "ligne")} sur ${pluriel(relies.length, "environnement")}.`);
    } catch (cause) {
      notifier("error", "Export de l’audit impossible", erreur(cause, "Réessayez."));
    } finally {
      setExport(false);
    }
  };

  // Ctrl+N ajoute une personne (même depuis un champ), F5 relit les accès.
  useEffect(() => {
    const clavier = (event: KeyboardEvent) => {
      if (event.key === "F5") {
        event.preventDefault();
        actualiser();
      } else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "n" && pret && !fenetre) {
        event.preventDefault();
        void ouvrirAjout();
      }
    };
    window.addEventListener("keydown", clavier);
    return () => window.removeEventListener("keydown", clavier);
  });

  const nombreProblemes = configuration.reduce((total, { problemes }) => total + problemes.length, 0);
  useResumeAtom(
    nonConfiguree || !vue
      ? ""
      : `${pluriel(lignes.length, "personne")} · ${enEcart} en écart · ${pluriel(relies.length, "environnement")}`,
  );

  const [tri, setTri] = useState<{ column: string; direction: "ascending" | "descending" }>({ column: "personne", direction: "ascending" });
  // Sous 940 px (fenêtre de 1024), les cases raccourcissent et l’adresse passe au panneau de la personne : six
  // environnements tiennent sans défiler.
  const etroite = useLargeurPage() < 940;
  const colonnes: TableColumn[] = [
    { id: "personne", label: "Personne", sortable: true },
    // Six environnements tiennent à côté du panneau de droite : la colonne Personne prend la place restante.
    ...relies.map((env): TableColumn => ({ id: env.id, label: env.code || env.nom, sortable: true, width: etroite ? 92 : 100 })),
  ];
  const rang = (ligne: LigneVue, colonne: string) => {
    const env = relies.find(({ id }) => id === colonne);
    const etat = env ? ligne.cases[env.nom]?.etat : undefined;
    return etat ? RANG[etat] : 3;
  };
  const triees = [...affichees]
    .sort((a, b) => {
      const ordre = tri.column === "personne" ? a.personne.localeCompare(b.personne, "fr") : rang(a, tri.column) - rang(b, tri.column);
      return tri.direction === "ascending" ? ordre : -ordre;
    })
    .map((ligne) => ({ ...ligne, id: ligne.cle }));
  const ouvrirPersonne = (cle: string) => {
    setCochees([]);
    setOuverte(cle);
  };

  const actions = nonConfiguree
    ? []
    : [
        {
          id: "ajouter",
          label: "Ajouter une personne",
          shortcut: "Mod+N",
          icon: <UserPlus size={16} />,
          primary: true,
          // Masquée tant que profils et environnement de référence manquent : un bouton plein désactivé se lit mal.
          isHidden: !pret,
          isDisabled: fenetre,
          onPress: () => ouvrirAjout(),
        },
        { id: "actualiser", label: "Actualiser (F5)", icon: <RefreshCw size={16} />, isDisabled: !relies.length || lecture, onPress: actualiser },
        {
          id: "ecarts",
          label: `Corriger les écarts (${ecartsAffiches.length})`,
          icon: <Wrench size={16} />,
          isHidden: !ecartsAffiches.length,
          isDisabled: fenetre || lecture || preparation,
          onPress: corrigerEcarts,
        },
        { id: "audit", label: "Exporter l’audit (CSV)", icon: <Download size={16} />, isDisabled: !pret || export_, onPress: exporterAudit },
      ];

  const corps = () => {
    if (!profils.length)
      return (
        <EmptyState
          title="Aucun profil d’accès"
          description="Définissez les profils, leurs groupes Keycloak et leurs équipes Grafana dans Réglages · Atom."
          action={
            <Button variant="primary" onPress={() => void shell.navigate("atom/atom")}>
              Définir les profils
            </Button>
          }
        />
      );
    if (!relies.length)
      return (
        <EmptyState
          title="Aucun environnement relié"
          description="Associez Keycloak et Grafana à vos environnements dans Réglages · Atom."
          action={
            <Button variant="primary" onPress={() => void shell.navigate("atom/atom")}>
              Ouvrir les environnements
            </Button>
          }
        />
      );
    if (!vue) return <EmptyState title="Lecture des accès de tous les environnements…" />;
    if (!affichees.length)
      return (
        <EmptyState
          title={lignes.length ? "Aucune personne ne correspond" : "Aucune personne"}
          description={lignes.length ? "Modifiez la recherche." : "Aucune personne n’appartient aux groupes gérés par les profils."}
        />
      );
    return (
      <Stack gap="sm">
        {configuration.length ? (
          // Les profils s’attribuent malgré ces absences : elles sont rappelées sans occuper la page.
          <Accordion
            id="atom-acces-configuration"
            title={`${nombreProblemes > 1 ? `${nombreProblemes} éléments de configuration absents selon l’environnement` : "1 élément de configuration absent dans un environnement"} · sans effet sur l’attribution des profils`}
          >
            <Stack gap="none">
              {configuration.flatMap(({ environnement, problemes }) =>
                problemes.map((probleme) => (
                  <Text key={`${environnement}-${texteProbleme(probleme)}`} tone="muted" size="meta">
                    {`• ${environnement} · ${texteProbleme(probleme)}`}
                  </Text>
                )),
              )}
            </Stack>
          </Accordion>
        ) : null}
        <Table<LigneVue & { id: string }>
          label="Accès par personne et par environnement"
          density="compact"
          selectionMode="multiple"
          columns={colonnes}
          rows={triees}
          searchTerms={requete.split(/\s+/).filter(Boolean)}
          selectedKeys={cochees}
          onSelectionChange={(cles) => setCochees([...cles].map(String))}
          sortDescriptor={tri}
          onSortChange={(d) => setTri({ column: String(d.column), direction: d.direction })}
          onAction={ouvrirPersonne}
          {...(etroite ? {} : { rowDescription: (l: LigneVue) => l.email || l.identifiant })}
          isLoading={lecture && !lignes.length}
          renderCell={(l, colonne) => {
            if (colonne === "personne") return l.personne;
            const env = relies.find(({ id }) => id === colonne);
            return <Case acces={env ? l.cases[env.nom] : undefined} court={etroite} />;
          }}
          rowActions={(l) => [
            { icon: <SquareArrowOutUpRight size={16} />, label: `Régler les accès de ${l.personne}`, onPress: () => ouvrirPersonne(l.cle) },
          ]}
        />
      </Stack>
    );
  };

  return (
    <Page
      fill
      state={base.error ? "error" : !base.data ? "loading" : "ready"}
      onRetry={base.reload}
      loadingLabel="Chargement des profils d’accès"
      {...(nonConfiguree
        ? {}
        : { toolbar: <SearchInput label="les personnes, profils et environnements" onChange={({ text }) => setRequete(text)} /> })}
      actions={actions}
    >
      {corps()}
      {ouvert?.kind === "ajout" && reference ? (
        <DialogAjout
          depart={ouvert.saisie}
          connues={lignes}
          reference={reference}
          profils={profils}
          envs={envs}
          preparer={preparerAjout}
          fermer={() => setOuvert(null)}
        />
      ) : null}
      {ouvert?.kind === "apercu" ? (
        <DialogApercu
          plans={ouvert.plans}
          resume={ouvert.resume}
          retour={Boolean(ouvert.retour)}
          appliquer={() => appliquer(ouvert.plans)}
          fermer={() => (ouvert.retour ? setOuvert({ kind: "ajout", saisie: ouvert.retour }) : setOuvert(null))}
        />
      ) : null}
    </Page>
  );
}

const saisieValide = (saisie: Saisie) =>
  (Boolean(saisie.compte) ||
    (saisie.identifiant !== undefined ? estIdentifiant(saisie.identifiant) : estEmail(emailDe(saisie.personne)))) &&
  Boolean(saisie.profil) &&
  saisie.envs.length > 0;

/** Fenêtre « Ajouter une personne » (AccessPersonDialog de OneApp). */
function DialogAjout({
  depart,
  connues,
  reference,
  profils,
  envs,
  preparer,
  fermer,
}: {
  depart: Saisie;
  connues: readonly LigneVue[];
  reference: Environnement;
  profils: readonly Profil[];
  envs: readonly Environnement[];
  preparer: (saisie: Saisie) => Promise<void>;
  fermer: () => void;
}) {
  const [saisie, setSaisie] = useState(depart);
  const [envoye, setEnvoye] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [echec, setEchec] = useState<string>();
  const [erreurRecherche, setErreurRecherche] = useState<string>();
  // Comptes proposés, par identifiant d’élément : les personnes déjà présentes dans les groupes gérés, puis Keycloak.
  const comptes = useRef(new Map<string, CompteKc>());
  const creation = saisie.identifiant !== undefined;
  const connus = useMemo(
    () =>
      connues.map(
        (l): CompteKc => ({ id: `connue:${l.cle}`, identifiant: l.identifiant, prenom: l.personne, nom: "", email: l.email, actif: true }),
      ),
    [connues],
  );
  const element = (compte: CompteKc): ComboBoxItem => {
    const id = `kc:${compte.identifiant.toLowerCase()}`;
    comptes.current.set(id, compte);
    return { id, label: optionCompte(compte) };
  };
  const chercher = async (texte: string, signal: AbortSignal) => {
    const mot = texte.trim().toLocaleLowerCase("fr");
    const locaux = connus.filter((compte) => optionCompte(compte).toLocaleLowerCase("fr").includes(mot));
    let trouves: CompteKc[] = [];
    try {
      trouves = await chercherPersonnes(reference, texte.trim());
      setErreurRecherche(undefined);
    } catch (cause) {
      if (!signal.aborted) setErreurRecherche(erreur(cause, "Recherche Keycloak impossible."));
    }
    const parCle = new Map([...locaux, ...trouves].map((compte) => [compte.identifiant.toLowerCase(), compte]));
    return [...parCle.values()].map(element);
  };
  const email = emailDe(saisie.personne);
  const identifiee = Boolean(saisie.compte) || estEmail(email) || (creation && estIdentifiant(saisie.identifiant ?? ""));
  const erreurPersonne =
    envoye && !identifiee ? (creation ? "Saisissez un identifiant sans espace." : "Choisissez une personne dans les résultats ou créez-la.") : undefined;
  const erreurProfil = envoye && !saisie.profil ? "Choisissez un profil." : undefined;
  const erreurEnvs = envoye && !saisie.envs.length ? "Choisissez au moins un environnement." : undefined;
  const inconnue = !saisie.compte && !creation && estEmail(email) && !connus.some((c) => c.email === email);
  const valeur = saisie.compte ? `kc:${saisie.compte.identifiant.toLowerCase()}` : saisie.personne && !creation ? `saisie:${saisie.personne}` : null;

  const voir = async () => {
    setEnvoye(true);
    if (!saisieValide(saisie)) return;
    setEnCours(true);
    setEchec(undefined);
    try {
      await preparer(saisie);
    } catch (cause) {
      setEchec(erreur(cause, "Keycloak ou Grafana a refusé la demande."));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <Modal
      isOpen
      size="lg"
      title="Ajouter une personne"
      isBusy={enCours}
      onOpenChange={(ouverte) => {
        if (!ouverte) fermer();
      }}
      footer={
        <>
          <Button onPress={fermer}>Annuler</Button>
          <Button variant="primary" isPending={enCours} onPress={() => void voir()}>
            Voir les changements
          </Button>
        </>
      }
    >
      <Stack gap="md">
        {creation ? (
          <Stack gap="sm">
            <TextInput
              label="Identifiant du compte à créer"
              isRequired
              description="Compte créé sans mot de passe local. Le fournisseur SSO doit être configuré dans Keycloak pour lier les comptes existants à la première connexion ; sinon, demandez à un administrateur de vérifier cette liaison."
              value={saisie.identifiant ?? ""}
              autoComplete="off"
              {...(erreurPersonne ? { error: erreurPersonne } : {})}
              onChange={(identifiant) => setSaisie({ ...saisie, identifiant })}
            />
            <Row>
              <Link onPress={() => setSaisie({ ...saisie, identifiant: undefined })}>Rechercher à nouveau</Link>
            </Row>
          </Stack>
        ) : (
          <ComboBox
            label="Personne"
            isRequired
            placeholder="identifiant ou nom"
            description={
              saisie.compte
                ? `Compte Keycloak : ${saisie.compte.identifiant}`
                : "Identifiant, nom ou adresse e-mail : choisissez le compte dans les résultats Keycloak. Sans résultat, « Ajouter » crée la personne."
            }
            {...((erreurPersonne ?? erreurRecherche) ? { error: erreurPersonne ?? erreurRecherche } : {})}
            loadItems={chercher}
            value={valeur}
            selectedItems={valeur ? [{ id: valeur, label: saisie.personne }] : []}
            allowsCustomValue
            onCreate={(texte) => {
              const adresse = emailDe(texte);
              // Une adresse e-mail désigne la personne ; un autre texte devient l’identifiant du compte à créer.
              if (estEmail(adresse)) {
                setSaisie({ ...saisie, personne: adresse, compte: undefined, identifiant: undefined });
                return { id: `saisie:${adresse}`, label: adresse };
              }
              setSaisie({ ...saisie, personne: texte, compte: undefined, identifiant: texte.trim().replace(/\s+/g, ".") });
              return { id: `saisie:${texte}`, label: texte };
            }}
            onChange={(id) => {
              if (typeof id !== "string") {
                setSaisie({ ...saisie, personne: "", compte: undefined, identifiant: undefined });
                return;
              }
              const compte = comptes.current.get(id);
              // Le compte choisi est relu chez Keycloak à la préparation, par son e-mail puis son identifiant.
              if (compte) setSaisie({ ...saisie, personne: optionCompte(compte), compte, identifiant: undefined });
            }}
          />
        )}
        {inconnue ? (
          <Notice tone="info">
            Personne absente des groupes gérés : si aucun compte Keycloak n’existe pour cette adresse, Atom le crée. Ses équipes Grafana lui seront
            ajoutées à sa première connexion.
          </Notice>
        ) : null}
        <Select
          label="Profil"
          isRequired
          placeholder="Choisir un profil"
          value={saisie.profil || null}
          options={profils.map((profil) => ({ id: profil.id, label: profil.nom }))}
          {...(erreurProfil ? { error: erreurProfil } : {})}
          onChange={(profil) => setSaisie({ ...saisie, profil: profil ?? "" })}
        />
        <CheckboxGroup
          label="Environnements"
          isRequired
          orientation="horizontal"
          value={saisie.envs}
          {...(erreurEnvs ? { error: erreurEnvs } : {})}
          onChange={(ids) => setSaisie({ ...saisie, envs: ids })}
        >
          {envs.map((env) => (
            <Checkbox key={env.id} value={env.id} isDisabled={!relie(env)}>
              {relie(env) ? env.nom : `${env.nom} (connexions manquantes)`}
            </Checkbox>
          ))}
        </CheckboxGroup>
        {echec ? <Notice tone="danger">{echec}</Notice> : null}
      </Stack>
    </Modal>
  );
}

const tonChangement = (c: Changement) => (c.type === "ajouter" ? "success" : c.type === "retirer" ? "warning" : "neutral");

function iconeChangement(changement: Changement) {
  const Icone = changement.type === "creerCompte" ? UserPlus : changement.type === "ajouter" ? Plus : changement.type === "retirer" ? Minus : Clock;
  return <Icone size={16} />;
}

/** Changements d’un système (Keycloak ou Grafana) dans un plan. */
function ListeChangements({ titre, changements }: { titre: string; changements: readonly Changement[] }) {
  if (!changements.length) return null;
  return (
    <List
      label={titre}
      selectionMode="none"
      leading="icon"
      items={changements.map((c) => ({
        id: libelleChangement(c),
        title: libelleChangement(c),
        visual: iconeChangement(c),
        status: { label: titre, tone: tonChangement(c) },
      }))}
    />
  );
}

/** Aperçu des changements Keycloak et Grafana, regroupés par environnement (AccessChangesDialog). */
function DialogApercu({
  plans,
  resume,
  retour,
  appliquer,
  fermer,
}: {
  plans: readonly Plan[];
  resume: string;
  retour: boolean;
  appliquer: () => Promise<void>;
  fermer: () => void;
}) {
  const [enCours, setEnCours] = useState(false);
  const nombre = plans.reduce((total, plan) => total + executables(plan.changements), 0);
  const plusieurs = plans.length > 1;
  // Un réalignement groupé contient un plan par personne ; sur plusieurs environnements, chacun est nommé.
  const nombreEnvs = new Set(plans.map(({ env }) => env.id)).size;
  const parPersonne = nombreEnvs < plans.length;
  const titre = (plan: Plan) =>
    parPersonne && plan.compte ? `${libellePersonne(plan.compte)}${nombreEnvs > 1 ? ` · ${plan.env.nom}` : ""}` : plan.env.nom;
  const lancer = async () => {
    setEnCours(true);
    try {
      await appliquer();
    } finally {
      setEnCours(false);
    }
  };
  return (
    <Modal
      isOpen
      size="lg"
      title="Changements à appliquer"
      description={resume}
      isBusy={enCours}
      onOpenChange={(ouverte) => {
        if (!ouverte) fermer();
      }}
      footer={
        <>
          <Button onPress={fermer}>{retour ? "Retour" : "Annuler"}</Button>
          <Button variant="primary" isDisabled={!nombre} isPending={enCours} onPress={() => void lancer()}>
            {nombre ? `Appliquer ${pluriel(nombre, "changement")}` : "Aucun changement"}
          </Button>
        </>
      }
    >
      <Stack gap="md">
        {plans.map((plan) => {
          const contenu = plan.changements.length ? (
            <Stack gap="sm">
              <ListeChangements titre="Keycloak" changements={plan.changements.filter(({ systeme }) => systeme === "keycloak")} />
              <ListeChangements titre="Grafana" changements={plan.changements.filter(({ systeme }) => systeme === "grafana")} />
            </Stack>
          ) : (
            <EmptyState size="compact" title="Aucun changement" description="Les accès sont déjà alignés." />
          );
          const cle = `${plan.env.id}:${plan.compte?.id ?? plan.email ?? ""}`;
          return plusieurs ? (
            <PageSection key={cle} title={titre(plan)}>
              {contenu}
            </PageSection>
          ) : (
            <Stack key={cle} gap="none">
              {contenu}
            </Stack>
          );
        })}
        <Row gap="xs">
          <Check size={16} aria-hidden="true" />
          <Text tone="muted" size="meta" as="span">
            Rien n’est retiré des groupes ni des équipes non gérés par un profil.
          </Text>
        </Row>
      </Stack>
    </Modal>
  );
}
