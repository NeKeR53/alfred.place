import { Row, Stack, Text } from "@alfred/kit";
import { functions, notifyActionError, shell, usePageContext, usePageState, views } from "@alfred/sdk";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { DetailPage, Page, PageSection, Select, Table, Tabs } from "socle-ui";
import { badge, discret, tonCategorie } from "../lib/affichage";
import { useEtat } from "../lib/etat";
import { badgeDelai, type DemandeListe, useDemande } from "../lib/support";
import type { Compte } from "../lib/jira";
import { RechercheRetenue } from "../lib/recherche-retenue";

const TAILLE = 40;

interface Service {
  id: string;
  projetCle: string;
  projetNom: string;
}

interface FileSupport {
  id: string;
  nom: string;
  nombre: number | null;
}

export default function SupportPage() {
  const contexte = usePageContext();
  const vue = contexte?.view;
  const panneauVisible = contexte ? Boolean(vue) : undefined;

  useEffect(() => {
    if (panneauVisible !== undefined) void shell.setPanelVisible(panneauVisible);
  }, [panneauVisible]);

  if (!contexte) return <Page state="loading">{null}</Page>;
  if (vue) {
    return <DemandeOuverte id={vue.id} label={vue.label} retour={() => shell.navigate(contexte.reference)} />;
  }
  return <ListeDemandes />;
}

function DemandeOuverte({ id, label, retour }: { id: string; label: string; retour: () => Promise<void> }) {
  const lecture = useDemande(id);
  const demande = lecture.data ?? null;
  return (
    <DetailPage
      title={demande ? `${demande.cle} · ${demande.titre}` : label}
      back={{ label: "Demandes", onPress: retour }}
      meta={demande?.typeDemande ? [demande.typeDemande] : undefined}
      state={lecture.error ? "error" : demande ? "ready" : lecture.loading ? "loading" : "not-found"}
      onRetry={lecture.reload}
      notFound={{ title: "Demande introuvable" }}
    >
      {demande ? (
        <DetailPage.Section title="Description" empty={demande.description ? undefined : { title: "Aucune description" }}>
          {demande.description ? <Text>{demande.description}</Text> : null}
        </DetailPage.Section>
      ) : null}
    </DetailPage>
  );
}

