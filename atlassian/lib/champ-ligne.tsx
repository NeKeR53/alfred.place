import { functions, matchesSearch, notifyActionError, useAsync } from "@alfred/sdk";
import { ChevronDown, Pencil } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { type ComboBoxItem, DropdownMenu, InlineEdit, PropertyRow, useOpenForm } from "socle-ui";
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

export interface Choix {
  id: string;
  label: string;
}

type Valeur = string | string[];
const AUCUN = "__aucun__";

const MULTIPLES = new Set(["choixMultiple", "personnes"]);
const MENUS = new Set(["choix", "choixMultiple", "sprint"]);

/** Personnes assignables et sprints du projet, lus une fois pour tout le panneau. */
export function useListesDuPanneau(instance: string | undefined, projet: string, champs: readonly ChampTicket[]) {
  const sprints = champs.some((c) => c.modifiable && c.editeur === "sprint");
  const listes = useAsync(async () => {
    const [p, s] = await Promise.all([
      Promise.resolve({ utilisateurs: [] as Personne[] }),
      sprints && projet
        ? functions.call<{ sprints: Sprint[] }>("lister-sprints", { instance, projet })
        : Promise.resolve({ sprints: [] as Sprint[] }),
    ]);
    return {
      personnes: p.utilisateurs.map((u) => ({ id: u.id, label: u.nom })),
      sprints: s.sprints.map((sprint) => ({ id: sprint.id, label: `${sprint.nom} · ${sprint.etat}` })),
    };
  }, [instance, projet, sprints]);
  return listes.data ?? { personnes: [] as Choix[], sprints: [] as Choix[] };
}

function verifier(champ: ChampTicket) {
  return (saisie: string): string | null => {
    const v = saisie.trim();
    if (!v) return null;
    if (champ.editeur === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return "Saisissez une date au format AAAA-MM-JJ.";
    if (champ.editeur === "dateheure" && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v)) return "Saisissez une date et une heure au format AAAA-MM-JJ HH:MM.";
    if (champ.editeur === "nombre" && !Number.isFinite(Number(v.replace(",", ".")))) return "Saisissez un nombre.";
    return null;
  };
}

function texteDeDepart(champ: ChampTicket): string {
  const brut = Array.isArray(champ.valeur) ? champ.valeur.join(", ") : champ.valeur ?? "";
  if (champ.editeur === "dateheure") return brut ? versLocal(brut).replace("T", " ") : "";
  return brut;
}

/** Une ligne du panneau : choix dans un menu ouvert d’un clic, texte modifiable sur place. */
export function LigneChamp({
  champ,
  listes,
  instance,
  projet,
  enregistrer,
}: {
  champ: ChampTicket;
  listes: { personnes: Choix[]; sprints: Choix[] };
  instance?: string;
  projet: string;
  enregistrer: (champ: string, valeur: Valeur) => Promise<void>;
}) {
  const [affiche, setAffiche] = useState<string | null>(null);
  useEffect(() => setAffiche(null), [champ.affichage]);
  const valeurTexte = affiche ?? champ.affichage;

  if (!champ.modifiable || champ.editeur === "lecture") {
    return <PropertyRow id={champ.id} label={champ.nom} value={champ.affichage || undefined} />;
  }

  if (champ.editeur === "personne" || champ.editeur === "personnes") {
    return <LignePersonne champ={champ} instance={instance} projet={projet} enregistrer={enregistrer} />;
  }

  if (!MENUS.has(champ.editeur)) {
    const dateheure = champ.editeur === "dateheure";
    const etiquettes = champ.editeur === "etiquettes";
    return (
      <PropertyRow
        id={champ.id}
        label={champ.nom}
        value={
          <InlineEdit
            label={champ.nom}
            value={texteDeDepart(champ)}
            mode={champ.editeur === "paragraphe" ? "multiline" : "line"}
            isRequired={champ.requis}
            placeholder={
              champ.editeur === "date"
                ? "AAAA-MM-JJ"
                : dateheure
                  ? "AAAA-MM-JJ HH:MM"
                  : etiquettes
                    ? "étiquette, autre étiquette"
                    : "Ajouter…"
            }
            validate={verifier(champ)}
            onSave={async (saisie) => {
              const texte = saisie.trim();
              const valeur: Valeur = etiquettes
                ? texte.split(/[,\s]+/).filter(Boolean)
                : dateheure
                  ? versJira(texte)
                  : texte;
              await enregistrer(champ.id, valeur);
            }}
          />
        }
      />
    );
  }

  const multiple = MULTIPLES.has(champ.editeur);
  const actuels = Array.isArray(champ.valeur) ? champ.valeur : champ.valeur ? [champ.valeur] : [];
  const proposes: Choix[] =
    champ.editeur === "sprint"
      ? listes.sprints
      : champ.options.map((o) => ({ id: o.id, label: o.nom }));
  // Une valeur actuelle absente des propositions (personne hors des 30 premières) reste cochée.
  const noms = champ.affichage.split(", ");
  const manquants = actuels
    .filter((id) => !proposes.some((p) => p.id === id))
    .map((id, index) => ({ id, label: (multiple ? noms[index] : champ.affichage) || id }));
  const choix = [...manquants, ...proposes];
  const aucun = {
    id: AUCUN,
    label: champ.editeur === "sprint" ? "Aucun sprint (backlog)" : "Aucun",
  };
  const items = !multiple && !champ.requis ? [aucun, ...choix] : choix;
  const selection = multiple ? actuels : [actuels[0] ?? AUCUN];

  async function choisir(cles: Set<unknown>) {
    const ids = [...cles].map(String);
    const valeur: Valeur = multiple ? ids : ids[0] === AUCUN ? "" : ids[0] ?? "";
    if (JSON.stringify(valeur) === JSON.stringify(multiple ? actuels : actuels[0] ?? "")) return;
    if (champ.requis && valeur.length === 0) return;
    const libelles = (multiple ? ids : [ids[0]]).map((id) => items.find((i) => i.id === id)?.label ?? "");
    const precedent = affiche;
    setAffiche(valeur.length === 0 ? "" : libelles.filter(Boolean).join(", "));
    try {
      await enregistrer(champ.id, valeur);
    } catch (erreur) {
      setAffiche(precedent);
      notifyActionError({ label: `Modifier « ${champ.nom} »` }, erreur);
    }
  }

  return (
    <PropertyRow
      id={champ.id}
      label={champ.nom}
      value={valeurTexte || undefined}
      action={{
        type: "icon",
        icon: <ChevronDown size={16} />,
        label: `Changer « ${champ.nom} »`,
        menu: (
          <DropdownMenu.Section
            selectionMode={multiple ? "multiple" : "single"}
            selectedKeys={selection}
            onSelectionChange={(cles) => void choisir(cles)}
          >
            {items.map((item) => (
              <DropdownMenu.Item key={item.id} id={item.id} label={item.label} />
            ))}
          </DropdownMenu.Section>
        ),
      }}
    />
  );
}

