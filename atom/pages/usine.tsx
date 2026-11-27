import { Row, Text } from "@alfred/kit";
import { isExampleMode, shell, useAsync, usePageContext } from "@alfred/sdk";
import { useState } from "react";
import { ExternalLink, FileText, RefreshCw, SquareTerminal } from "lucide-react";
import { Button, EmptyState, DropdownMenu, Page, SearchInput, Badge, BadgeDot, Table, type TableColumn } from "socle-ui";
import { FenetreConsole, FenetreJournal } from "../lib/deploiement";
import { useResumeAtom } from "../lib/source";
import {
  ageConteneur,
  type Cellule,
  cibleDeploiement,
  etatCase,
  type Ligne,
  lireCible,
  lireUsine,
  santeEnv,
  versionAttendue,
} from "../lib/usine";

/**
 * Usine, comme celle de OneApp : une ligne par conteneur, regroupés par pile, une colonne par environnement. Un clic
 * sur une case ouvre son menu : voir les logs, ouvrir une console (chacun dans sa fenêtre), ouvrir l’application.
 * Ouverte par `shell.openWindow("usine", { params })`, la page est une de ces fenêtres.
 */
export default function UsinePage() {
  const contexte = usePageContext();
  if (!contexte) return <Page state="loading">{null}</Page>;
  const cible = lireCible(contexte.params);
  if (contexte.params) {
    if (!cible)
      return (
        <Page>
          <EmptyState title="Impossible d’ouvrir les outils de déploiement." />
        </Page>
      );
    return cible.outil === "logs" ? <FenetreJournal cible={cible} /> : <FenetreConsole cible={cible} />;
  }
  return <Grille />;
}

