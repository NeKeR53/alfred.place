import { functions, shell } from "@alfred/sdk";
import { ChevronDown, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { type ComboBoxItem, type DetailField, DropdownMenu, type FormField, useOpenForm } from "socle-ui";
import { versJira, versLocal } from "./editeur-champ";
import type { ChampTicket } from "./jira-champs";

interface Personne {
  id: string;
  nom: string;
  email: string;
}

interface Sprint {
  id: string;
  nom: string;
  etat: string;
}

type Valeur = string | string[];

/** Valeur choisie avant que Jira ne la relise : la valeur envoyée et son texte. */
interface Saisie {
  valeur: Valeur;
  affichage: string;
}

/** Identifiant du choix « Aucun » dans un menu (une clé vide n’est pas admise). */
const AUCUN = "__aucun__";

const memes = (a: Valeur, b: Valeur) => JSON.stringify(a) === JSON.stringify(b);
const enListe = (valeur: Valeur) => (Array.isArray(valeur) ? valeur : valeur ? [valeur] : []);
const enTexte = (valeur: Valeur) => (Array.isArray(valeur) ? (valeur[0] ?? "") : valeur);

/**
 * Lignes du panneau Détails pour les champs d’un ticket. La valeur se lit en texte ; on la modifie par l’action de
 * la ligne : un menu pour un choix, une fenêtre pour un texte, une date, une personne ou des étiquettes. Chaque
 * changement est enregistré aussitôt dans Jira ; un échec rend l’ancienne valeur et le dit.
 */
export function useLignesChamps({
  instance,
  cle,
  projet,
  champs,
  apresEnregistrement,
}: {
  instance?: string;
  cle: string;
  projet: string;
  champs: readonly ChampTicket[];
  apresEnregistrement: () => void;
}): (liste: readonly ChampTicket[]) => DetailField[] {
  const openForm = useOpenForm();
  const [saisies, setSaisies] = useState<Record<string, Saisie>>({});
  const [enCours, setEnCours] = useState<Record<string, boolean>>({});
  // Jira relu : ses valeurs remplacent celles choisies ici.
  const empreinte = JSON.stringify(champs.map((champ) => [champ.id, champ.valeur, champ.affichage]));
  useEffect(() => setSaisies({}), [cle, empreinte]);

  // Sprints du projet, lus une fois si le ticket a un champ Sprint.
  const avecSprint = champs.some((champ) => champ.editeur === "sprint" && champ.modifiable);
  const [sprints, setSprints] = useState<Sprint[] | null>(null);
  useEffect(() => {
    if (!avecSprint) return;
    let actif = true;
    setSprints(null);
    functions
      .call<{ sprints: Sprint[] }>("lister-sprints", { instance, projet })
      .then((reponse) => actif && setSprints(reponse.sprints))
      .catch(() => actif && setSprints([]));
    return () => {
      actif = false;
    };
  }, [avecSprint, instance, projet]);

  const actuelle = (champ: ChampTicket): Saisie =>
    saisies[champ.id] ?? { valeur: champ.valeur, affichage: champ.affichage };

  const signaler = (champ: ChampTicket, erreur: unknown) =>
    void shell.notify({
      title: `« ${champ.nom} » n’a pas été modifié`,
      description: (erreur as Error).message,
      tone: "error",
    });

  /** Envoie la valeur à Jira. Rend `false` après un échec : l’ancienne valeur revient. */
  async function enregistrer(champ: ChampTicket, suivante: Saisie): Promise<boolean> {
    const avant = actuelle(champ);
    if (memes(suivante.valeur, avant.valeur) || enCours[champ.id]) return true;
    setSaisies((toutes) => ({ ...toutes, [champ.id]: suivante }));
    setEnCours((tous) => ({ ...tous, [champ.id]: true }));
    try {
      await functions.call("modifier-champ", { instance, cle, champ: champ.id, valeur: suivante.valeur });
      apresEnregistrement();
      return true;
    } catch (erreur) {
      setSaisies((toutes) => ({ ...toutes, [champ.id]: avant }));
      signaler(champ, erreur);
      return false;
    } finally {
      setEnCours((tous) => ({ ...tous, [champ.id]: false }));
    }
  }

  /** Menu de choix dans l’action de la ligne : unique (le menu se ferme) ou multiple (il reste ouvert). */
  const menu = (
    champ: ChampTicket,
    choix: ReadonlyArray<{ id: string; nom: string }>,
    multiple: boolean,
    attente?: string,
  ): DetailField["action"] => {
    const { valeur } = actuelle(champ);
    const nomDe = (id: string) => choix.find((option) => option.id === id)?.nom ?? id;
    return {
      type: "icon",
      icon: <ChevronDown size={16} />,
      label: `Changer « ${champ.nom} »`,
      menu: attente ? (
        <DropdownMenu.Item label={attente} isDisabled />
      ) : (
        <DropdownMenu.Section
          title={champ.nom}
          selectionMode={multiple ? "multiple" : "single"}
          selectedKeys={multiple ? enListe(valeur) : [enTexte(valeur) || AUCUN]}
          onSelectionChange={(cles) => {
            const brutes = [...cles].map(String);
            // Choix unique : choisir la valeur déjà cochée la garde.
            if (!multiple && brutes.length === 0) return;
            const ids = brutes.filter((id) => id !== AUCUN);
            const suivante: Valeur = multiple ? ids : (ids[0] ?? "");
            void enregistrer(champ, {
              valeur: suivante,
              affichage: enListe(suivante).map(nomDe).join(", "),
            });
          }}
        >
          {[
            ...(!multiple && (!champ.requis || !enTexte(valeur)) ? [{ id: AUCUN, nom: "Aucun" }] : []),
            ...choix,
          ].map((option) => (
            <DropdownMenu.Item key={option.id} id={option.id} label={option.nom} />
          ))}
        </DropdownMenu.Section>
      ),
    };
  };

  /** Champ de la fenêtre de saisie, selon le type du champ Jira. */
  const champDeSaisie = (champ: ChampTicket, noms: Map<string, string>): FormField => {
    const { valeur, affichage } = actuelle(champ);
    const liste = enListe(valeur);
    const commun = { name: "valeur", label: champ.nom, isRequired: champ.requis };
    switch (champ.editeur) {
      case "personne":
        return {
          ...commun,
          type: "combobox",
          description: champ.requis ? undefined : "Videz le champ pour retirer la personne.",
          placeholder: "Tapez un nom…",
          loadItems: async (recherche: string): Promise<ComboBoxItem[]> =>
            (
              await functions.call<{ utilisateurs: Personne[] }>("lister-assignables", { instance, projet, recherche })
            ).utilisateurs.map((p) => {
              noms.set(p.id, p.nom);
              return { id: p.id, label: p.nom, description: p.email || undefined };
            }),
          selectedItems: liste[0] ? [{ id: liste[0], label: affichage || liste[0] }] : [],
        };
      case "personnes":
      case "etiquettes":
        return {
          ...commun,
          type: "combobox",
          selectionMode: "multiple",
          items: liste.map((id) => ({ id, label: id })),
          allowsCustomValue: true,
          onCreate: (saisie: string) => ({ id: saisie.trim(), label: saisie.trim() }),
          placeholder: champ.editeur === "personnes" ? "Identifiant, puis Entrée" : "Saisir, puis Entrée",
        };
      case "paragraphe":
        return { ...commun, type: "textarea", minRows: 6 };
      case "date":
        return { ...commun, placeholder: "AAAA-MM-JJ", validate: (v) => (!v || /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? undefined : "Saisissez une date au format AAAA-MM-JJ.") };
      case "dateheure":
        return { ...commun, placeholder: "AAAA-MM-JJ HH:MM", validate: (v) => (!v || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v.trim()) ? undefined : "Saisissez une date et une heure au format AAAA-MM-JJ HH:MM.") };
      case "nombre":
        return { ...commun, validate: (v) => (!v || Number.isFinite(Number(v.replace(",", "."))) ? undefined : "Saisissez un nombre.") };
      default:
        return commun;
    }
  };

  /** Valeur de départ de la fenêtre, et valeur envoyée à Jira après « Enregistrer ». */
  const depart = (champ: ChampTicket) => {
    const { valeur } = actuelle(champ);
    if (champ.editeur === "personne") return enListe(valeur)[0] ?? null;
    if (champ.editeur === "personnes" || champ.editeur === "etiquettes") return enListe(valeur);
    if (champ.editeur === "dateheure") return versLocal(enTexte(valeur)).replace("T", " ");
    return enTexte(valeur);
  };
  const versValeur = (champ: ChampTicket, brute: unknown): Valeur => {
    if (Array.isArray(brute)) return brute.map(String);
    const texte = brute == null ? "" : String(brute);
    return champ.editeur === "dateheure" ? versJira(texte) : texte;
  };

  /** Bouton qui ouvre la saisie du champ en fenêtre ; « Enregistrer » l’envoie aussitôt à Jira. */
  const fenetre = (champ: ChampTicket): DetailField["action"] => ({
    type: "icon",
    icon: <Pencil size={16} />,
    label: `Modifier « ${champ.nom} »`,
    onPress: () => {
      const { valeur, affichage } = actuelle(champ);
      // Noms des personnes proposées, pour montrer le nom choisi avant que Jira ne relise le ticket.
      const noms = new Map<string, string>(enListe(valeur)[0] ? [[enListe(valeur)[0], affichage || enListe(valeur)[0]]] : []);
      void openForm({
        title: `Modifier « ${champ.nom} »`,
        fields: [champDeSaisie(champ, noms)],
        initialValues: { valeur: depart(champ) },
        submitLabel: "Enregistrer",
        onSubmit: async (valeurs) => {
          const suivante = versValeur(champ, valeurs.valeur);
          // Un échec lève une erreur : la fenêtre reste ouverte et l’affiche.
          await functions.call("modifier-champ", { instance, cle, champ: champ.id, valeur: suivante });
          const texte = enTexte(suivante);
          const montre =
            champ.editeur === "personne"
              ? (noms.get(texte) ?? texte)
              : champ.editeur === "dateheure"
                ? String(valeurs.valeur ?? "")
                : enListe(suivante).join(", ");
          setSaisies((toutes) => ({ ...toutes, [champ.id]: { valeur: suivante, affichage: montre } }));
          apresEnregistrement();
        },
      });
    },
  });

  return (liste) =>
    liste.map((champ): DetailField => {
      const { valeur, affichage } = actuelle(champ);
      const texte = enTexte(valeur);
      const ligne = { id: champ.id, label: champ.nom };
      switch (champ.editeur) {
        case "lecture":
          return { ...ligne, value: affichage };
        case "choix":
          return { ...ligne, value: affichage, action: menu(champ, champ.options, false) };
        case "choixMultiple":
          return { ...ligne, value: affichage, action: menu(champ, champ.options, true) };
        case "sprint": {
          const connus = (sprints ?? []).map((sprint) => ({ id: sprint.id, nom: `${sprint.nom} · ${sprint.etat}` }));
          const choix = texte && !connus.some((sprint) => sprint.id === texte) ? [{ id: texte, nom: affichage || texte }, ...connus] : connus;
          return {
            ...ligne,
            value: affichage || "Aucun sprint (backlog)",
            action: menu(champ, choix, false, sprints === null ? "Chargement des sprints…" : undefined),
          };
        }
        default:
          // Texte, nombre, date, paragraphe, personne, étiquettes : la valeur en texte, la saisie en fenêtre.
          return {
            ...ligne,
            value: affichage,
            ...(champ.editeur === "paragraphe" ? { type: "longtext" as const } : {}),
            action: fenetre(champ),
          };
      }
    });
}
