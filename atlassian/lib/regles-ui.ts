import { db, shell } from "@alfred/sdk";
import type { OpenFormFunction } from "socle-ui";
import { ACTIONS_REGLE, lireTags, tagsDepuisTexte, type Regle } from "./regles";

/**
 * Formulaire d’une règle : ses critères (au format de la recherche de la liste), une question facultative
 * que je tranche sur l’ordinateur, et l’action qui suit.
 */
export function formulaireRegle(openForm: OpenFormFunction, regle?: Partial<Regle> & { criteres?: string }) {
  const tags = lireTags(regle?.criteres ?? "[]");
  return openForm({
    title: regle?.id ? "Modifier la règle" : "Nouvelle règle",
    description: "Quand un ticket remplit les critères et que la réponse à la question est oui, je fais l’action choisie.",
    fields: [
      { name: "nom", label: "Nom de la règle", isRequired: true, placeholder: "Incidents de production" },
      {
        name: "criteres",
        label: "Critères",
        placeholder: "projet:ALF, priorite:Highest, type:Bug, panne",
        description: "Comme la recherche de la liste, séparés par des virgules : projet, etat, priorite, type, assigne (moi), etiquette, vue (mes, tous) et des mots. Vide : tous les tickets ouverts.",
      },
      {
        name: "question",
        label: "Question à trancher",
        placeholder: "Des utilisateurs sont-ils empêchés de travailler ?",
        description: "Une question fermée : je réponds oui ou non en lisant le ticket, sur l’ordinateur.",
      },
      {
        name: "action",
        label: "Action",
        type: "select",
        isRequired: true,
        options: Object.entries(ACTIONS_REGLE).map(([id, a]) => ({ id, label: a.label })),
      },
      {
        name: "consigne",
        label: "Consigne ou texte",
        type: "textarea",
        placeholder: "Analyse le ticket, retrouve la pull request liée et propose un correctif.",
        description: "Pour un agent : ce qu’il doit faire. Pour un commentaire : le texte publié. Pour me prévenir : un mot ajouté à la notification.",
        validate: (valeur, valeurs) =>
          (valeurs.action === "agent" || valeurs.action === "commenter") && !valeur.trim()
            ? "Écrivez la consigne de l’agent ou le texte du commentaire."
            : undefined,
      },
      { name: "automatique", label: "Appliquer d’elle-même aux tickets qui arrivent", type: "checkbox" },
    ],
    initialValues: {
      nom: regle?.nom ?? "",
      criteres: tags.join(", "),
      question: regle?.question ?? "",
      action: regle?.action ?? "agent",
      consigne: regle?.consigne ?? "",
      automatique: Boolean(regle?.automatique),
    },
    submitLabel: regle?.id ? "Enregistrer" : "Créer",
    onSubmit: async (valeurs) => {
      const v = {
        nom: String(valeurs.nom ?? ""),
        criteres: String(valeurs.criteres ?? ""),
        question: String(valeurs.question ?? ""),
        action: String(valeurs.action ?? "agent"),
        consigne: String(valeurs.consigne ?? ""),
      };
      const criteres = JSON.stringify(tagsDepuisTexte(v.criteres));
      const automatique = valeurs.automatique === true ? 1 : 0;
      shell.notify({ title: regle?.id ? "Règle enregistrée" : "Règle créée", tone: "success" });
      if (regle?.id) {
        await db.execute(
          `UPDATE atlassian_regles SET nom = ?, criteres = ?, question = ?, action = ?, consigne = ?, automatique = ?, maj_le = datetime('now')
           WHERE id = ?`,
          [v.nom.trim(), criteres, v.question.trim(), v.action, v.consigne.trim(), automatique, regle.id],
        );
        return;
      }
      await db.execute(
        "INSERT INTO atlassian_regles (id, nom, criteres, question, action, consigne, automatique) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [crypto.randomUUID(), v.nom.trim(), criteres, v.question.trim(), v.action, v.consigne.trim(), automatique],
      );
    },
  });
}