function Grille() {
  const usine = useAsync(lireUsine, []);
  const [recherche, setRecherche] = useState("");
  const mots = recherche.toLocaleLowerCase("fr").split(/\s+/).filter(Boolean);
  const correspond = (...textes: string[]) => {
    const tout = textes.join(" ").toLocaleLowerCase("fr");
    return mots.every((mot) => tout.includes(mot));
  };
  const donnees = usine.data;
  const envs = donnees?.envs ?? [];
  const toutes = donnees?.lignes ?? [];
  const conteneurs = toutes.reduce((total, ligne) => total + Object.keys(ligne.cellules).length, 0);
  const erreurs = donnees?.erreurs ?? [];
  useResumeAtom(
    donnees && envs.length
      ? [
          `${donnees.piles} pile${donnees.piles > 1 ? "s" : ""} · ${envs.length} environnement${envs.length > 1 ? "s" : ""} · ${conteneurs} conteneur${conteneurs > 1 ? "s" : ""}`,
          // Un Portainer injoignable : ses cases restent vides, la raison est dite ici (pas de bandeau).
          ...erreurs.map((e) => `${e.env.nom} injoignable`),
        ].join(" · ")
      : "",
  );

  const ouvrirOutil = (outil: "logs" | "console", ligne: Ligne, cellule: Cellule) =>
    shell
      .openWindow("usine", {
        params: cibleDeploiement(outil, ligne, cellule),
        key: `${outil}:${cellule.env.instance}:${cellule.conteneur.id}`,
        title: `${outil === "logs" ? "Logs" : "Console"} · ${cellule.conteneur.nom}`,
      })
      .catch((erreur: unknown) =>
        shell.notify({
          title: "Fenêtre de déploiement indisponible",
          description: erreur instanceof Error && erreur.message ? erreur.message : "Impossible d’ouvrir les outils du conteneur.",
          tone: "error",
        }),
      );
  const ouvrirApplication = async (url: string) => {
    if (isExampleMode()) {
      await shell.notify({ title: "Démonstration", description: `L’application serait ouverte à ${url}.`, tone: "info" });
      return;
    }
    await shell.openExternal(url).catch(() => shell.notify({ title: "Ouverture impossible", description: url, tone: "error" }));
  };

  if (usine.error)
    return (
      <Page>
        <EmptyState
          title="L’usine n’a pas pu être lue"
          description={usine.error.message}
          action={<Button onPress={usine.reload}>Réessayer</Button>}
        />
      </Page>
    );
  if (!donnees) return <Page state="loading" loadingLabel="Chargement des produits…">{null}</Page>;
  if (!envs.length || !toutes.length)
    return (
      <Page>
        <EmptyState
          title="Aucun produit déployé"
          description="Associez des environnements Portainer aux composants logiciels pour les suivre ici."
          action={
            <Button variant="primary" onPress={() => void shell.navigate("atom/atom")}>
              Ouvrir les environnements
            </Button>
          }
        />
      </Page>
    );

  const lignes = toutes
    .filter((ligne) => correspond(ligne.pile, ligne.service, ligne.conteneur))
    .map((ligne) => ({ ...ligne, id: ligne.cle }));

  const colonnes: TableColumn[] = [
    // La colonne principale prend la place restante ; les six environnements tiennent ainsi sur un écran.
    { id: "conteneur", label: "Application · conteneur" },
    ...envs.map((env): TableColumn => {
      const sante = santeEnv(toutes, env.id);
      // Le code suffit à nommer l’environnement : le nom complet resterait coupé dans l’en-tête.
      return { id: env.id, label: [env.code || env.nom, sante.texte].filter(Boolean).join(" · "), width: 140 };
    }),
  ];

  const presents = (ligne: Ligne) =>
    envs.flatMap((env) => (ligne.cellules[env.id] ? [{ env, cellule: ligne.cellules[env.id] }] : []));

  return (
    <Page
      toolbar={<SearchInput label="les produits, composants et conteneurs" onChange={({ text }) => setRecherche(text)} />}
      actions={[{ id: "actualiser", label: "Actualiser", icon: <RefreshCw size={16} />, onPress: usine.reload }]}
      footer={
        <Row gap="sm" wrap>
          <BadgeDot tone="success" label="Sain" />
          <Text tone="muted" size="meta" as="span">sain</Text>
          <BadgeDot tone="danger" label="Arrêté ou en erreur" />
          <Text tone="muted" size="meta" as="span">arrêté ou en erreur</Text>
          <BadgeDot tone="warning" label="Version différente" />
          <Text tone="muted" size="meta" as="span">version différente de celle attendue</Text>
          <BadgeDot tone="neutral" label="Non déployé" />
          <Text tone="muted" size="meta" as="span">non déployé</Text>
        </Row>
      }
    >
      {lignes.length ? (
        <Table<Ligne & { id: string }>
          searchTerms={mots}
          label="Usine"
          density="compact"
          selectionMode="none"
          isLoading={usine.loading}
          columns={colonnes}
          rows={lignes}
          groupBy={(ligne) => ligne.pile}
          rowDescription={(ligne) => (ligne.premier ? ligne.service : undefined)}
          renderCell={(ligne, colonne) => {
            if (colonne === "conteneur") return ligne.conteneur;
            const cellule = ligne.cellules[colonne];
            const etat = etatCase(cellule, versionAttendue(ligne));
            const note = etat.note || (etat.age ? `il y a ${etat.age}` : "");
            // Comme OneApp : une case en écart (arrêtée, en erreur, autre version) prend son ton.
            return (
              <Row gap="xs">
                <Badge tone={etat.ton}>{etat.version}</Badge>
                {note ? (
                  <Text tone={etat.ecart && etat.ton !== "neutral" ? etat.ton : "muted"} size="meta" as="span">
                    {note}
                  </Text>
                ) : null}
              </Row>
            );
          }}
          // Les outils de chaque case, comme le menu de case de OneApp : logs et console dans leur fenêtre, application à son adresse.
          rowActions={(ligne) => {
            const cases = presents(ligne);
            if (!cases.length) return [];
            return [
              {
                icon: <FileText size={16} />,
                label: `Voir les logs de ${ligne.conteneur}`,
                menu: cases.map(({ env, cellule }) => {
                  const etat = etatCase(cellule, versionAttendue(ligne));
                  const age = ageConteneur(cellule.conteneur.creeLe);
                  return (
                    <DropdownMenu.Item
                      key={env.id}
                      label={`${env.nom} · ${[etat.libelle, age ? `créé il y a ${age}` : ""].filter(Boolean).join(" · ")}`}
                      icon={<FileText size={16} />}
                      onAction={() => void ouvrirOutil("logs", ligne, cellule)}
                    />
                  );
                }),
              },
              {
                icon: <SquareTerminal size={16} />,
                label: `Console et application de ${ligne.conteneur}`,
                menu: [
                  <DropdownMenu.Section key="console" title="Ouvrir une console">
                    {cases.map(({ env, cellule }) => (
                      <DropdownMenu.Item
                        key={env.id}
                        label={env.nom}
                        icon={<SquareTerminal size={16} />}
                        isDisabled={cellule.conteneur.etat !== "running"}
                        onAction={() => void ouvrirOutil("console", ligne, cellule)}
                      />
                    ))}
                  </DropdownMenu.Section>,
                  <DropdownMenu.Section key="application" title="Ouvrir l’application">
                    {cases.map(({ env, cellule }) => {
                      const url = cellule.conteneur.url ?? undefined;
                      return (
                        <DropdownMenu.Item
                          key={env.id}
                          label={env.nom}
                          icon={<ExternalLink size={16} />}
                          isDisabled={!url}
                          onAction={() => (url ? void ouvrirApplication(url) : undefined)}
                        />
                      );
                    })}
                  </DropdownMenu.Section>,
                ],
              },
            ];
          }}
        />
      ) : (
        <EmptyState title="Aucun conteneur trouvé" description="Aucun produit, composant ou conteneur ne correspond à la recherche." />
      )}
    </Page>
  );
}