function ListeDemandes() {
  // En ouvrant la page, la pastille du menu se remet à jour (sans notification : vous avez la liste sous les yeux).
  useEffect(() => {
    functions.call("relever-support", { notifier: false }).catch(() => undefined);
  }, []);

  const [compteChoisi, setCompteChoisi] = usePageState<string>("support.compte", "");
  const [serviceChoisi, setServiceChoisi] = usePageState<string>("support.service", "");
  const [fileChoisie, setFileChoisie] = usePageState<string>("support.file", "");
  const [texte, setTexte] = usePageState<string>("support.recherche", "");
  const [page, setPage] = usePageState<number>("support.page", 1);

  const comptes = useEtat<{ comptes: Compte[] }>("comptes-jira");
  const listeComptes = comptes.data?.comptes ?? [];
  const compte = listeComptes.find((c) => c.id === compteChoisi)?.id ?? listeComptes[0]?.id ?? "";

  const services = useEtat<{ services: Service[] }>("services-support", compte ? { instance: compte } : null);
  const listeServices = services.data?.services ?? [];
  const service = listeServices.find((s) => s.id === serviceChoisi)?.id ?? listeServices[0]?.id ?? "";

  const files = useEtat<{ files: FileSupport[] }>("files-support", compte && service ? { instance: compte, service } : null);
  const listeFiles = files.data?.files ?? [];  const file = listeFiles.find((f) => f.id === fileChoisie)?.id ?? listeFiles[0]?.id ?? "";

  const demandes = useEtat<{ demandes: DemandeListe[]; total: number }>(
    "demandes",
    compte && service && file
      ? { instance: compte, service, file, texte, debut: (page - 1) * TAILLE, limite: TAILLE }
      : null,
  );

  const lignes = demandes.data?.demandes ?? [];  const total = demandes.data?.total ?? 0;

  function ouvrir(id: string) {
    const demande = lignes.find((ligne) => `${compte}|${ligne.cle}` === id);
    if (!demande) return;
    void views.open({ id, label: demande.cle }).catch((error) =>
      notifyActionError({ label: "Ouvrir la demande" }, error),
    );
  }

  function actualiser() {
    files.reload();
    demandes.reload();
    functions.call("relever-support", { notifier: false }).catch(() => undefined);
  }

  const erreurDepart = comptes.error ?? services.error;
  const chargement = (comptes.loading && !comptes.data) || (services.loading && !services.data);
  if (chargement || erreurDepart) {
    return (
      <Page
        state={erreurDepart ? "error" : "loading"}
        onRetry={() => {
          comptes.reload();
          services.reload();
        }}
      >
        {null}
      </Page>
    );
  }

  if (listeComptes.length === 0 || listeServices.length === 0) {
    return (
      <Page>
        <PageSection
          title="Support"
          empty={
            listeComptes.length === 0
              ? {
                  title: "Aucun compte Jira",
                  description:
                    "Ajoutez votre Jira dans la fiche du module Atlassian (Réglages, Modules) : vos demandes de support s’afficheront ici.",
                }
              : {
                  title: "Aucun centre de services",
                  description: "Ce compte Jira n’a pas de projet Jira Service Management, ou vous n’y êtes pas agent.",
                }
          }
        >
          {null}
        </PageSection>
      </Page>
    );
  }

  const pages = Math.max(1, Math.ceil(total / TAILLE));
  const sansFile = !files.loading && listeFiles.length === 0 && !files.error;
  return (
    <Page
      toolbar={
        <Row gap="sm" wrap>
          {listeFiles.length > 0 ? (
            <Tabs
              pageTitle="Support"
              items={listeFiles.map((f) => ({ id: f.id, label: f.nombre === null ? f.nom : `${f.nom} (${f.nombre})` }))}
              selectedId={file}
              onSelectionChange={(id) => {
                setFileChoisie(id);
                setPage(1);
              }}
            />
          ) : null}
        </Row>
      }
      actions={[
        { id: "actualiser", label: "Actualiser", icon: <RefreshCw size={16} />, onPress: actualiser },
        {
          id: "precedente",
          label: "Page précédente",
          icon: <ChevronLeft size={16} />,
          isHidden: pages <= 1,
          isDisabled: page <= 1,
          onPress: () => setPage(Math.max(1, page - 1)),
        },
        {
          id: "suivante",
          label: "Page suivante",
          icon: <ChevronRight size={16} />,
          isHidden: pages <= 1,
          isDisabled: page >= pages,
          onPress: () => setPage(Math.min(pages, page + 1)),
        },
      ]}
      footer={
        <Text size="meta">
          {`${total === 0 ? "Aucune demande" : `${total} demande${total > 1 ? "s" : ""}`}${pages > 1 ? ` · page ${page} sur ${pages}` : ""}`}
        </Text>
      }
    >
      <Row gap="sm" wrap>
        <RechercheRetenue
          label="les demandes"
          recherche={texte}
          onChange={(valeur) => {
            if (valeur === texte) return;
            setTexte(valeur);
            setPage(1);
          }}
        />
        {listeServices.length > 1 ? (
          <Select
            label="Centre de services"
            hideLabel
            width="sm"
            value={service}
            options={listeServices.map((s) => ({ id: s.id, label: s.projetNom }))}
            onChange={(id) => {
              if (!id) return;
              setServiceChoisi(id);
              setFileChoisie("");
              setPage(1);
            }}
          />
        ) : null}
        {listeComptes.length > 1 ? (
          <Select
            label="Compte Jira"
            hideLabel
            width="sm"
            value={compte}
            options={listeComptes.map((c) => ({ id: c.id, label: c.label }))}
            onChange={(id) => {
              if (!id) return;
              setCompteChoisi(id);
              setServiceChoisi("");
              setFileChoisie("");
              setPage(1);
            }}
          />
        ) : null}
      </Row>
      <PageSection
        title={listeFiles.find((f) => f.id === file)?.nom ?? "Demandes"}
        state={files.error || demandes.error ? "error" : "ready"}
        onRetry={actualiser}
        empty={
          sansFile
            ? {
                title: "Aucune file d’attente",
                description: "Ce centre de services n’a pas encore de file d’attente visible pour vous.",
              }
            : demandes.data && lignes.length === 0
              ? { title: texte ? "Aucun résultat" : "Aucune demande dans cette file" }
              : undefined
        }
      >
        <Table<DemandeListe & { id: string }>
          label="Demandes"
          columns={[
            { id: "titre", label: "Demande", sortable: true },
            { id: "statut", label: "État", width: 150, sortable: true },
            { id: "sla", label: "Délai", width: 120 },
          ]}
          rows={lignes.map((ligne) => ({ ...ligne, id: `${compte}|${ligne.cle}` }))}
          renderCell={(ligne, colonne) =>
            colonne === "titre" ? (
              // Clé et client passent sous le titre : le titre garde toute la largeur, panneau ouvert comme à 1024.
              <Stack gap="xs">
                <Text as="span">{ligne.titre}</Text>
                {discret([ligne.cle, ligne.client].filter(Boolean).join(" · "))}
              </Stack>
            ) : colonne === "statut" ? (
              badge(ligne.statut, tonCategorie(ligne.statutCategorie))
            ) : colonne === "sla" ? (
              badgeDelai(ligne.sla)
            ) : null
          }
          selectionMode="none"
          onAction={ouvrir}
          isLoading={demandes.loading || files.loading}
        />
      </PageSection>
    </Page>
  );
}
