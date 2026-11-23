import { functions, notifyActionError, useAsync, usePageContext, usePageState } from "@alfred/sdk";
import { CheckCheck, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { DetailPage, ListPage, type StatusMap } from "socle-ui";
import {
  actionsRapport,
  contexteRapport,
  type Fenetre,
  Fenetres,
  nomRapport,
  ouvrirRapport,
  titreRapport,
} from "../lib/ouvrir-rapport";
import { RapportEchec } from "../lib/RapportEchec";
import {
  CATEGORIES,
  lireRapports,
  type Rapport,
  recompterNonLus,
  supprimerRapport,
  supprimerRapportsLus,
  toutMarquerLu,
} from "../lib/rapport";

const ETATS: StatusMap = {
  non_lu: { label: "Nouveau", tone: "danger" },
  lu: { label: "Lu", tone: "neutral" },
  en_cours: { label: "Analyse en cours", tone: "pending" },
  erreur: { label: "Analyse impossible", tone: "warning" },
};

const etatDe = (r: Rapport) => (r.statut === "prete" ? (r.lu ? "lu" : "non_lu") : r.statut);

export default function Echecs() {
  // Chaque onglet est la page d’un compte Prefect : ses rapports seulement.
  const compte = usePageContext()?.instance ?? "";
  const rapports = useAsync(() => lireRapports(compte), [compte]);
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const [ouvertId, setOuvertId] = usePageState<string | null>("ouvert", null);
  // La pastille de l’onglet suit le nombre de rapports non lus.
  useEffect(() => {
    void recompterNonLus();
  }, []);
  const recharger = rapports.reload;
  const ouvert = rapports.data?.find((r) => r.execution === ouvertId);

  if (ouvert) {
    return (
      <DetailPage
        title={titreRapport(ouvert)}
        back={{ label: "Rapports d’échec", onPress: () => setOuvertId(null) }}
        status={{ label: ouvert.etat === "CRASHED" ? "Plantée" : "En échec", tone: "danger" }}
        meta={[nomRapport(ouvert), contexteRapport(ouvert)]}
        actions={actionsRapport(ouvert, recharger, setFenetre)}
        onActionError={notifyActionError}
        onActionDone={recharger}
      >
        <DetailPage.Section title="Rapport">
          <RapportEchec rapport={ouvert} />
        </DetailPage.Section>
        <Fenetres fenetre={fenetre} onClose={() => setFenetre(null)} ouvrir={setFenetre} apres={recharger} />
      </DetailPage>
    );
  }

  return (
    <>
      <ListPage<Rapport & { id: string }>
        title="Rapports d’échec"
        rows={rapports.data?.map((r) => ({ ...r, id: r.execution }))}
        columns={[
          { id: "deploiement", label: "Déploiement", value: nomRapport },
          { id: "cause", label: "Pourquoi", value: (r) => r.cause ?? r.erreur ?? "Analyse en cours…" },
          { id: "nom", label: "Exécution", type: "code" },
          { id: "fini_le", label: "Échouée", type: "relative", value: (r) => r.fini_le ?? r.cree_le },
          { id: "etat_rapport", label: "État", type: "status", statuses: ETATS, value: etatDe },
        ]}
        search={{
          label: "les rapports",
          text: (r) =>
            [r.deploiement, r.nom, r.titre, r.cause, r.resume, CATEGORIES[r.categorie ?? ""]].filter(Boolean).join(" "),
        }}
        filters={[
          {
            id: "vue",
            label: "Rapports",
            allLabel: "Tous",
            options: [{ id: "non-lus", label: "Non lus" }],
            value: (r) => (r.statut === "prete" && !r.lu ? "non-lus" : null),
          },
        ]}
        empty={{
          title: "Aucun rapport d’échec",
          description:
            "Quand une exécution échoue ou plante, j’analyse ses logs et le rapport arrive ici, avec une notification qui en donne la cause.",
        }}
        onOpen={(r) => {
          ouvrirRapport(r, recharger);
          setOuvertId(r.execution);
        }}
        actions={[
          { id: "lu", label: "Tout marquer comme lu", icon: <CheckCheck size={16} />, onPress: toutMarquerLu },
          {
            id: "relever",
            label: "Relever les échecs maintenant",
            icon: <RefreshCw size={16} />,
            onPress: () => functions.call("surveiller-echecs", {}),
          },
          {
            id: "supprimer-lus",
            label: "Supprimer les rapports lus",
            danger: true,
            confirm: {
              title: "Supprimer les rapports déjà lus ?",
              message: "Les exécutions restent dans Prefect ; seuls les rapports sont effacés.",
              confirmLabel: "Supprimer",
            },
            onPress: supprimerRapportsLus,
          },
        ]}
        rowActions={(r) => [
          ...actionsRapport(r, recharger, setFenetre),
          {
            id: "supprimer",
            label: "Supprimer le rapport",
            icon: <Trash2 size={16} />,
            danger: true,
            confirm: { title: `Supprimer le rapport de l’exécution « ${r.nom ?? r.execution} » ?`, confirmLabel: "Supprimer" },
            onPress: () => supprimerRapport(r.execution),
          },
        ]}
        isLoading={rapports.loading}
        hasError={Boolean(rapports.error)}
        onRetry={rapports.reload}
        onActionError={notifyActionError}
        onActionDone={rapports.reload}
      />
      <Fenetres fenetre={fenetre} onClose={() => setFenetre(null)} ouvrir={setFenetre} apres={recharger} />
    </>
  );
}
