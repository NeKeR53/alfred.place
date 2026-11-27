import { functions, notifyActionError, useAsync, usePageState } from "@alfred/sdk";
import { CheckCheck, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { DetailPage, ListPage, type StatusMap } from "socle-ui";
import {
  actionsRapport,
  contexteRapport,
  type Fenetre,
  Fenetres,
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
import { dossierDe, nomCourt } from "../lib/tableau";

const ETATS: StatusMap = {
  non_lu: { label: "Nouveau", tone: "danger" },
  lu: { label: "Lu", tone: "neutral" },
  en_cours: { label: "Analyse en cours", tone: "pending" },
  erreur: { label: "Analyse impossible", tone: "warning" },
};

const etatDe = (r: Rapport) => (r.statut === "prete" ? (r.lu ? "lu" : "non_lu") : r.statut);

/** Une ligne de la liste : le rapport, avec le numéro de build et l’état déjà mis en texte. */
type Ligne = Rapport & { numero: string; etat: string };
const enLigne = (r: Rapport): Ligne => ({ ...r, numero: `n° ${r.build}`, etat: etatDe(r) });

export default function Echecs() {
  const rapports = useAsync(lireRapports, []);
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const [ouvertId, setOuvertId] = usePageState<string | null>("ouvert", null);
  // La pastille de l’onglet suit le nombre de rapports non lus.
  useEffect(() => {
    void recompterNonLus();
  }, []);
  const recharger = rapports.reload;
  const ouvert = rapports.data?.find((r) => r.id === ouvertId);

  if (ouvert) {
    return (
      <DetailPage
        title={titreRapport(ouvert)}
        back={{ label: "Rapports d’échec", onPress: () => setOuvertId(null) }}
        status={{ label: "En échec", tone: "danger" }}
        meta={[nomCourt(ouvert.job), contexteRapport(ouvert)]}
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
    <ListPage<Ligne>
      title="Rapports d’échec"
      rows={rapports.data?.map(enLigne)}
      columns={[
        {
          id: "echec",
          label: "Échec",
          value: (r) =>
            `${[nomCourt(r.job), dossierDe(r.job)].filter(Boolean).join(" · ")} — ${
              r.titre ?? r.cause ?? r.erreur ?? "analyse en cours…"
            }`,
        },
        { id: "numero", label: "Build", type: "code" },
        { id: "analyse_le", label: "Analysé", type: "relative", value: (r) => r.analyse_le ?? r.cree_le },
        { id: "etat", label: "État", type: "status", statuses: ETATS },
      ]}
      search={{
        label: "les rapports",
        text: (r) => [r.job, r.titre, r.cause, r.resume, CATEGORIES[r.categorie ?? ""]].filter(Boolean).join(" "),
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
          "Quand un job du tableau échoue, j’analyse son log et le rapport arrive ici, avec une notification qui en donne la cause.",
      }}
      onOpen={(r) => {
        ouvrirRapport(r, recharger);
        setOuvertId(r.id);
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
            message: "Les builds restent dans Jenkins ; seuls les rapports sont effacés.",
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
          confirm: {
            title: `Supprimer le rapport du build n° ${r.build} de « ${nomCourt(r.job)} » ?`,
            confirmLabel: "Supprimer",
          },
          onPress: () => supprimerRapport(r.id),
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
