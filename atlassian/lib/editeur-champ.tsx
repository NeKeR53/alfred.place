import { useEffect, useState } from "react";
import { functions } from "@alfred/sdk";
import {
  FormField,
  MultiSelectCombobox,
  SearchCombobox,
  SelectControl,
  Stack,
  Text,
  TextArea,
  TextInput,
} from "@alfred/ui";
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
export function versJira(local: string): string {
  if (!local) return "";
  const date = new Date(local);
  const decalage = -date.getTimezoneOffset();
  const abs = Math.abs(decalage);
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${local}:00.000${decalage >= 0 ? "+" : "-"}${deux(Math.floor(abs / 60))}${deux(abs % 60)}`;
}

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
  const noms = new Map(champ.options.map((option) => [option.id, option.nom]));

  // Personnes : recherche parmi celles qu’on peut assigner dans le projet.
  const [recherche, setRecherche] = useState(champ.editeur === "personne" ? champ.affichage : "");
  const [personnes, setPersonnes] = useState<Personne[]>([]);
  const [cherche, setCherche] = useState(false);
  useEffect(() => {
    if (champ.editeur !== "personne" || recherche.trim().length < 2) return;
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

  // Sprints : ceux des tableaux du projet.
  const [sprints, setSprints] = useState<Array<{ id: string; nom: string; etat: string }> | null>(null);
  useEffect(() => {
    if (champ.editeur !== "sprint") return;
    functions
      .call<{ sprints: Array<{ id: string; nom: string; etat: string }> }>("lister-sprints", { instance, projet })
      .then((reponse) => setSprints(reponse.sprints))
      .catch(() => setSprints([]));
  }, []);

  let controle;
  switch (champ.editeur) {
    case "paragraphe":
      controle = <TextArea value={texte} rows={8} onChange={(e) => setValeur(e.target.value)} />;
      break;
    case "nombre":
      controle = <TextInput value={texte} inputMode="decimal" onChange={(e) => setValeur(e.target.value)} />;
      break;
    case "date":
      controle = <TextInput type="date" value={texte} onChange={(e) => setValeur(e.target.value)} />;
      break;
    case "dateheure":
      controle = (
        <TextInput
          type="datetime-local"
          value={versLocal(texte)}
          onChange={(e) => setValeur(versJira(e.target.value))}
        />
      );
      break;
    case "choix":
      controle = (
        <SelectControl value={texte} onChange={(e) => setValeur(e.target.value)}>
          {!champ.requis && <option value="">Aucun</option>}
          {champ.options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.nom}
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
          onChange={(valeurs) => setValeur(valeurs)}
          display="all"
          placeholder="Choisir…"
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
          onChange={(valeurs) => setValeur(valeurs)}
          valueMode="custom"
          display="all"
          placeholder={champ.editeur === "personnes" ? "Identifiant, puis Entrée" : "Saisir, puis Entrée"}
        />
      );
      break;
    case "personne":
      controle = (
        <Stack gap="xs">
          <SearchCombobox<Personne>
            label={champ.nom}
            value={recherche}
            options={personnes}
            loading={cherche}
            minQueryLength={2}
            onChange={(saisie) => {
              setRecherche(saisie);
              if (!saisie) setValeur("");
            }}
            onSelect={(personne) => {
              setRecherche(personne.nom);
              setValeur(personne.id);
            }}
            getOptionKey={(personne) => personne.id}
            getOptionLabel={(personne) => (personne.email ? `${personne.nom} · ${personne.email}` : personne.nom)}
            placeholder="Tapez un nom…"
            emptyMessage="Personne ne correspond."
          />
          <Text size="meta" tone="muted">
            Videz le champ pour retirer la personne.
          </Text>
        </Stack>
      );
      break;
    case "sprint":
      controle =
        sprints === null ? (
          <Text tone="muted">Chargement des sprints…</Text>
        ) : (
          <SelectControl value={texte} onChange={(e) => setValeur(e.target.value)}>
            <option value="">Aucun sprint (backlog)</option>
            {texte && !sprints.some((s) => s.id === texte) && <option value={texte}>{champ.affichage || texte}</option>}
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {`${s.nom} · ${s.etat}`}
              </option>
            ))}
          </SelectControl>
        );
      break;
    default:
      controle = <TextInput value={texte} onChange={(e) => setValeur(e.target.value)} />;
  }

  return (
    <FormField label={champ.nom} hint={champ.requis ? "Champ obligatoire." : undefined}>
      {controle}
    </FormField>
  );
}
