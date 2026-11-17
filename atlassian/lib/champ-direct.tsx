import { useEffect, useState } from "react";
import { functions, shell } from "@alfred/sdk";
import {
  FormField,
  MultiSelectCombobox,
  Row,
  SearchCombobox,
  SelectControl,
  Spinner,
  Text,
  TextArea,
  TextInput,
} from "@alfred/ui";
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
  const noms = new Map(champ.options.map((option) => [option.id, option.nom]));
  const valider = (e: { key: string; currentTarget: { blur: () => void } }) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

  // Recherche des personnes assignables, pendant la frappe.
  const [recherche, setRecherche] = useState(champ.editeur === "personne" ? champ.affichage : "");
  const [personnes, setPersonnes] = useState<Personne[]>([]);
  const [cherche, setCherche] = useState(false);
  useEffect(() => setRecherche(champ.editeur === "personne" ? champ.affichage : ""), [champ.affichage]);
  useEffect(() => {
    if (champ.editeur !== "personne" || recherche.trim().length < 2 || recherche === champ.affichage) return;
    const minuteur = setTimeout(() => {
      setCherche(true);
      functions
        .call<{ utilisateurs: Personne[] }>("lister-assignables", { instance, projet, recherche })
        .then((reponse) => setPersonnes(reponse.utilisateurs))
        .catch(() => setPersonnes([]))
        .finally(() => setCherche(false));
    }, 250);
    return () => clearTimeout(minuteur);
  }, [recherche]);

  // Sprints du projet, chargés au premier affichage du champ.
  const [sprints, setSprints] = useState<Array<{ id: string; nom: string; etat: string }> | null>(null);
  useEffect(() => {
    if (champ.editeur !== "sprint" || sprints) return;
    functions
      .call<{ sprints: Array<{ id: string; nom: string; etat: string }> }>("lister-sprints", { instance, projet })
      .then((reponse) => setSprints(reponse.sprints))
      .catch(() => setSprints([]));
  }, []);

  let controle;
  switch (champ.editeur) {
    case "lecture":
      controle = <Text>{champ.affichage || "—"}</Text>;
      break;
    case "choix":
      controle = (
        <SelectControl aria-label={champ.nom} value={texte} disabled={enCours} onChange={(e) => void enregistrer(e.target.value)}>
          {(!champ.requis || !texte) && <option value="">Aucun</option>}
          {champ.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.nom}
            </option>
          ))}
        </SelectControl>
      );
      break;
    case "sprint":
      controle = (
        <SelectControl aria-label={champ.nom} value={texte} disabled={enCours || sprints === null} onChange={(e) => void enregistrer(e.target.value)}>
          <option value="">Aucun sprint (backlog)</option>
          {texte && !(sprints ?? []).some((s) => s.id === texte) && <option value={texte}>{champ.affichage || texte}</option>}
          {(sprints ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {`${s.nom} · ${s.etat}`}
            </option>
          ))}
        </SelectControl>
      );
      break;
    case "choixMultiple":
      controle = (
        <MultiSelectCombobox
          label={champ.nom}
          values={liste}
          options={champ.options.map((option) => option.id)}
          formatOption={(id) => noms.get(id) ?? id}
          onChange={(valeurs) => void enregistrer(valeurs)}
          display="all"
          placeholder="Aucun"
        />
      );
      break;
    case "etiquettes":
    case "personnes":
      controle = (
        <MultiSelectCombobox
          label={champ.nom}
          values={liste}
          options={liste}
          onChange={(valeurs) => void enregistrer(valeurs)}
          valueMode="custom"
          display="all"
          placeholder="Ajouter…"
        />
      );
      break;
    case "personne":
      controle = (
        <Row gap="xs">
          <SearchCombobox<Personne>
            label={champ.nom}
            value={recherche}
            options={personnes}
            loading={cherche}
            minQueryLength={2}
            disabled={enCours}
            onChange={(saisie) => {
              setRecherche(saisie);
              // Vider le champ retire la personne (sauf pour un champ obligatoire).
              if (!saisie && texte && !champ.requis) void enregistrer("");
            }}
            onSelect={(personne) => {
              setRecherche(personne.nom);
              void enregistrer(personne.id);
            }}
            getOptionKey={(personne) => personne.id}
            getOptionLabel={(personne) => (personne.email ? `${personne.nom} · ${personne.email}` : personne.nom)}
            placeholder="Non assigné"
            emptyMessage="Personne ne correspond."
          />
        </Row>
      );
      break;
    case "date":
      controle = (
        <TextInput type="date" aria-label={champ.nom} value={texte} disabled={enCours} onChange={(e) => void enregistrer(e.target.value)} />
      );
      break;
    case "dateheure":
      controle = (
        <TextInput
          type="datetime-local"
          aria-label={champ.nom}
          value={versLocal(texte)}
          disabled={enCours}
          onChange={(e) => setValeur(versJira(e.target.value))}
          onBlur={() => void enregistrer(valeur)}
        />
      );
      break;
    case "paragraphe":
      controle = (
        <TextArea
          aria-label={champ.nom}
          value={texte}
          rows={3}
          disabled={enCours}
          onChange={(e) => setValeur(e.target.value)}
          onBlur={() => void enregistrer(valeur)}
        />
      );
      break;
    default:
      controle = (
        <TextInput
          aria-label={champ.nom}
          value={texte}
          inputMode={champ.editeur === "nombre" ? "decimal" : undefined}
          placeholder="—"
          disabled={enCours}
          onChange={(e) => setValeur(e.target.value)}
          onBlur={() => void enregistrer(valeur)}
          onKeyDown={valider}
        />
      );
  }

  return (
    <FormField label={champ.requis ? `${champ.nom} *` : champ.nom}>
      <Row gap="xs">
        {controle}
        {enCours && <Spinner label="Enregistrement…" />}
      </Row>
    </FormField>
  );
}
