import { functions } from "@alfred/sdk";
import { useState } from "react";
import { ComboBox, type ComboBoxItem, Select, TextArea, TextField } from "socle-ui";
import type { ChampTicket } from "./jira-champs";

/** Valeur en cours d’édition, lue par l’action « Enregistrer » de la modale. */
export interface Brouillon {
  valeur: string | string[] | null;
}

interface Personne {
  id: string;
  nom: string;
  email: string;
}

/** « 2026-11-17T14:30:00.000+0100 » ↔ « 2026-11-17T14:30 » (champ date et heure). */
export function versLocal(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${deux(date.getMonth() + 1)}-${deux(date.getDate())}T${deux(date.getHours())}:${deux(date.getMinutes())}`;
}
export function versJira(saisie: string): string {
  if (!saisie) return "";
  const local = saisie.trim().replace(" ", "T");
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return saisie;
  const decalage = -date.getTimezoneOffset();
  const abs = Math.abs(decalage);
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${local}:00.000${decalage >= 0 ? "+" : "-"}${deux(Math.floor(abs / 60))}${deux(abs % 60)}`;
}

/** Personnes qu’on peut assigner dans le projet, pour une recherche de deux lettres au moins. */
const chercherPersonnes = (instance: string | undefined, projet: string) => async (recherche: string) => {
  const reponse = await functions.call<{ utilisateurs: Personne[] }>("lister-assignables", { instance, projet, recherche });
  return reponse.utilisateurs.map((personne) => ({
    id: personne.id,
    label: personne.nom,
    description: personne.email || undefined,
  }));
};

/** Contrôle adapté au type d’un champ Jira : texte, liste, choix multiple, personne, sprint, date… */
export function EditeurChamp({
  champ,
  brouillon,
  instance,
  projet,
}: {
  champ: ChampTicket;
  brouillon: Brouillon;
  instance?: string;
  projet: string;
}) {
  const [valeur, setValeurLocale] = useState<string | string[]>(champ.valeur);
  const setValeur = (suivante: string | string[]) => {
    setValeurLocale(suivante);
    brouillon.valeur = suivante;
  };
  const texte = Array.isArray(valeur) ? (valeur[0] ?? "") : valeur;
  const liste = Array.isArray(valeur) ? valeur : valeur ? [valeur] : [];
  const commun = {
    label: champ.nom,
    isRequired: champ.requis,
    description: champ.requis ? "Champ obligatoire." : undefined,
  };

  // Sprints : ceux des tableaux du projet.
  const [sprints, setSprints] = useState<Array<{ id: string; nom: string; etat: string }> | null>(null);
  const [sprintsDemandes, setSprintsDemandes] = useState(false);
  if (champ.editeur === "sprint" && !sprintsDemandes) {
    setSprintsDemandes(true);
    functions
      .call<{ sprints: Array<{ id: string; nom: string; etat: string }> }>("lister-sprints", { instance, projet })
      .then((reponse) => setSprints(reponse.sprints))
      .catch(() => setSprints([]));
  }

  switch (champ.editeur) {
    case "paragraphe":
      return <TextArea {...commun} value={texte} minRows={8} onChange={setValeur} />;
    case "nombre":
      return <TextField {...commun} value={texte} onChange={setValeur} />;
    case "date":
      return <TextField {...commun} value={texte} placeholder="AAAA-MM-JJ" onChange={setValeur} />;
    case "dateheure":
      return (
        <TextField
          {...commun}
          value={versLocal(texte).replace("T", " ")}
          placeholder="AAAA-MM-JJ HH:MM"
          onChange={(saisie) => setValeur(versJira(saisie))}
        />
      );
    case "choix":
      return (
        <Select
          {...commun}
          value={texte || (champ.requis ? null : "")}
          options={[
            ...(champ.requis ? [] : [{ id: "", label: "Aucun" }]),
            ...champ.options.map((option) => ({ id: option.id, label: option.nom })),
          ]}
          onChange={(id) => setValeur(id ?? "")}
        />
      );
    case "choixMultiple":
      return (
        <ComboBox
          {...commun}
          selectionMode="multiple"
          items={champ.options.map((option) => ({ id: option.id, label: option.nom }))}
          value={liste}
          onChange={setValeur}
          placeholder="Choisir…"
        />
      );
    case "etiquettes":
    case "personnes": {
      const connus: ComboBoxItem[] = liste.map((id) => ({ id, label: id }));
      return (
        <ComboBox
          {...commun}
          selectionMode="multiple"
          items={connus}
          allowsCustomValue
          onCreate={(saisie) => ({ id: saisie.trim(), label: saisie.trim() })}
          value={liste}
          onChange={setValeur}
          placeholder={champ.editeur === "personnes" ? "Identifiant, puis Entrée" : "Saisir, puis Entrée"}
        />
      );
    }
    case "personne":
      return (
        <ComboBox
          {...commun}
          description="Tapez un nom ; videz le champ pour retirer la personne."
          loadItems={chercherPersonnes(instance, projet)}
          selectedItems={texte ? [{ id: texte, label: champ.affichage || texte }] : []}
          value={texte || null}
          onChange={(id) => setValeur(id ?? "")}
          placeholder="Tapez un nom…"
        />
      );
    case "sprint":
      return (
        <Select
          {...commun}
          isDisabled={sprints === null}
          placeholder={sprints === null ? "Chargement des sprints…" : undefined}
          value={texte}
          options={[
            { id: "", label: "Aucun sprint (backlog)" },
            ...(texte && sprints && !sprints.some((sprint) => sprint.id === texte)
              ? [{ id: texte, label: champ.affichage || texte }]
              : []),
            ...(sprints ?? []).map((sprint) => ({ id: sprint.id, label: `${sprint.nom} · ${sprint.etat}` })),
          ]}
          onChange={(id) => setValeur(id ?? "")}
        />
      );
    default:
      return <TextField {...commun} value={texte} onChange={setValeur} />;
  }
}
