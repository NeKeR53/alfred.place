import { Row, Text } from "@alfred/kit";
import { badge, functions, notifyActionError, shell, useAlfredState, useAsync, usePageState } from "@alfred/sdk";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { type Action, Page, PageGrid, PageSection, Tabs, useOpenForm } from "socle-ui";
import { CarteJob } from "../lib/CarteJob";
import { ChoixJobs } from "../lib/ChoixJobs";
import { type Fenetre, Fenetres, ouvrirRapport } from "../lib/ouvrir-rapport";
import { cleRapport, derniersRapports, type Rapport } from "../lib/rapport";
import {
  ajouterCartes,
  type Carte,
  cleEtat,
  compterEnCours,
  type Compte,
  creerVue,
  deplacerCarte,
  dossierDe,
  enregistrerOrdre,
  type EtatJob,
  etatAffiche,
  lireCartes,
  lireEtats,
  lireToutesCartes,
  lireVues,
  nomCourt,
  renommerVue,
  retirerCarte,
  supprimerVue,
  type Vue,
} from "../lib/tableau";

const formulaireVue = (vue?: Vue) => ({
  title: vue ? "Renommer la vue" : "Nouvelle vue",
  description: vue ? undefined : "Une vue regroupe les jobs que vous voulez voir ensemble.",
  fields: [{ name: "nom", label: "Nom de la vue", isRequired: true, placeholder: "Déploiements" }],
  initialValues: vue,
  submitLabel: vue ? "Enregistrer" : "Créer",
});

