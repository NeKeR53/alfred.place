import { functions, notifyActionError, shell, useAsync } from "@alfred/sdk";
import { Pencil, Play, Plus, Power, Settings, Trash2 } from "lucide-react";
import { type FormField, ListPage, useOpenForm } from "socle-ui";
import { lirePoints, type PointEntree } from "../lib/points";
import { ecrireReglage, lireReglages } from "../lib/regles";

interface Dossier {
  id: string;
  nom: string;
  profondeur: number;
}

interface Ligne extends PointEntree {
  dossierNom: string;
}

export default function PointsEntreePage() {
  const openForm = useOpenForm();
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

  const points = useAsync(
    async () =>
      (await lirePoints()).map((point) => ({
        ...point,
        dossierNom: point.dossier ? (noms[point.dossier] ?? "Dossier introuvable") : "Reste dans la boîte",
      })),
    [dossiers.data],
  );
  const reussi = (title: string) => shell.notify({ title, tone: "success" });

  function formulaire(point?: PointEntree) {
    const champs: FormField[] = [
      { name: "nom", label: "Nom", isRequired: true, placeholder: "Factures" },
      {
        name: "description",
        label: "Ce qu’il regroupe",
        type: "textarea",
        isRequired: true,
        placeholder: "factures, avoirs, relances de paiement des fournisseurs",
        description: "En mots simples : c’est ce que je compare à chaque message pour le classer.",
      },
    ];
    if (optionsDossiers.length > 0) {
      champs.push({
        name: "dossier",
        label: "Ranger dans",
        type: "select",
        options: optionsDossiers,
        description: "Sans dossier, les messages restent dans la boîte et se retrouvent par le filtre.",
      });
    }
    return openForm({
      title: point ? "Modifier le point d’entrée" : "Nouveau point d’entrée",
      description: "Chaque nouveau message est classé dans un seul point d’entrée, sur votre ordinateur.",
      fields: champs,
      initialValues: { nom: point?.nom ?? "", description: point?.description ?? "", dossier: point?.dossier || null },
      submitLabel: point ? "Enregistrer" : "Créer",
      onSubmit: async (valeurs) => {
        await functions.call("enregistrer-point-entree", {
          id: point?.id,
          nom: valeurs.nom,
          description: valeurs.description,
          dossier: valeurs.dossier ?? "",
        });
        reussi(point ? "Point d’entrée modifié" : "Point d’entrée créé");
        points.reload();
      },
    });
  }

  async function reglerTri() {
    const valeurs = await lireReglages();
    const champs: FormField[] = [
      { name: "tri_points", label: "Trier chaque nouveau message au relevé", type: "checkbox" },
    ];
    if (optionsDossiers.length > 0) {
      champs.push({
        name: "dossier_douteux",
        label: "Mettre les cas douteux dans",
        type: "select",
        options: optionsDossiers,
        description: "Sans dossier, ils restent dans la boîte, sous le filtre « À trier ».",
      });
    }
    return openForm({
      title: "Réglages du tri",
      description: "Quand je ne suis pas assez sûr, je laisse le message de côté pour que vous tranchiez.",
      fields: champs,
      initialValues: { tri_points: valeurs.tri_points !== "0", dossier_douteux: valeurs.dossier_douteux || null },
      submitLabel: "Enregistrer",
      onSubmit: async (saisie) => {
        await ecrireReglage("tri_points", saisie.tri_points === true ? "1" : "0");
        await ecrireReglage("dossier_douteux", String(saisie.dossier_douteux ?? ""));
      },
    });
  }

  function trierExistants() {
    return openForm({
      title: "Trier les messages existants",
      description: "Je classe les derniers messages de la boîte de réception et je range ceux dont je suis sûr.",
      fields: [
        { name: "limite", label: "Nombre de messages", type: "number", placeholder: "50", max: 200 },
        { name: "simuler", label: "Simuler sans rien déplacer", type: "checkbox" },
      ],
      initialValues: { limite: 50, simuler: true },
      submitLabel: "Trier",
      onSubmit: async (valeurs) => {
        const simuler = valeurs.simuler === true;
        const reponse = await functions.call<{ examines: number; ranges: number; douteux: number }>(
          "trier-points-entree",
          { limite: Math.min(200, Number(valeurs.limite || 50)), simuler },
        );
        const ranges = `${reponse.ranges} message${reponse.ranges > 1 ? "s" : ""}`;
        reussi(simuler ? `${ranges} seraient rangés` : `${ranges} rangé${reponse.ranges > 1 ? "s" : ""}`);
        shell.notify({
          title: `${reponse.examines} examinés, ${reponse.douteux} à trancher par vous`,
          tone: "info",
        });
      },
    });
  }

  return (
    <ListPage<Ligne>
      title="Points d’entrée"
      rows={points.data}
      columns={[
        { id: "nom", label: "Point d’entrée" },
        { id: "description", label: "Ce qu’il regroupe" },
        { id: "dossierNom", label: "Rangé dans" },
        { id: "actif", label: "Actif", type: "boolean" },
      ]}
      search={{ label: "les points d’entrée" }}
      empty={{
        title: "Aucun point d’entrée",
        description: "Décrivez vos grandes catégories de messages : je classe chaque nouveau message dans l’une d’elles.",
      }}
      actions={[
        {
          id: "nouveau",
          label: "Nouveau point d’entrée",
          icon: <Plus size={16} />,
          primary: true,
          onPress: () => formulaire(),
        },
        {
          id: "trier",
          label: "Trier les messages existants",
          icon: <Play size={16} />,
          isDisabled: !pret,
          onPress: trierExistants,
        },
        { id: "reglages", label: "Réglages du tri", icon: <Settings size={16} />, onPress: reglerTri },
      ]}
      rowActions={(point) => [
        { id: "modifier", label: "Modifier", icon: <Pencil size={16} />, onPress: () => formulaire(point) },
        {
          id: "activer",
          label: point.actif ? "Désactiver" : "Activer",
          icon: <Power size={16} />,
          onPress: async () => {
            await functions.call("enregistrer-point-entree", {
              id: point.id,
              nom: point.nom,
              description: point.description,
              dossier: point.dossier,
              actif: !point.actif,
            });
            reussi(point.actif ? "Point d’entrée désactivé" : "Point d’entrée activé");
          },
        },
        {
          id: "supprimer",
          label: "Supprimer",
          icon: <Trash2 size={16} />,
          danger: true,
          confirm: {
            title: `Supprimer le point d’entrée « ${point.nom} » ?`,
            message: "Les messages déjà rangés restent où ils sont.",
            confirmLabel: "Supprimer",
          },
          onPress: () => functions.call("supprimer-point-entree", { id: point.id }),
        },
      ]}
      isLoading={points.loading}
      hasError={Boolean(points.error)}
      onRetry={points.reload}
      onActionError={notifyActionError}
      onActionDone={points.reload}
    />
  );
}
