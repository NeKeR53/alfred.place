import { Text } from "@alfred/kit";
import { functions, shell } from "@alfred/sdk";
import { useEffect, useState } from "react";
import { ComboBox, InlineEdit, Select } from "socle-ui";
import { versJira, versLocal } from "./editeur-champ";
import type { ChampTicket } from "./jira-champs";

interface Personne {
  id: string;
  nom: string;
  email: string;
}

type Valeur = string | string[];

const memes = (a: Valeur, b: Valeur) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Un champ de ticket modifiable sur place : une liste, une recherche de personne ou une zone de saisie.
 * Choisir une valeur l’enregistre aussitôt dans Jira ; un texte s’enregistre en quittant le champ (ou avec Entrée).
 */
export function ChampDirect({
  champ,
  instance,
  cle,
  projet,
  apresEnregistrement,
}: {
  champ: ChampTicket;
  instance?: string;
  cle: string;
  projet: string;
  apresEnregistrement: () => void;
}) {
  const [valeur, setValeur] = useState<Valeur>(champ.valeur);
  const [enregistre, setEnregistre] = useState<Valeur>(champ.valeur);
  const [enCours, setEnCours] = useState(false);
  useEffect(() => {
    setValeur(champ.valeur);
    setEnregistre(champ.valeur);
  }, [JSON.stringify(champ.valeur)]);

  async function enregistrer(suivante: Valeur) {
    setValeur(suivante);
    if (memes(suivante, enregistre)) return;
    setEnCours(true);
    try {
      await functions.call("modifier-champ", { instance, cle, champ: champ.id, valeur: suivante });
      setEnregistre(suivante);
      apresEnregistrement();
    } catch (erreur) {
      setValeur(enregistre);
      void shell.notify({
        title: `« ${champ.nom} » n’a pas été modifié`,
        description: (erreur as Error).message,
        tone: "error",
      });
    } finally {
      setEnCours(false);
    }
  }

  const texte = Array.isArray(valeur) ? (valeur[0] ?? "") : valeur;
  const liste = Array.isArray(valeur) ? valeur : valeur ? [valeur] : [];
  const libelle = champ.requis ? `${champ.nom} (obligatoire)` : champ.nom;

  // Sprints du projet, chargés au premier affichage du champ.
  const [sprints, setSprints] = useState<Array<{ id: string; nom: string; etat: string }> | null>(null);
  useEffect(() => {
    if (champ.editeur !== "sprint" || sprints) return;
    functions
      .call<{ sprints: Array<{ id: string; nom: string; etat: string }> }>("lister-sprints", { instance, projet })
      .then((reponse) => setSprints(reponse.sprints))
      .catch(() => setSprints([]));
  }, []);

  /** Un texte modifié sur place : une promesse rejetée garde la saisie ouverte. */
  const surPlace = (vers: (saisie: string) => string = (saisie) => saisie) => async (saisie: string) => {
    const suivante = vers(saisie);
    setValeur(suivante);
    if (memes(suivante, enregistre)) return;
    try {
      await functions.call("modifier-champ", { instance, cle, champ: champ.id, valeur: suivante });
    } catch (erreur) {
      void shell.notify({
        title: `« ${champ.nom} » n’a pas été modifié`,
        description: (erreur as Error).message,
        tone: "error",
      });
      throw erreur;
    }
    setEnregistre(suivante);
    apresEnregistrement();
  };

  switch (champ.editeur) {
    case "lecture":
      return <Text>{champ.affichage || "—"}</Text>;
    case "choix":
      return (
        <Select
          label={libelle}
          hideLabel
          isDisabled={enCours}
          value={texte}
          options={[
            ...(!champ.requis || !texte ? [{ id: "", label: "Aucun" }] : []),
            ...champ.options.map((option) => ({ id: option.id, label: option.nom })),
          ]}
          onChange={(id) => void enregistrer(id ?? "")}
        />
      );
    case "sprint":
      return (
        <Select
          label={libelle}
          hideLabel
          isDisabled={enCours || sprints === null}
          value={texte}
          options={[
            { id: "", label: "Aucun sprint (backlog)" },
            ...(texte && !(sprints ?? []).some((sprint) => sprint.id === texte)
              ? [{ id: texte, label: champ.affichage || texte }]
              : []),
            ...(sprints ?? []).map((sprint) => ({ id: sprint.id, label: `${sprint.nom} · ${sprint.etat}` })),
          ]}
          onChange={(id) => void enregistrer(id ?? "")}
        />
      );
    case "choixMultiple":
      return (
        <ComboBox
          label={libelle}
          hideLabel
          selectionMode="multiple"
          isDisabled={enCours}
          items={champ.options.map((option) => ({ id: option.id, label: option.nom }))}
          value={liste}
          onChange={(valeurs) => void enregistrer(valeurs)}
          placeholder="Aucun"
        />
      );
    case "etiquettes":
    case "personnes":
      return (
        <ComboBox
          label={libelle}
          hideLabel
          selectionMode="multiple"
          isDisabled={enCours}
          items={liste.map((id) => ({ id, label: id }))}
          allowsCustomValue
          onCreate={(saisie) => ({ id: saisie.trim(), label: saisie.trim() })}
          value={liste}
          onChange={(valeurs) => void enregistrer(valeurs)}
          placeholder="Ajouter…"
        />
      );
    case "personne":
      return (
        <ComboBox
          label={libelle}
          hideLabel
          isDisabled={enCours}
          loadItems={async (recherche) =>
            (
              await functions.call<{ utilisateurs: Personne[] }>("lister-assignables", { instance, projet, recherche })
            ).utilisateurs.map((personne) => ({ id: personne.id, label: personne.nom, description: personne.email || undefined }))
          }
          selectedItems={texte ? [{ id: texte, label: champ.affichage || texte }] : []}
          value={texte || null}
          onChange={(id) => {
            // Vider le champ retire la personne (sauf pour un champ obligatoire).
            if (!id && champ.requis) return;
            void enregistrer(id ?? "");
          }}
          placeholder="Non assigné"
        />
      );
    case "dateheure":
      return (
        <InlineEdit
          label={libelle}
          value={versLocal(texte).replace("T", " ")}
          placeholder="AAAA-MM-JJ HH:MM"
          isRequired={champ.requis}
          isDisabled={enCours}
          onSave={surPlace(versJira)}
        />
      );
    case "paragraphe":
      return (
        <InlineEdit
          label={libelle}
          mode="multiline"
          value={texte}
          isRequired={champ.requis}
          isDisabled={enCours}
          onSave={surPlace()}
        />
      );
    default:
      return (
        <InlineEdit
          label={libelle}
          value={texte}
          placeholder={champ.editeur === "date" ? "AAAA-MM-JJ" : "—"}
          isRequired={champ.requis}
          isDisabled={enCours}
          onSave={surPlace()}
        />
      );
  }
}
