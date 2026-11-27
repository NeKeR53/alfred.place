import { db, functions, notifyActionError, shell, useAsync } from "@alfred/sdk";
import { Pencil, Play, Plus, Power, Trash2 } from "lucide-react";
import { ListPage, type StatusMap, useOpenForm } from "socle-ui";
import { ACTIONS_REGLE, decrireCriteres, lireTags, type Regle } from "../lib/regles";
import { formulaireRegle } from "../lib/regles-ui";

const ACTIONS: StatusMap = ACTIONS_REGLE;

interface Ligne extends Regle {
  resume: string;
}

/** Règles Jira : critères, question tranchée sur l’ordinateur, puis action. */
export default function ReglesPage() {
  const openForm = useOpenForm();
  const regles = useAsync(
    async () =>
      (await db.query<Regle>("SELECT * FROM atlassian_regles ORDER BY nom")).map((regle) => ({
        ...regle,
        resume: decrireCriteres(lireTags(regle.criteres)),
      })),
    [],
  );
  const saisir = async (regle?: Regle) => {
    if (await formulaireRegle(openForm, regle)) regles.reload();
  };

  return (
    <ListPage<Ligne>
      title="Règles"
      rows={regles.data}
      columns={[
        { id: "nom", label: "Règle" },
        { id: "resume", label: "Critères" },
        { id: "question", label: "Question" },
        { id: "action", label: "Action", type: "status", statuses: ACTIONS },
        { id: "automatique", label: "D’elle-même", type: "boolean", value: (regle) => regle.automatique === 1 },
      ]}
      filters={[
        {
          id: "vue",
          label: "Règles affichées",
          allLabel: "Toutes",
          options: [
            { id: "actives", label: "Actives" },
            { id: "desactivees", label: "Désactivées" },
          ],
          value: (regle) => (regle.active === 1 ? "actives" : "desactivees"),
        },
      ]}
      search={{ label: "les règles", text: (regle) => `${regle.nom} ${regle.resume} ${regle.question} ${regle.consigne}` }}
      empty={{
        title: "Aucune règle",
        description:
          "Une règle repère des tickets d’après des critères et une question, puis lance un agent avec votre consigne, vous prévient ou commente.",
      }}
      actions={[{ id: "nouvelle", label: "Nouvelle règle", icon: <Plus size={16} />, onPress: () => saisir() }]}
      rowActions={(regle) => [
        { id: "modifier", label: "Modifier", icon: <Pencil size={16} />, onPress: () => saisir(regle) },
        {
          id: "appliquer",
          label: "Appliquer maintenant",
          icon: <Play size={16} />,
          isHidden: regle.active !== 1,
          confirm: {
            title: `Appliquer la règle « ${regle.nom} » maintenant ?`,
            message:
              "Elle agit sur chaque ticket qui lui correspond et qu’elle n’a pas encore traité ; trois agents au plus sont lancés à la fois.",
            confirmLabel: "Appliquer",
          },
          onPress: async () => {
            await functions.call("appliquer-regles", { regle: regle.id });
            shell.notify({ title: "Règle appliquée", tone: "success" });
          },
        },
        {
          id: "activer",
          label: regle.active === 1 ? "Désactiver" : "Activer",
          icon: <Power size={16} />,
          onPress: () =>
            db.execute("UPDATE atlassian_regles SET active = ?, maj_le = datetime('now') WHERE id = ?", [
              regle.active === 1 ? 0 : 1,
              regle.id,
            ]),
        },
        {
          id: "supprimer",
          label: "Supprimer",
          icon: <Trash2 size={16} />,
          danger: true,
          confirm: {
            title: `Supprimer la règle « ${regle.nom} » ?`,
            message: "Ce qu’elle a déjà fait reste chez Jira.",
            confirmLabel: "Supprimer",
          },
          onPress: async () => {
            await db.execute("DELETE FROM atlassian_regles_decisions WHERE regle = ?", [regle.id]);
            await db.execute("DELETE FROM atlassian_regles_executions WHERE regle = ?", [regle.id]);
            await db.execute("DELETE FROM atlassian_regles WHERE id = ?", [regle.id]);
          },
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
