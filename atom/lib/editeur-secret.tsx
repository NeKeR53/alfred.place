// Éditeur d’un secret OpenBao, comme celui de OneApp : portée et nom (ajout), paires clé et valeur, afficher une
// valeur, ajouter et retirer une clé. Une valeur enregistrée n’arrive jamais ici : seule sa référence scellée, que la
// coquille affiche dans sa propre boîte. Une valeur saisie part directement chez OpenBao par le connecteur.
import { Row, Stack } from "@alfred/kit";
import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { Button, Modal, IconButton, Select, Skeleton, SkeletonGroup, TextInput } from "socle-ui";
import { useEffect, useRef, useState } from "react";
import { cheminSecret, type EnvOpenBao, lireSecret } from "./secrets";
import { functions, secrets } from "./source";

export type Edition = {
  mode: "create" | "edit";
  /** Document modifié (mode `edit`). */
  chemin: string;
  /** Portées proposées à l’ajout : dossier de base de chacune. */
  portees: { id: string; libelle: string; base: string }[];
};

type Entree = { id: string; cle: string; valeur: string; ref?: string; change: boolean; visible: boolean };
let suivant = 0;
const nouvelle = (cle = "", ref?: string): Entree => ({ id: `e${(suivant += 1)}`, cle, valeur: "", ref, change: ref === undefined, visible: false });