export default function TableauDeBord() {
  const [vueChoisie, setVueChoisie] = usePageState<string>("vue", "principale");
  const [version, setVersion] = useState(0);
  const recharger = () => setVersion((v) => v + 1);
  const openForm = useOpenForm();
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const [ajout, setAjout] = useState(false);

  const vues = useAsync(lireVues, [version]);
  const comptes = useAlfredState<{ comptes: Compte[] }, Compte[]>("comptes", { select: (v) => v.comptes ?? [] });
  const vue = vues.data?.find((v) => v.id === vueChoisie) ?? vues.data?.[0];
  const vueId = vue?.id ?? "";

  const cartes = useAsync(() => (vueId ? lireCartes(vueId) : Promise.resolve([] as Carte[])), [vueId, version]);
  const [ordre, setOrdre] = useState<Carte[]>([]);
  useEffect(() => {
    if (cartes.data) setOrdre(cartes.data);
  }, [cartes.data]);

  // Les états de toutes les vues se lisent en un seul lot (une demande par dossier Jenkins).
  const toutesCartes = useAsync(lireToutesCartes, [version]);
  const cleJobs = [...new Set((toutesCartes.data ?? []).map((c) => cleEtat(c.instance, c.job)))].sort().join("|");
  const etats = useAsync(
    () =>
      toutesCartes.data && toutesCartes.data.length > 0
        ? lireEtats(toutesCartes.data)
        : Promise.resolve(new Map<string, EtatJob>()),
    [cleJobs],
  );

  // Rapports d’échec : relus avec les états, pour mettre la cause sous chaque job en échec.
  const rapports = useAsync(derniersRapports, [etats.data]);
  const [enAnalyse, setEnAnalyse] = useState<Set<string>>(new Set());
  const analyser = async (carte: Carte, etat: EtatJob | undefined) => {
    const cle = cleRapport(carte.instance, carte.job);
    setEnAnalyse((actuel) => new Set(actuel).add(cle));
    try {
      const rapport = await functions.call<Rapport>("analyser-echec", {
        ...(carte.instance ? { instance: carte.instance } : {}),
        job: carte.job,
        ...(etat?.dernier ? { build: etat.dernier.numero } : {}),
      });
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
        suivant.delete(cle);
        return suivant;
      });
    }
  };

  // Pastille du menu : nombre de jobs en cours, toutes vues confondues.
  useEffect(() => {
    if (etats.data) void badge.set(compterEnCours(etats.data));
  }, [etats.data]);

  // Relecture régulière : toutes les 2 s quand un build tourne, sinon toutes les 10 s.
  const [maintenant, setMaintenant] = useState(Date.now());
  const unBuildTourne = [...(etats.data?.values() ?? [])].some((e) => e.dernier?.enCours || e.enFile);
  useEffect(() => {
    const minuterie = setInterval(etats.reload, unBuildTourne ? 2_000 : 10_000);
    return () => clearInterval(minuterie);
  }, [unBuildTourne, etats.reload]);
  useEffect(() => {
    setMaintenant(Date.now());
    if (!unBuildTourne) return;
    const minuterie = setInterval(() => setMaintenant(Date.now()), 2_000);
    return () => clearInterval(minuterie);
  }, [unBuildTourne, etats.data]);

  const listeComptes = comptes.data ?? [];
  const nomCompte = (instance: string) =>
    listeComptes.length > 1
      ? (listeComptes.find((c) => (instance ? c.id === instance : c.default))?.label ?? instance)
      : undefined;

  const deplacerDe = (index: number, pas: number) => {
    const suivant = [...ordre];
    const [carte] = suivant.splice(index, 1);
    suivant.splice(index + pas, 0, carte);
    setOrdre(suivant);
    return enregistrerOrdre(suivant.map((c) => c.id));
  };

  const relancer = async (carte: Carte) => {
    await functions.call("relancer-job", { ...(carte.instance ? { instance: carte.instance } : {}), job: carte.job });
    setTimeout(etats.reload, 1500);
  };

  // Le log s’ouvre en modale large au-dessus de la page, comme les logs d’une exécution Prefect.
  const ouvrirLogs = (carte: Carte, etat: EtatJob | undefined) => {
    const affiche = etatAffiche(etat);
    const nom = etat?.nom ?? nomCourt(carte.job);
    setFenetre({
      kind: "logs",
      titre: `Logs de « ${nom} »`,
      description: [
        affiche.label,
        etat?.dernier ? `build n° ${etat.dernier.numero}` : null,
        dossierDe(carte.job) || null,
      ]
        .filter(Boolean)
        .join(" · "),
      instance: carte.instance,
      job: carte.job,
      build: etat?.dernier?.numero,
      url: etat?.dernier?.url,
      onRelancer: async () => {
        await relancer(carte);
        shell.notify({ title: "Build demandé", tone: "success" });
      },
    });
  };

  const nouvelleVue = () =>
    openForm({
      ...formulaireVue(),
      onSubmit: async (v) => {
        const id = await creerVue(String(v.nom));
        shell.notify({ title: "Vue créée", tone: "success" });
        setVueChoisie(id);
        recharger();
      },
    });

  const actionsCarte = (carte: Carte, index: number, etat: EtatJob | undefined): Action[] => {
    const autresVues = (vues.data ?? []).filter((v) => v.id !== vueId);
    return [
      {
        id: "jenkins",
        label: "Ouvrir dans Jenkins",
        isHidden: !etat?.url,
        onPress: () => shell.openExternal(etat?.url ?? ""),
      },
      { id: "monter", label: "Avancer", isHidden: index === 0, onPress: () => deplacerDe(index, -1) },
      { id: "descendre", label: "Reculer", isHidden: index === ordre.length - 1, onPress: () => deplacerDe(index, 1) },
      {
        id: "autre-vue",
        label: "Déplacer vers une autre vue…",
        isHidden: autresVues.length === 0,
        onPress: () =>
          openForm({
            title: "Déplacer vers une autre vue",
            fields: [
              {
                name: "vue",
                label: "Vue",
                type: "select",
                isRequired: true,
                options: autresVues.map((v) => ({ id: v.id, label: v.nom })),
              },
            ],
            initialValues: { vue: autresVues[0]?.id ?? null },
            submitLabel: "Déplacer",
            onSubmit: async (v) => {
              await deplacerCarte(carte, String(v.vue));
              shell.notify({ title: "Job déplacé", tone: "success" });
              recharger();
            },
          }),
      },
      {
        id: "retirer",
        label: "Retirer du tableau",
        onPress: async () => {
          await retirerCarte(carte.id);
          shell.notify({ title: "Job retiré du tableau", tone: "success" });
          recharger();
        },
      },
    ];
  };

  const listeVues = vues.data ?? [];
  const choixVue =
    listeVues.length <= 1 ? null : (
      <Tabs
        pageTitle="Tableau de bord Jenkins"
        items={listeVues.map((v) => ({ id: v.id, label: v.nom }))}
        selectedId={vueId}
        onSelectionChange={setVueChoisie}
      />
    );

  const etatsVue = ordre.map((c) => etats.data?.get(cleEtat(c.instance, c.job)));
  const enEchec = etatsVue.filter((e) => e?.dernier?.resultat === "FAILURE" && !e.dernier.enCours).length;
  const enCoursVue = etatsVue.filter((e) => e?.dernier?.enCours || e?.enFile).length;
  const barre = (
    <Row gap="md">
      {choixVue}
      {ordre.length > 0 ? (
        <Text as="span" size="meta" tone="muted">
          {`${ordre.length} job${ordre.length > 1 ? "s" : ""}${enCoursVue > 0 ? ` · ${enCoursVue} en cours` : ""}${
            enEchec > 0 ? ` · ${enEchec} en échec` : ""
          }`}
        </Text>
      ) : null}
    </Row>
  );

  const actions: Action[] = [
    {
      id: "ajouter",
      label: "Ajouter des jobs",
      icon: <Plus size={16} />,
      primary: true,
      isDisabled: !vueId,
      onPress: () => setAjout(true),
    },
    { id: "actualiser", label: "Actualiser", icon: <RefreshCw size={16} />, onPress: () => etats.reload() },
    { id: "nouvelle-vue", label: "Nouvelle vue", onPress: nouvelleVue },
    {
      id: "renommer-vue",
      label: "Renommer la vue",
      icon: <Pencil size={16} />,
      isHidden: !vue,
      onPress: () =>
        openForm({
          ...formulaireVue(vue),
          onSubmit: async (v) => {
            await renommerVue(vueId, String(v.nom));
            recharger();
          },
        }),
    },
    {
      id: "supprimer-vue",
      label: "Supprimer la vue",
      icon: <Trash2 size={16} />,
      danger: true,
      isHidden: !vue || listeVues.length <= 1,
      confirm: {
        title: `Supprimer la vue « ${vue?.nom ?? ""} » ?`,
        message: "Ses cartes sont retirées du tableau ; les jobs restent dans Jenkins.",
        confirmLabel: "Supprimer",
      },
      onPress: async () => {
        await supprimerVue(vueId);
        shell.notify({ title: "Vue supprimée", tone: "success" });
        setVueChoisie(listeVues.find((v) => v.id !== vueId)?.id ?? "principale");
        recharger();
      },
    },
  ];

  const erreur = vues.error ?? cartes.error;
  const pret = Boolean(vues.data && cartes.data);
  return (
    <Page
      toolbar={barre}
      actions={actions}
      onActionError={notifyActionError}
      state={erreur && !vues.data ? "error" : !pret ? "loading" : "ready"}
      onRetry={recharger}
      loadingLabel="Chargement du tableau…"
    >
      {ordre.length === 0 ? (
        <PageSection
          title={vue?.nom ?? "Tableau"}
          empty={{
            title: "Aucun job sur cette vue",
            description:
              "Ajoutez les jobs Jenkins à surveiller avec « Ajouter des jobs » : leur état, leurs logs et la relance seront à portée de main.",
            action: { id: "ajouter", label: "Ajouter des jobs", onPress: () => setAjout(true) },
          }}
        >
          {null}
        </PageSection>
      ) : (
        <PageGrid columns={3}>
          {ordre.map((carte, index) => {
            const etat = etats.data?.get(cleEtat(carte.instance, carte.job));
            return (
              <CarteJob
                key={carte.id}
                carte={carte}
                etat={
                  etats.error
                    ? { ...(etat as EtatJob), erreur: `L’état des jobs n’a pas pu être lu : ${etats.error.message}` }
                    : etat
                }
                compte={nomCompte(carte.instance)}
                maintenant={maintenant}
                onLogs={() => ouvrirLogs(carte, etat)}
                onRelancer={() => relancer(carte)}
                rapport={rapports.data?.get(cleRapport(carte.instance, carte.job))}
                enAnalyse={enAnalyse.has(cleRapport(carte.instance, carte.job))}
                onRapport={(rapport) => setFenetre(ouvrirRapport(rapport, rapports.reload))}
                onAnalyser={() => analyser(carte, etat)}
                autres={actionsCarte(carte, index, etat)}
              />
            );
          })}
        </PageGrid>
      )}
      <Fenetres fenetre={fenetre} onClose={() => setFenetre(null)} ouvrir={setFenetre} apres={rapports.reload} />
      {ajout ? (
        <ChoixJobs
          comptes={listeComptes}
          dejaSuivis={new Set(ordre.map((c) => cleEtat(c.instance, c.job)))}
          vue={vue?.nom}
          onClose={() => setAjout(false)}
          onAjouter={async (instance, jobs) => {
            await ajouterCartes(vueId, instance, jobs);
            recharger();
          }}
        />
      ) : null}
    </Page>
  );
}
