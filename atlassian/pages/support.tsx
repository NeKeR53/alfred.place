import { Row, Text } from "@alfred/kit";
import { functions, shell, useAsync, usePageState } from "@alfred/sdk";
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { Code, Page, PageSection, SearchField, Select, Table } from "socle-ui";
import { badge, discret, tonCategorie } from "../lib/affichage";
import { badgeDelai, type DemandeListe } from "../lib/support";
import type { Compte } from "../lib/jira";

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
  // En ouvrant la page, la pastille du menu se remet à jour (sans notification : vous avez la liste sous les yeux).
  useEffect(() => {
    functions.call("relever-support", { notifier: false }).catch(() => undefined);
  }, []);

  const [compteChoisi, setCompteChoisi] = usePageState<string>("support.compte", "");
  const [serviceChoisi, setServiceChoisi] = usePageState<string>("support.service", "");
  const [fileChoisie, setFileChoisie] = usePageState<string>("support.file", "");
  const [texte, setTexte] = usePageState<string>("support.recherche", "");
  const [page, setPage] = usePageState<number>("support.page", 1);
  const [selection, setSelection] = usePageState<string | null>("support.selection", null);

  const comptes = useAsync(() => functions.call<{ comptes: Compte[] }>("comptes-jira"), []);
  const listeComptes = comptes.data?.comptes ?? [];
  const compte = listeComptes.find((c) => c.id === compteChoisi)?.id ?? listeComptes[0]?.id ?? "";

  const services = useAsync(
    () =>
      compte
        ? functions.call<{ services: Service[] }>("lister-services-support", { instance: compte })
        : Promise.resolve({ services: [] as Service[] }),
    [compte],
  );
  const listeServices = services.data?.services ?? [];
  const service = listeServices.find((s) => s.id === serviceChoisi)?.id ?? listeServices[0]?.id ?? "";

  const files = useAsync(
    () =>
      compte && service
        ? functions.call<{ files: FileSupport[] }>("lister-files-support", { instance: compte, service })
        : Promise.resolve({ files: [] as FileSupport[] }),
    [compte, service],
  );
  const listeFiles = files.data?.files ?? [];
  const file = listeFiles.find((f) => f.id === fileChoisie)?.id ?? listeFiles[0]?.id ?? "";

  const demandes = useAsync(
    () =>
      compte && service && file
        ? functions.call<{ demandes: DemandeListe[]; total: number }>("lister-demandes", {
            instance: compte,
            service,
            file,
            texte,
            debut: (page - 1) * TAILLE,
            limite: TAILLE,
          })
        : Promise.resolve({ demandes: [] as DemandeListe[], total: 0 }),
    [compte, service, file, texte, page],
  );

  // Au retour sur la page, le panneau reprend la demande ouverte.
  useEffect(() => {
    if (selection) void shell.publish({ id: selection });
  }, []);

  const lignes = demandes.data?.demandes ?? [];
  const total = demandes.data?.total ?? 0;

  function ouvrir(demande: DemandeListe) {
    const id = `${compte}|${demande.cle}`;
    setSelection(id);
    void shell.publish({ id });
    void shell.setPanelVisible(true);
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
      <Page width="text">
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
        <Row gap="sm">
          <SearchField
            label="les demandes"
            onChange={({ text }) => {
              setTexte(text.trim());
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
          {listeFiles.length > 0 ? (
            <Select
              label="File d’attente"
              hideLabel
              width="sm"
              value={file}
              options={listeFiles.map((f) => ({ id: f.id, label: f.nombre === null ? f.nom : `${f.nom} (${f.nombre})` }))}
              onChange={(id) => {
                if (!id) return;
                setFileChoisie(id);
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
                setSelection(null);
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
            { id: "cle", label: "Clé", width: 110, sortable: true },
            { id: "titre", label: "Demande", sortable: true },
            { id: "client", label: "Client", width: 160, sortable: true },
            { id: "statut", label: "État", width: 140, sortable: true },
            { id: "sla", label: "Délai", width: 150 },
            { id: "assigne", label: "Assigné", width: 140, sortable: true },
          ]}
          rows={lignes.map((ligne) => ({ ...ligne, id: `${compte}|${ligne.cle}` }))}
          renderCell={(ligne, colonne) =>
            colonne === "cle" ? (
              <Code>{ligne.cle}</Code>
            ) : colonne === "titre" ? (
              ligne.titre
            ) : colonne === "client" ? (
              discret(ligne.client)
            ) : colonne === "statut" ? (
              badge(ligne.statut, tonCategorie(ligne.statutCategorie))
            ) : colonne === "sla" ? (
              badgeDelai(ligne.sla)
            ) : (
              discret(ligne.assigne)
            )
          }
          selectionMode="single"
          selectedKeys={selection ? [selection] : []}
          onSelectionChange={(cles) => {
            const id = String([...cles][0] ?? "");
            const ligne = lignes.find((element) => `${compte}|${element.cle}` === id);
            if (ligne) ouvrir(ligne);
          }}
          isLoading={demandes.loading || files.loading}
        />
      </PageSection>
    </Page>
  );
}
