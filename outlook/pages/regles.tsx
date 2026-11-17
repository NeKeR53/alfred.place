import { Pencil, Play, Plus, Power, Trash2 } from "lucide-react";
import { functions, shell, useAsync } from "@alfred/sdk";
import { CollectionPage, FeedbackBanner, confirmAction, openForm } from "@alfred/ui";
import { lireRegles, resumerActions, resumerConditions, type Regle } from "../lib/regles";

interface Dossier {
  id: string;
  nom: string;
  profondeur: number;
}

interface Ligne extends Regle {
  conditionTexte: string;
  actionTexte: string;
}

export default function ReglesPage() {
  const dossiers = useAsync(
    () => functions.call<{ boite: string; dossiers: Dossier[] }>("lister-dossiers", {}),
    [],
  );
  const listeDossiers = dossiers.data?.dossiers ?? [];
  const noms: Record<string, string> = {};
  for (const dossier of listeDossiers) noms[dossier.id] = dossier.nom;

  const comptes = useAsync(() => functions.call<{ pret: boolean }>("comptes-outlook"), []);
  const pret = comptes.data?.pret === true;

  function formulaire(regle?: Regle) {
    const champs: Array<Record<string, unknown>> = [
      { name: "nom", label: "Nom de la règle", placeholder: "Factures fournisseurs" },
      {
        name: "expediteur",
        label: "Expéditeur contient",
        optional: true,
        placeholder: "comptabilite",
        hint: "Un nom ou une adresse, même partiel.",
      },
      { name: "objet", label: "Objet contient", optional: true, placeholder: "facture" },
      {
        name: "sujet",
        label: "Le message parle de",
        optional: true,
        placeholder: "factures fournisseurs",
        hint: "En mots simples : je lis chaque message et je juge s’il en parle.",
      },
      { name: "marquerLu", label: "Marquer comme lu", type: "checkbox", optional: true },
    ];
    if (listeDossiers.length > 0) {
      champs.push({
        name: "deplacerVers",
        label: "Déplacer vers",
        type: "select",
        optional: true,
        options: listeDossiers.map((dossier) => ({
          value: dossier.id,
          label: `${"— ".repeat(dossier.profondeur)}${dossier.nom}`,
        })),
        validate: (_valeur: string, valeurs: Record<string, string>) =>
          valeurs.marquerLu !== "1" && !valeurs.deplacerVers ? "Choisissez au moins une action." : undefined,
      });
    }

    return openForm({
      title: regle ? "Modifier la règle" : "Nouvelle règle",
      description: "Chaque nouveau message est trié au relevé. Précisez au moins une condition et une action.",
      fields: champs,
      initial: {
        nom: regle?.nom ?? "",
        expediteur: regle?.conditions.expediteur ?? "",
        objet: regle?.conditions.objet ?? "",
        sujet: regle?.conditions.sujet ?? "",
        marquerLu: regle?.actions.marquerLu ? "1" : "0",
        deplacerVers: regle?.actions.deplacerVers ?? "",
      },
      submitLabel: regle ? "Enregistrer" : "Créer",
      success: regle ? "Règle modifiée" : "Règle créée",
      onSubmit: async (valeurs) => {
        const enregistree = await functions.call<{ id: string }>("enregistrer-regle", {
          id: regle?.id,
          nom: valeurs.nom,
          actif: regle?.actif ?? true,
          conditions: {
            expediteur: valeurs.expediteur,
            objet: valeurs.objet,
            sujet: valeurs.sujet,
            nonLu: regle?.conditions.nonLu === true,
          },
          actions: {
            marquerLu: valeurs.marquerLu === "1",
            deplacerVers: valeurs.deplacerVers,
          },
        });
        if (!pret) return;
        // Proposer aussitôt de ranger les messages déjà reçus.
        setTimeout(() => void proposerApplication(enregistree.id, valeurs.nom), 300);
      },
    });
  }

  async function proposerApplication(id: string, nom: string) {
    const oui = await confirmAction({
      title: `Appliquer « ${nom} » aux messages existants ?`,
      message: "Je parcours les 200 derniers messages de la boîte de réception et je range ceux qui correspondent.",
      confirmLabel: "Appliquer",
    });
    if (!oui) return;
    const reponse = await functions.call<{ examines: number; appliques: number }>("appliquer-regles", {
      regle: id,
      limite: 200,
    });
    await shell.notify({
      title:
        reponse.appliques === 0
          ? "Aucun message à ranger"
          : `${reponse.appliques} message${reponse.appliques > 1 ? "s" : ""} rangé${reponse.appliques > 1 ? "s" : ""}`,
      description: `${reponse.examines} messages examinés avec la règle « ${nom} ».`,
      tone: "success",
    });
  }

  function appliquer() {
    const champs: Array<Record<string, unknown>> = [];
    if (listeDossiers.length > 0) {
      champs.push({
        name: "dossier",
        label: "Dossier à parcourir",
        type: "select",
        optional: true,
        options: listeDossiers.map((dossier) => ({
          value: dossier.id,
          label: `${"— ".repeat(dossier.profondeur)}${dossier.nom}`,
        })),
        hint: "Sans choix, la boîte de réception est parcourue.",
      });
    }
    champs.push({
      name: "limite",
      label: "Nombre de messages",
      type: "number",
      optional: true,
      placeholder: "50",
    });
    champs.push({
      name: "simuler",
      label: "Simuler sans rien modifier",
      type: "checkbox",
      optional: true,
    });

    return openForm({
      title: "Appliquer les règles aux messages existants",
      description: "Les règles actives sont essayées sur les messages du dossier, du plus récent au plus ancien.",
      fields: champs,
      submitLabel: "Appliquer",
      onSubmit: async (valeurs) => {
        const reponse = await functions.call<{ examines: number; appliques: number }>("appliquer-regles", {
          dossier: valeurs.dossier || undefined,
          limite: Number(valeurs.limite || 50),
          simuler: valeurs.simuler === "1",
        });
        await shell.notify({
          title:
            valeurs.simuler === "1"
              ? `${reponse.examines} message${reponse.examines > 1 ? "s" : ""} examiné${reponse.examines > 1 ? "s" : ""}`
              : `${reponse.appliques} message${reponse.appliques > 1 ? "s" : ""} trié${reponse.appliques > 1 ? "s" : ""}`,
          description:
            valeurs.simuler === "1"
              ? "Aucune modification n’a été faite."
              : "Les règles actives ont été appliquées.",
          tone: "info",
        });
      },
    });
  }

  return (
    <CollectionPage<Ligne>
      label="Règles"
      load={async () => {
        const regles = await lireRegles();
        return regles.map((regle) => ({
          ...regle,
          conditionTexte: resumerConditions(regle.conditions),
          actionTexte: resumerActions(regle.actions, noms),
        }));
      }}
      deps={[dossiers.data]}
      rowKey={(regle) => regle.id}
      columns={[
        { key: "nom", header: "Règle" },
        { key: "conditionTexte", header: "Condition" },
        { key: "actionTexte", header: "Action" },
        { key: "actif", header: "Active", type: "boolean" },
      ]}
      search={{
        label: "Rechercher une règle",
        text: (regle) => `${regle.nom} ${regle.conditionTexte} ${regle.actionTexte}`,
      }}
      emptyTitle="Aucune règle"
      emptyDescription="Une règle range automatiquement les messages qui lui ressemblent."
      actions={[
        { label: "Nouvelle règle", icon: Plus, primary: true, onClick: () => formulaire() },
        {
          label: "Appliquer aux messages existants",
          icon: Play,
          disabled: !pret,
          onClick: appliquer,
        },
      ]}
      rowActions={(regle) => [
        { label: "Modifier", icon: Pencil, onClick: () => formulaire(regle) },
        {
          label: regle.actif ? "Désactiver" : "Activer",
          icon: Power,
          onClick: () =>
            functions.call("enregistrer-regle", {
              id: regle.id,
              nom: regle.nom,
              actif: !regle.actif,
              conditions: regle.conditions,
              actions: regle.actions,
            }),
          success: regle.actif ? "Règle désactivée" : "Règle activée",
        },
        {
          label: "Supprimer",
          icon: Trash2,
          danger: true,
          confirm: `Supprimer la règle « ${regle.nom} » ?`,
          success: "Règle supprimée",
          onClick: () => functions.call("supprimer-regle", { id: regle.id }),
        },
      ]}
      banner={
        comptes.error || (comptes.data && !pret) ? (
          <FeedbackBanner tone="warning">
            Vous pouvez préparer vos règles dès maintenant ; elles trieront vos messages dès qu’Outlook répondra sur
            votre PC Windows.
          </FeedbackBanner>
        ) : undefined
      }
    />
  );
}