export function EditeurSecret({
  env,
  edition,
  fermer,
  onEnregistre,
}: {
  env: EnvOpenBao;
  edition: Edition;
  fermer: () => void;
  onEnregistre: () => void;
}) {
  const [base, setBase] = useState(edition.portees[0]?.base ?? "");
  const [nom, setNom] = useState(edition.mode === "edit" ? (edition.chemin.split("/").filter(Boolean).at(-1) ?? "") : "");
  const [entrees, setEntrees] = useState<Entree[]>(edition.mode === "create" ? [nouvelle()] : []);
  const [chargement, setChargement] = useState(edition.mode === "edit");
  const [erreur, setErreur] = useState<string>();
  const [essaye, setEssaye] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreursAffichage, setErreursAffichage] = useState<Record<string, string>>({});
  const cible = edition.mode === "create" ? cheminSecret(base, nom) : edition.chemin;

  useEffect(() => {
    if (edition.mode !== "edit") return;
    let actif = true;
    lireSecret(env, edition.chemin)
      .then((secret) => {
        if (actif) setEntrees(secret.cles.map((cle) => nouvelle(cle, secret.valeurs[cle] ?? "")));
      })
      .catch((cause: unknown) => actif && setErreur((cause as Error).message || "Impossible de charger le document OpenBao."))
      .finally(() => actif && setChargement(false));
    return () => {
      actif = false;
    };
  }, [env, edition]);

  // Contrôles de OneApp : un nom, au moins une clé, des clés uniques, une valeur pour chaque clé saisie ou modifiée.
  const erreurNom = !cible || (edition.mode === "create" && !nom.trim()) ? "Saisissez un nom de secret." : undefined;
  const vues = new Set<string>();
  const erreursCles = entrees.map((entree) => {
    const cle = entree.cle.trim();
    const message = !cle ? "Saisissez une clé." : vues.has(cle) ? "Cette clé existe déjà." : undefined;
    vues.add(cle);
    return message;
  });
  const erreursValeurs = entrees.map((entree) => (entree.change && !entree.valeur ? "Saisissez une valeur." : undefined));
  const valide = !chargement && !erreurNom && entrees.length > 0 && !erreursCles.some(Boolean) && !erreursValeurs.some(Boolean);

  const enregistrer = async () => {
    setEssaye(true);
    if (!valide) throw new Error(entrees.length ? "Corrigez les champs signalés." : "Ajoutez au moins une clé.");
    setEnCours(true);
    setErreur(undefined);
    try {
      await functions.call("openbao/ecrire-secret", {
        instance: env.instance,
        chemin: cible,
        remplacer: edition.mode === "edit",
        cles: entrees.map(({ cle, valeur, change }) => (change ? { cle: cle.trim(), valeur } : { cle: cle.trim() })),
      });
      onEnregistre();
    } catch (cause) {
      setErreur((cause as Error).message || "Impossible d’enregistrer le secret OpenBao.");
      throw cause;
    } finally {
      setEnCours(false);
    }
  };
  const enregistrerEtFermer = () => enregistrer().then(fermer, () => undefined);
  const ajouter = () => setEntrees((courantes) => [...courantes, nouvelle()]);
  const changer = (id: string, modification: Partial<Entree>) =>
    setEntrees((courantes) => courantes.map((entree) => (entree.id === id ? { ...entree, ...modification } : entree)));

  // Raccourcis de OneApp : Ctrl+S enregistre, Ctrl+N ajoute une clé, Ctrl+W ferme.
  const raccourcis = useRef({ enregistrer, ajouter, fermer, chargement, enCours });
  raccourcis.current = { enregistrer, ajouter, fermer, chargement, enCours };
  useEffect(() => {
    const touche = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const r = raccourcis.current;
      const lettre = event.key.toLowerCase();
      if (lettre === "s") {
        event.preventDefault();
        if (!r.enCours) void r.enregistrer().then(r.fermer, () => undefined);
      } else if (lettre === "n") {
        event.preventDefault();
        if (!r.chargement && !r.enCours) r.ajouter();
      } else if (lettre === "w") {
        event.preventDefault();
        if (!r.enCours) r.fermer();
      }
    };
    window.addEventListener("keydown", touche, true);
    return () => window.removeEventListener("keydown", touche, true);
  }, []);

  const afficher = async (entree: Entree) => {
    setErreursAffichage(({ [entree.id]: _, ...reste }) => reste);
    if (entree.visible || entree.change) {
      changer(entree.id, { visible: !entree.visible });
      return;
    }
    // La valeur enregistrée ne vient jamais dans la page : la coquille l’affiche dans sa propre boîte.
    try {
      await secrets.reveal(entree.ref ?? "", { label: entree.cle || "la clé" });
    } catch (cause) {
      setErreursAffichage((courantes) => ({ ...courantes, [entree.id]: (cause as Error).message || "Impossible d’afficher la valeur enregistrée." }));
    }
  };

  return (
    <Modal
      isOpen
      size="lg"
      title={edition.mode === "create" ? "Ajouter un secret OpenBao" : "Modifier un secret OpenBao"}
      isBusy={enCours}
      onOpenChange={(ouverte) => {
        if (!ouverte) fermer();
      }}
      footer={
        <>
          <Button onPress={fermer}>Annuler</Button>
          <Button variant="primary" isPending={enCours} isDisabled={chargement} onPress={() => void enregistrerEtFermer()}>
            Enregistrer
          </Button>
        </>
      }
    >
    <Stack gap="md">
      {edition.mode === "create" && edition.portees.length > 1 ? (
        <Select
          label="Portée"
          isRequired
          value={base}
          isDisabled={enCours}
          options={edition.portees.map((portee) => ({ id: portee.base, label: portee.libelle }))}
          onChange={(valeur) => {
            if (valeur !== null) setBase(valeur);
          }}
        />
      ) : null}
      <TextInput
        label="Secret"
        isRequired
        value={nom}
        isDisabled={edition.mode === "edit" || enCours}
        autoFocus={edition.mode === "create"}
        error={erreur ?? (essaye ? erreurNom : undefined)}
        onChange={setNom}
      />
      {chargement ? (
        <SkeletonGroup label="Chargement du document…">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </SkeletonGroup>
      ) : (
        <Stack gap="sm">
          {entrees.map((entree, index) => (
            <Row key={entree.id} gap="sm">
              <TextInput
                label="Clé"
                isRequired
                value={entree.cle}
                isDisabled={(edition.mode === "edit" && !entree.change) || enCours}
                error={essaye ? erreursCles[index] : undefined}
                onChange={(valeur) => changer(entree.id, { cle: valeur })}
              />
              <TextInput
                label="Valeur"
                isRequired={entree.change}
                type={entree.visible ? "text" : "password"}
                value={entree.valeur}
                placeholder={!entree.change ? "••••••••" : undefined}
                isDisabled={enCours}
                autoComplete="new-password"
                autoFocus={edition.mode === "edit" && index === 0}
                error={(essaye ? erreursValeurs[index] : undefined) ?? erreursAffichage[entree.id]}
                onChange={(valeur) => changer(entree.id, { valeur, change: true })}
              />
              <IconButton
                label={`${entree.visible ? "Masquer" : "Afficher"} la valeur de ${entree.cle || "la clé"}`}
                icon={entree.visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                isSelected={entree.visible}
                isDisabled={enCours}
                onChange={() => void afficher(entree)}
              />
              <IconButton
                label={`Retirer la clé ${index + 1}`}
                icon={<Trash2 size={16} aria-hidden="true" />}
                isDisabled={enCours || entrees.length === 1}
                onPress={() => setEntrees((courantes) => courantes.filter((autre) => autre.id !== entree.id))}
              />
            </Row>
          ))}
          <Row>
            <IconButton label="Ajouter une clé" icon={<Plus size={16} aria-hidden="true" />} isDisabled={enCours} onPress={ajouter} />
          </Row>
        </Stack>
      )}
    </Stack>
    </Modal>
  );
}