/** Une personne : le nom en texte, une petite fenêtre de recherche ouverte par l’action de la ligne. */
function LignePersonne({
  champ,
  instance,
  projet,
  enregistrer,
}: {
  champ: ChampTicket;
  instance?: string;
  projet: string;
  enregistrer: (champ: string, valeur: Valeur) => Promise<void>;
}) {
  const multiple = champ.editeur === "personnes";
  const depart = (): ComboBoxItem[] => {
    const ids = Array.isArray(champ.valeur) ? champ.valeur : champ.valeur ? [champ.valeur] : [];
    const noms = champ.affichage.split(", ");
    return ids.map((id, index) => ({ id, label: (multiple ? noms[index] : champ.affichage) || id }));
  };
  const [choisis, setChoisis] = useState<ComboBoxItem[]>(depart);
  const empreinte = JSON.stringify(champ.valeur);
  useEffect(() => {
    setChoisis(depart());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empreinte, champ.affichage]);
  const connus = useRef(new Map<string, ComboBoxItem>());
  const openForm = useOpenForm();

  const sansPersonne = !multiple && !champ.requis;
  // Les personnes déjà choisies restent proposées : leur nom s’affiche dès l’ouverture.
  const chercher = useCallback(async (texte: string): Promise<ComboBoxItem[]> => {
    const { utilisateurs } = await functions.call<{ utilisateurs: Personne[] }>("lister-assignables", { instance, projet, recherche: texte });
    const trouves = utilisateurs
      .filter((p) => matchesSearch(texte, [p.nom, p.email, p.id]))
      .map((p) => ({ id: p.id, label: p.nom, description: p.email || undefined }));
    for (const item of trouves) connus.current.set(item.id, item);
    const actuels = choisis.filter((c) => !trouves.some((t) => t.id === c.id) && matchesSearch(texte, [c.label, c.id]));
    return [...actuels, ...trouves, ...(sansPersonne ? [{ id: AUCUN, label: "Non assigné" }] : [])];
  }, [instance, projet, sansPersonne, choisis]);

  async function choisir(ids: string[]) {
    const nets = ids.filter((id) => id !== AUCUN);
    const actuels = choisis.map((c) => c.id);
    if (JSON.stringify(nets) === JSON.stringify(actuels)) return;
    const precedents = choisis;
    setChoisis(nets.map((id) => connus.current.get(id) ?? choisis.find((c) => c.id === id) ?? { id, label: id }));
    try {
      await enregistrer(champ.id, multiple ? nets : nets[0] ?? "");
    } catch (cause) {
      setChoisis(precedents);
      throw cause;
    }
  }

  function ouvrir() {
    void openForm({
      title: champ.nom,
      fields: [
        multiple
          ? { type: "combobox", name: "personnes", label: champ.nom, loadItems: chercher, selectionMode: "multiple", isRequired: champ.requis }
          : { type: "combobox", name: "personnes", label: champ.nom, loadItems: chercher, isRequired: champ.requis },
      ],
      initialValues: { personnes: multiple ? choisis.map((c) => c.id) : choisis[0]?.id ?? null },
      submitLabel: "Enregistrer",
      onSubmit: async (valeurs) => {
        const brut = valeurs.personnes as string | string[] | null;
        await choisir(Array.isArray(brut) ? brut : brut ? [brut] : []);
      },
    });
  }

  return (
    <PropertyRow
      id={champ.id}
      label={champ.nom}
      value={choisis.map((c) => c.label).join(", ") || (multiple ? undefined : "Non assigné")}
      action={{
        type: "icon",
        icon: <Pencil size={16} />,
        label: `Changer « ${champ.nom} »`,
        onPress: ouvrir,
      }}
    />
  );
}

function sansAccent(texte: string): string {
  return texte.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
