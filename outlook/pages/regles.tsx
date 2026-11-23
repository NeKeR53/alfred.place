import { notifyActionError, functions, shell, useAsync } from "@alfred/sdk";
import { Pencil, Play, Plus, Power, Trash2 } from "lucide-react";
import { type FormField, ListPage, useConfirm, useOpenForm } from "socle-ui";
import { lireRegles, type Regle, resumerActions, resumerConditions } from "../lib/regles";

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
  const openForm = useOpenForm();
  const confirm = useConfirm();
  const dossiers = useAsync(
    () => functions.call<{ boite: string; dossiers: Dossier[] }>("lister-dossiers", {}),
    [],
  );
  const listeDossiers = dossiers.data?.dossiers ?? [];
  const noms: Record<string, string> = {};
  for (const dossier of listeDossiers) noms[dossier.id] = dossier.nom;
  const optionsDossiers = listeDossiers.map((dossier) => ({
    id: dossier.id,
    label: `${"— ".repeat(dossier.profondeur)}${dossier.nom}`,
  }));

  const comptes = useAsync(() => functions.call<{ pret: boolean }>("comptes-outlook"), []);
  const pret = comptes.data?.pret === true;

  const regles = useAsync(
    async () =>
      (await lireRegles()).map((regle) => ({
        ...regle,
        conditionTexte: resumerConditions(regle.conditions),
        actionTexte: resumerActions(regle.actions, noms),
      })),
    [dossiers.data],
  );

  async function formulaire(regle?: Regle) {
    const champs: FormField[] = [
      { name: "nom", label: "Nom de la règle", isRequired: true, placeholder: "Factures fournisseurs" },
      {
        name: "expediteur",
        label: "Expéditeur contient",
        placeholder: "comptabilite",
        description: "Un nom ou une adresse, même partiel.",
      },
      { name: "objet", label: "Objet contient", placeholder: "facture" },
      {
        name: "sujet",
        label: "Le message parle de",
        placeholder: "factures fournisseurs",
        description: "En mots simples : je lis chaque message et je juge s’il en parle.",
      },
      { name: "marquerLu", label: "Marquer comme lu", type: "checkbox" },
    ];
    if (optionsDossiers.length > 0) {
      champs.push({
        name: "deplacerVers",
        label: "Déplacer vers",
        type: "select",
        options: optionsDossiers,
        validate: (_valeur, valeurs) =>
          valeurs.marquerLu !== true && !valeurs.deplacerVers ? "Choisissez au moins une action." : undefined,
      });
    }

    let enregistree: { id: string; nom: string } | null = null;
    const rempli = await openForm({
      title: regle ? "Modifier la règle" : "Nouvelle règle",
      description: "Chaque nouveau message est trié au relevé. Précisez au moins une condition et une action.",
      fields: champs,
      initialValues: {
        nom: regle?.nom ?? "",
        expediteur: regle?.conditions.expediteur ?? "",
        objet: regle?.conditions.objet ?? "",
        sujet: regle?.conditions.sujet ?? "",
        marquerLu: regle?.actions.marquerLu === true,
        deplacerVers: regle?.actions.deplacerVers || null,
      },
      submitLabel: regle ? "Enregistrer" : "Créer",
      onSubmit: async (valeurs) => {
        const reponse = await functions.call<{ id: string }>("enregistrer-regle", {
          id: regle?.id,
          nom: valeurs.nom,
          actif: regle?.actif ?? true,
          conditions: {
            expediteur: valeurs.expediteur ?? "",
            objet: valeurs.objet ?? "",
            sujet: valeurs.sujet ?? "",
            nonLu: regle?.conditions.nonLu === true,
          },
          actions: {
            marquerLu: valeurs.marquerLu === true,
            deplacerVers: valeurs.deplacerVers ?? "",
          },
        });
        enregistree = { id: reponse.id, nom: String(valeurs.nom) };
        shell.notify({ title: regle ? "Règle modifiée" : "Règle créée", tone: "success" });
        regles.reload();
      },
    });
    const faite = enregistree as { id: string; nom: string } | null;
    // Proposer aussitôt de ranger les messages déjà reçus.
    if (rempli && faite && pret) await proposerApplication(faite.id, faite.nom);
  }

  async function proposerApplication(id: string, nom: string) {
    const oui = await confirm({
      title: `Appliquer « ${nom} » aux messages existants ?`,
      message: "Je parcours les 200 derniers messages de la boîte de réception et je range ceux qui correspondent.",
      confirmLabel: "Appliquer",
      tone: "default",
    });
    if (!oui) return;
    const reponse = await functions.call<{ examines: number; appliques: number }>("appliquer-regles", {
      regle: id,
      limite: 200,
    });
    shell.notify({
      title:
        reponse.appliques === 0
          ? "Aucun message à ranger"
          : `${reponse.appliques} message${reponse.appliques > 1 ? "s" : ""} rangé${reponse.appliques > 1 ? "s" : ""}`,
      description: `${reponse.examines} messages examinés avec la règle « ${nom} ».`,
      tone: "success",
    });
  }

  function appliquer() {
    const champs: FormField[] = [];
    if (optionsDossiers.length > 0) {
      champs.push({
        name: "dossier",
        label: "Dossier à parcourir",
        type: "select",
        options: optionsDossiers,
        description: "Sans choix, la boîte de réception est parcourue.",
      });
    }
    champs.push({ name: "limite", label: "Nombre de messages", type: "number", placeholder: "50" });
    champs.push({ name: "simuler", label: "Simuler sans rien modifier", type: "checkbox" });

    return openForm({
      title: "Appliquer les règles aux messages existants",
      description: "Les règles actives sont essayées sur les messages du dossier, du plus récent au plus ancien.",
      fields: champs,
      submitLabel: "Appliquer",
      onSubmit: async (valeurs) => {
        const simuler = valeurs.simuler === true;
        const reponse = await functions.call<{ examines: number; appliques: number }>("appliquer-regles", {
          dossier: valeurs.dossier || undefined,
          limite: Number(valeurs.limite || 50),
          simuler,
        });
        shell.notify({
          title: simuler
            ? `${reponse.examines} message${reponse.examines > 1 ? "s" : ""} examiné${reponse.examines > 1 ? "s" : ""}`
            : `${reponse.appliques} message${reponse.appliques > 1 ? "s" : ""} trié${reponse.appliques > 1 ? "s" : ""}`,
          description: simuler ? "Aucune modification n’a été faite." : "Les règles actives ont été appliquées.",
          tone: "info",
        });
      },
    });
  }

  return (
    <ListPage<Ligne>
      title="Règles"
      description={
        comptes.error || (comptes.data && !pret)
          ? "Vous pouvez préparer vos règles dès maintenant ; elles trieront vos messages dès qu’Outlook répondra sur votre PC Windows."
          : undefined
      }
      rows={regles.data}
      columns={[
        { id: "nom", label: "Règle" },
        { id: "conditionTexte", label: "Condition" },
        { id: "actionTexte", label: "Action" },
        { id: "actif", label: "Active", type: "boolean" },
      ]}
      search={{ label: "les règles", text: (regle) => `${regle.nom} ${regle.conditionTexte} ${regle.actionTexte}` }}
      empty={{ title: "Aucune règle", description: "Une règle range automatiquement les messages qui lui ressemblent." }}
      actions={[
        { id: "nouvelle", label: "Nouvelle règle", icon: <Plus size={16} />, primary: true, onPress: () => formulaire() },
        {
          id: "appliquer",
          label: "Appliquer aux messages existants",
          icon: <Play size={16} />,
          isDisabled: !pret,
          onPress: appliquer,
        },
      ]}
      rowActions={(regle) => [
        { id: "modifier", label: "Modifier", icon: <Pencil size={16} />, onPress: () => formulaire(regle) },
        {
          id: "activer",
          label: regle.actif ? "Désactiver" : "Activer",
          icon: <Power size={16} />,
          onPress: async () => {
            await functions.call("enregistrer-regle", {
              id: regle.id,
              nom: regle.nom,
              actif: !regle.actif,
              conditions: regle.conditions,
              actions: regle.actions,
            });
            shell.notify({ title: regle.actif ? "Règle désactivée" : "Règle activée", tone: "success" });
          },
        },
        {
          id: "supprimer",
          label: "Supprimer",
          icon: <Trash2 size={16} />,
          danger: true,
          confirm: { title: `Supprimer la règle « ${regle.nom} » ?`, confirmLabel: "Supprimer" },
          onPress: () => functions.call("supprimer-regle", { id: regle.id }),
        },
      ]}
      isLoading={regles.loading}
      hasError={Boolean(regles.error)}
      onRetry={regles.reload}
      onActionError={notifyActionError}
      onActionDone={regles.reload}
    />
  );
}
