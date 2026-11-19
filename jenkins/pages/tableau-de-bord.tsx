import { useEffect, useState } from "react";
import { ExternalLink, Play, RefreshCw } from "lucide-react";
import Sortable from "sortablejs";
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
  openModal,
  openSubpage,
  Page,
  Row,
  SelectControl,
  Text,
  usePageState,
} from "@alfred/ui";
import { badge, functions, shell, useAsync } from "@alfred/sdk";
import { CarteJob } from "../lib/CarteJob";
import { ChoixJobs, type Selection } from "../lib/ChoixJobs";
import { JournalBuild } from "../lib/JournalBuild";
import {
  ajouterCartes,
  type Carte,
  cleEtat,
  compterEnCours,
  type Compte,
  creerVue,
  deplacerCarte,
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
  fields: [{ name: "nom", label: "Nom de la vue", placeholder: "Déploiements" }],
  initial: vue,
  submitLabel: vue ? "Enregistrer" : "Créer",
});

export default function TableauDeBord() {
  const [vueChoisie, setVueChoisie] = usePageState<string>("vue", "principale");
  const [version, setVersion] = useState(0);
  const recharger = () => setVersion((v) => v + 1);

  const vues = useAsync(lireVues, [version]);
  const comptes = useAsync(() => functions.call<{ comptes: Compte[] }>("comptes-jenkins").then((r) => r.comptes), []);
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

  // Glisser-déposer des cartes dans la grille.
  const cleOrdre = ordre.map((c) => c.id).join("|");
  useEffect(() => {
    if (ordre.length < 2) return;
    const grille = document.querySelector<HTMLElement>(".al-page__body .al-grid");
    if (!grille) return;
    const tri = Sortable.create(grille, {
      animation: 150,
      forceFallback: true,
      fallbackTolerance: 4,
      filter: "button, a, input, select, textarea, [role='menu'], [role='menuitem']",
      preventOnFilter: false,
      onEnd: (evenement) => {
        const { item, from, oldIndex, newIndex } = evenement;
        if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;
        // React garde la main sur le DOM : on remet la carte à sa place, puis on change l’ordre.
        from.removeChild(item);
        from.insertBefore(item, from.children[oldIndex] ?? null);
        setOrdre((actuel) => {
          const suivant = [...actuel];
          const [deplacee] = suivant.splice(oldIndex, 1);
          suivant.splice(newIndex, 0, deplacee);
          void enregistrerOrdre(suivant.map((c) => c.id)).catch((erreur: Error) =>
            shell.notify({ title: "La nouvelle disposition n’a pas été enregistrée", description: erreur.message, tone: "error" }),
          );
          return suivant;
        });
      },
    });
    return () => tri.destroy();
  }, [cleOrdre]);

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

  const ouvrirLogs = (carte: Carte, etat: EtatJob | undefined) => {
    const affiche = etatAffiche(etat);
    const urlBuild = etat?.dernier?.url;
    void openSubpage({
      title: etat?.nom ?? nomCourt(carte.job),
      subtitle: etat?.dernier ? `Build n° ${etat.dernier.numero}` : undefined,
      status: affiche,
      actions: [
        ...(urlBuild
          ? [{ label: "Ouvrir dans Jenkins", icon: ExternalLink, onClick: () => shell.openExternal(`${urlBuild}console`) }]
          : []),
        {
          label: "Relancer",
          icon: Play,
          confirm: `Relancer le job « ${etat?.nom ?? nomCourt(carte.job)} » ?`,
          success: "Build demandé",
          onClick: () => relancer(carte),
        },
      ],
      content: <JournalBuild instance={carte.instance} job={carte.job} build={etat?.dernier?.numero} />,
    });
  };

  const ajouterDesJobs = () => {
    const selection: Selection = { instance: "", jobs: new Set() };
    const dejaSuivis = new Set(ordre.map((c) => cleEtat(c.instance, c.job)));
    return openModal({
      title: "Ajouter des jobs",
      description: vue ? `Ils s’ajoutent à la vue « ${vue.nom} ».` : undefined,
      size: "wide",
      content: <ChoixJobs comptes={listeComptes} dejaSuivis={dejaSuivis} selection={selection} />,
      actions: [
        {
          label: "Ajouter les jobs choisis",
          primary: true,
          onClick: async () => {
            if (selection.jobs.size === 0) throw new Error("Choisissez au moins un job dans la liste.");
            await ajouterCartes(vueId, selection.instance, [...selection.jobs]);
            recharger();
          },
        },
      ],
    });
  };

  const nouvelleVue = () =>
    openForm({
      ...formulaireVue(),
      success: "Vue créée",
      onSubmit: async (v) => {
        const id = await creerVue(v.nom);
        setVueChoisie(id);
        recharger();
      },
    });

  const actionsCarte = (carte: Carte, index: number, etat: EtatJob | undefined): Action[] => {
    const autresVues = (vues.data ?? []).filter((v) => v.id !== vueId);
    return [
      {
        label: "Ouvrir dans Jenkins",
        hidden: !etat?.url,
        onClick: () => shell.openExternal(etat?.url ?? ""),
      },
      { label: "Déplacer vers la gauche", hidden: index === 0, onClick: () => deplacerDe(index, -1) },
      { label: "Déplacer vers la droite", hidden: index === ordre.length - 1, onClick: () => deplacerDe(index, 1) },
      {
        label: "Déplacer vers une autre vue…",
        hidden: autresVues.length === 0,
        onClick: () =>
          openForm({
            title: "Déplacer vers une autre vue",
            fields: [
              {
                name: "vue",
                label: "Vue",
                type: "select",
                options: autresVues.map((v) => ({ value: v.id, label: v.nom })),
              },
            ],
            initial: { vue: autresVues[0]?.id },
            submitLabel: "Déplacer",
            success: "Job déplacé",
            onSubmit: async (v) => {
              await deplacerCarte(carte, v.vue);
              recharger();
            },
          }),
      },
      {
        label: "Retirer du tableau",
        success: "Job retiré du tableau",
        onClick: async () => {
          await retirerCarte(carte.id);
          recharger();
        },
      },
    ];
  };

  const listeVues = vues.data ?? [];
  const choixVue =
    listeVues.length <= 1 ? null : listeVues.length <= 4 ? (
      <ChoiceGroup appearance="segmented" label="Vue">
        {listeVues.map((v) => (
          <ChoiceButton
            key={v.id}
            label={v.nom}
            variant="label"
            size="compact"
            selected={v.id === vueId}
            onClick={() => setVueChoisie(v.id)}
          >
            {v.nom}
          </ChoiceButton>
        ))}
      </ChoiceGroup>
    ) : (
      <SelectControl aria-label="Vue" value={vueId} onChange={(event) => setVueChoisie(event.target.value)}>
        {listeVues.map((v) => (
          <option key={v.id} value={v.id}>
            {v.nom}
          </option>
        ))}
      </SelectControl>
    );

  const etatsVue = ordre.map((c) => etats.data?.get(cleEtat(c.instance, c.job)));
  const enEchec = etatsVue.filter((e) => e?.dernier?.resultat === "FAILURE" && !e.dernier.enCours).length;
  const enCoursVue = etatsVue.filter((e) => e?.dernier?.enCours || e?.enFile).length;
  const bar = (
    <Row gap="md">
      {choixVue}
      {ordre.length > 0 ? (
        <Text as="span" size="meta" tone="muted">
          {ordre.length} job{ordre.length > 1 ? "s" : ""}
          {enCoursVue > 0 ? ` · ${enCoursVue} en cours` : ""}
          {enEchec > 0 ? ` · ${enEchec} en échec` : ""}
          {ordre.length > 1 ? " · glissez une carte pour la déplacer" : ""}
        </Text>
      ) : null}
    </Row>
  );

  const actions: Action[] = [
    { label: "Ajouter des jobs", primary: true, disabled: !vueId, onClick: ajouterDesJobs },
    { label: "Actualiser", icon: RefreshCw, onClick: () => etats.reload() },
    { label: "Nouvelle vue", onClick: nouvelleVue },
    {
      label: "Renommer la vue",
      hidden: !vue,
      onClick: () =>
        openForm({
          ...formulaireVue(vue),
          onSubmit: async (v) => {
            await renommerVue(vueId, v.nom);
            recharger();
          },
        }),
    },
    {
      label: "Supprimer la vue",
      danger: true,
      hidden: !vue || listeVues.length <= 1,
      confirm: `Supprimer la vue « ${vue?.nom ?? ""} » ?`,
      confirmMessage: "Ses cartes sont retirées du tableau ; les jobs restent dans Jenkins.",
      success: "Vue supprimée",
      onClick: async () => {
        await supprimerVue(vueId);
        setVueChoisie(listeVues.find((v) => v.id !== vueId)?.id ?? "principale");
        recharger();
      },
    },
  ];

  const erreur = vues.error ?? cartes.error;
  let contenu;
  if (erreur && !vues.data) {
    contenu = (
      <FeedbackBanner tone="danger" action={<Button onClick={recharger}>Réessayer</Button>}>
        Le tableau n’a pas pu être chargé : {erreur.message}
      </FeedbackBanner>
    );
  } else if (!vues.data || !cartes.data) {
    contenu = <LoadingSkeleton variant="page" rows={4} label="Chargement du tableau…" />;
  } else if (ordre.length === 0) {
    contenu = (
      <EmptyState
        title="Aucun job sur cette vue"
        description="Ajoutez les jobs Jenkins à surveiller avec « Ajouter des jobs » : leur état, leurs logs et la relance seront à portée de main."
      />
    );
  } else {
    contenu = (
      <>
        {etats.error ? (
          <FeedbackBanner tone="danger" action={<Button onClick={etats.reload}>Réessayer</Button>}>
            L’état des jobs n’a pas pu être lu : {etats.error.message}
          </FeedbackBanner>
        ) : null}
        <Grid minColumnWidth={280}>
          {ordre.map((carte, index) => {
            const etat = etats.data?.get(cleEtat(carte.instance, carte.job));
            return (
              <CarteJob
                key={carte.id}
                carte={carte}
                etat={etat}
                compte={nomCompte(carte.instance)}
                maintenant={maintenant}
                onLogs={() => ouvrirLogs(carte, etat)}
                onRelancer={() => relancer(carte)}
                autres={actionsCarte(carte, index, etat)}
              />
            );
          })}
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

