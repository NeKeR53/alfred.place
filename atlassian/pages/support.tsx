import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { functions, shell, useAsync } from "@alfred/sdk";
import {
  Button,
  Code,
  DataTable,
  EmptyState,
  FeedbackBanner,
  LoadingSkeleton,
  Page,
  Pagination,
  Row,
  SelectControl,
  Stack,
  Text,
  usePageState,
} from "@alfred/ui";
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
  const [recherche, setRecherche] = usePageState<string>("support.recherche", "");
  const [page, setPage] = usePageState<number>("support.page", 1);
  const [selection, setSelection] = usePageState<string | null>("support.selection", null);

  // La recherche part une fois la frappe terminée, pas à chaque lettre.
  const [texte, setTexte] = useState(recherche);
  useEffect(() => {
    const minuterie = setTimeout(() => setTexte(recherche.trim()), 350);
    return () => clearTimeout(minuterie);
  }, [recherche]);

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

  if ((comptes.loading && !comptes.data) || (services.loading && !services.data)) {
    return (
      <Page>
        <LoadingSkeleton />
      </Page>
    );
  }

  const erreurDepart = comptes.error ?? services.error;
  if (erreurDepart) {
    return (
      <Page>
        <FeedbackBanner
          tone="danger"
          action={
            <Button
              onClick={() => {
                comptes.reload();
                services.reload();
              }}
            >
              Réessayer
            </Button>
          }
        >
          {erreurDepart.message}
        </FeedbackBanner>
      </Page>
    );
  }

  if (listeComptes.length === 0) {
    return (
      <Page width="text">
        <EmptyState
          title="Aucun compte Jira"
          description="Ajoutez votre Jira dans la fiche du module Atlassian (Réglages, Modules) : vos demandes de support s’afficheront ici."
        />
      </Page>
    );
  }

  if (listeServices.length === 0) {
    return (
      <Page width="text">
        <EmptyState
          title="Aucun centre de services"
          description="Ce compte Jira n’a pas de projet Jira Service Management, ou vous n’y êtes pas agent."
        />
      </Page>
    );
  }

  return (
    <Page
      search={{
        label: "Rechercher une demande",
        value: recherche,
        onChange: (valeur) => {
          setRecherche(valeur);
          setPage(1);
        },
      }}
      bar={
        <Row gap="sm">
          {listeServices.length > 1 && (
            <SelectControl
              aria-label="Centre de services"
              value={service}
              onChange={(evenement) => {
                setServiceChoisi(evenement.target.value);
                setFileChoisie("");
                setPage(1);
              }}
            >
              {listeServices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.projetNom}
                </option>
              ))}
            </SelectControl>
          )}
          {listeFiles.length > 0 && (
            <SelectControl
              aria-label="File d’attente"
              value={file}
              onChange={(evenement) => {
                setFileChoisie(evenement.target.value);
                setPage(1);
              }}
            >
              {listeFiles.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nombre === null ? f.nom : `${f.nom} (${f.nombre})`}
                </option>
              ))}
            </SelectControl>
          )}
          {listeComptes.length > 1 && (
            <SelectControl
              aria-label="Compte Jira"
              value={compte}
              onChange={(evenement) => {
                setCompteChoisi(evenement.target.value);
                setServiceChoisi("");
                setFileChoisie("");
                setSelection(null);
                setPage(1);
              }}
            >
              {listeComptes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </SelectControl>
          )}
        </Row>
      }
      actions={[{ label: "Actualiser", icon: RefreshCw, onClick: actualiser }]}
      footer={
        <Row align="center" justify="between">
          <Text size="meta">{total === 0 ? "Aucune demande" : `${total} demande${total > 1 ? "s" : ""}`}</Text>
          {total > TAILLE && <Pagination page={page} pageSize={TAILLE} total={total} onChange={setPage} />}
        </Row>
      }
    >
      <Stack gap="md">
        {(files.error || demandes.error) && (
          <FeedbackBanner tone="danger" action={<Button onClick={actualiser}>Réessayer</Button>}>
            {(files.error ?? demandes.error)?.message}
          </FeedbackBanner>
        )}
        {!files.loading && listeFiles.length === 0 && !files.error ? (
          <EmptyState
            size="compact"
            title="Aucune file d’attente"
            description="Ce centre de services n’a pas encore de file d’attente visible pour vous."
          />
        ) : (
          <DataTable<DemandeListe>
            label="Demandes"
            columns={[
              { key: "cle", header: "Clé", sortable: true, render: (ligne) => <Code>{ligne.cle}</Code> },
              { key: "titre", header: "Demande", sortable: true },
              { key: "client", header: "Client", sortable: true, render: (ligne) => discret(ligne.client) },
              {
                key: "statut",
                header: "État",
                sortable: true,
                render: (ligne) => badge(ligne.statut, tonCategorie(ligne.statutCategorie)),
              },
              { key: "sla", header: "Délai", render: (ligne) => badgeDelai(ligne.sla) },
              { key: "assigne", header: "Assigné", sortable: true, render: (ligne) => discret(ligne.assigne) },
            ]}
            rows={lignes}
            rowKey={(ligne) => `${compte}|${ligne.cle}`}
            selectedKey={selection}
            onRowClick={ouvrir}
            loading={demandes.loading || files.loading}
            emptyTitle={texte ? "Aucun résultat" : "Aucune demande dans cette file"}
          />
        )}
      </Stack>
    </Page>
  );
}
