import { Stack, Text } from "@alfred/kit";
import { notifyActionError, shell, useAsync } from "@alfred/sdk";
import { ArrowDown, ArrowUp, Ellipsis, Link, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { List, DropdownMenu, Page, PageSection, Select, TextInput, useConfirm, useOpenForm } from "socle-ui";
import { formulaireProfil, lireProfils, type Profil } from "../lib/acces";
import {
  type Comptes,
  type Environnement,
  formulaireComptes,
  formulaireEnvironnement,
  lireComptes,
  lireEnvironnements,
  NATURES,
  OUTILS_ORDRE,
  reordonner,
  supprimer,
} from "../lib/environnements";
import { comptesJira, ecrireReglage, lireReglages, projetsSuivis } from "../lib/reglages";
import { db, enDemo } from "../lib/source";

type Valeurs = {
  environnements: Environnement[];
  comptes: Comptes;
  profils: Profil[];
  reglages: Record<string, string>;
  jira: { id: string; label: string }[];
  demo: boolean;
};

/** Choix « Compte par défaut » du compte Jira. */
const COMPTE_DEFAUT = "__defaut__";

async function charger(): Promise<Valeurs> {
  const [comptes, profils, reglages, jira, demo] = await Promise.all([lireComptes(), lireProfils(), lireReglages(), comptesJira(), enDemo()]);
  return { environnements: await lireEnvironnements(comptes), comptes, profils, reglages, jira, demo };
}

/** Champ texte qui enregistre à la sortie, comme un réglage immédiat. */
function ReglageTexte({
  label,
  description,
  placeholder,
  valeur,
  enregistrer,
}: {
  label: string;
  description: string;
  placeholder: string;
  valeur: string;
  enregistrer: (valeur: string) => Promise<unknown>;
}) {
  const [texte, setTexte] = useState(valeur);
  useEffect(() => setTexte(valeur), [valeur]);
  return (
    <TextInput
      label={label}
      width="lg"
      description={description}
      placeholder={placeholder}
      value={texte}
      onChange={setTexte}
      onBlur={() => {
        if (texte !== valeur) void enregistrer(texte);
      }}
    />
  );
}

export default function ReglagesAtom() {
  // La page se relit après chaque formulaire (création, modification, suppression).
  const lecture = useAsync(charger, []);
  const valeurs = lecture.data;
  const openForm = useOpenForm();
  const confirm = useConfirm();
  const recharger = lecture.reload;
  const apres = (ouvert: Promise<unknown>) => ouvert.then((fait) => fait && recharger());
  const echec = (libelle: string) => (erreur: unknown) => notifyActionError({ label: libelle }, erreur);
  const enregistrer = (cle: string, valeur: string) => ecrireReglage(cle, valeur).then(recharger, echec("Enregistrer le réglage"));

  const deplacer = async (environnements: Environnement[], id: string, sens: -1 | 1) => {
    const ids = environnements.map((env) => env.id);
    const index = ids.indexOf(id);
    const cible = index + sens;
    if (index < 0 || cible < 0 || cible >= ids.length) return;
    [ids[index], ids[cible]] = [ids[cible], ids[index]];
    await reordonner(ids).then(recharger, echec("Déplacer l’environnement"));
  };

  const supprimerEnvironnement = async (env: Environnement) => {
    const action = supprimer(env, recharger);
    const question = typeof action.confirm === "object" ? action.confirm : { title: action.confirm ?? action.label };
    await confirm({
      title: question.title,
      ...(question.message ? { message: question.message } : {}),
      confirmLabel: question.confirmLabel ?? "Supprimer",
      onConfirm: () => Promise.resolve(action.onPress()).then(() => undefined),
    });
  };

  const supprimerProfil = (item: Profil) =>
    confirm({
      title: `Supprimer le profil « ${item.nom} » ?`,
      message: "Les personnes qui l’avaient ne l’ont plus ; leurs comptes ne changent pas.",
      confirmLabel: "Supprimer",
      onConfirm: async () => {
        await db.execute("DELETE FROM atom_profils WHERE id = ?", [item.id]);
        void shell.notify({ title: "Profil supprimé", tone: "success" });
        recharger();
      },
    });

  const environnements = valeurs?.environnements ?? [];
  const profils = valeurs?.profils ?? [];
  const parId = new Map(environnements.map((env) => [env.id, env]));
  const profilParId = new Map(profils.map((item) => [item.id, item]));

  return (
    <Page state={lecture.error ? "error" : !valeurs ? "loading" : "ready"} onRetry={recharger}>
      <PageSection
        title="Environnements"
        description="Une étape de livraison par environnement, reliée à son Portainer et, si besoin, à OpenBao, Keycloak et Grafana."
        actions={[
          {
            id: "nouvel-environnement",
            label: "Nouvel environnement",
            icon: <Plus size={16} />,
            primary: true,
            onPress: () => apres(openForm(formulaireEnvironnement(environnements))),
          },
        ]}
        {...(environnements.length ? {} : { empty: { title: "Aucun environnement", description: "Ajoutez la première étape de livraison." } })}
      >
        <List
          label="Environnements"
          selectionMode="none"
          items={environnements.map((env) => ({
            id: env.id,
            title: env.nom,
            subtitle: [
              NATURES[env.nature]?.label ?? env.nature,
              OUTILS_ORDRE.map(({ id, label }) => (env.instances[id] ? `✓ ${label}` : label)).join(" "),
            ].join(" · "),
            meta: env.code,
            status: { label: `${env.rattachements} outils rattachés`, tone: env.rattachements ? "success" : "neutral" },
          }))}
          onAction={(id) => {
            const env = parId.get(id);
            if (env) void apres(openForm(formulaireEnvironnement(environnements, env)));
          }}
          itemActions={(item) => {
            const env = parId.get(item.id);
            if (!env || !valeurs) return [];
            const index = environnements.indexOf(env);
            return [
              {
                icon: <Link size={16} />,
                label: `Choisir les comptes de ${env.nom}`,
                onPress: () => void apres(openForm(formulaireComptes(env, valeurs.comptes))),
              },
              {
                icon: <Ellipsis size={16} />,
                label: `Plus d’actions sur ${env.nom}`,
                menu: [
                  <DropdownMenu.Item
                    key="modifier"
                    label="Modifier"
                    icon={<Pencil size={16} />}
                    onAction={() => void apres(openForm(formulaireEnvironnement(environnements, env)))}
                  />,
                  <DropdownMenu.Item
                    key="monter"
                    label="Monter"
                    icon={<ArrowUp size={16} />}
                    isDisabled={index === 0}
                    onAction={() => void deplacer(environnements, env.id, -1)}
                  />,
                  <DropdownMenu.Item
                    key="descendre"
                    label="Descendre"
                    icon={<ArrowDown size={16} />}
                    isDisabled={index === environnements.length - 1}
                    onAction={() => void deplacer(environnements, env.id, 1)}
                  />,
                  <DropdownMenu.Separator key="separateur" />,
                  <DropdownMenu.Item
                    key="supprimer"
                    label="Supprimer"
                    icon={<Trash2 size={16} />}
                    danger
                    onAction={() => void supprimerEnvironnement(env)}
                  />,
                ],
              },
            ];
          }}
        />
      </PageSection>
      <PageSection
        title="Profils"
        description="Groupes Keycloak et équipes Grafana, définis une fois pour tous les environnements."
        actions={[
          { id: "nouveau-profil", label: "Nouveau profil", icon: <Plus size={16} />, primary: true, onPress: () => apres(openForm(formulaireProfil())) },
        ]}
        {...(profils.length
          ? {}
          : { empty: { title: "Aucun profil", description: "Créez un profil, par exemple « Développeur » avec le groupe /ATOM/Développeurs." } })}
      >
        <List
          label="Profils"
          selectionMode="none"
          items={profils.map((item) => ({
            id: item.id,
            title: item.nom,
            subtitle: [
              item.description,
              `${item.groupes.length} groupe${item.groupes.length > 1 ? "s" : ""} Keycloak · ${item.equipes.length} équipe${item.equipes.length > 1 ? "s" : ""} Grafana`,
            ]
              .filter(Boolean)
              .join(" · "),
          }))}
          onAction={(id) => {
            const item = profilParId.get(id);
            if (item) void apres(openForm(formulaireProfil(item)));
          }}
          itemActions={(ligne) => {
            const item = profilParId.get(ligne.id);
            if (!item) return [];
            return [
              { icon: <Pencil size={16} />, label: `Modifier ${item.nom}`, onPress: () => void apres(openForm(formulaireProfil(item))) },
              { icon: <Trash2 size={16} />, label: `Supprimer ${item.nom}`, onPress: () => void supprimerProfil(item) },
            ];
          }}
        />
      </PageSection>
      <PageSection title="Projet" description="Les tickets Jira que montre la page Projet.">
        <Stack gap="md">
          <Select
            label="Compte Jira"
            isRequired
            width="md"
            description={valeurs?.jira.length ? "Le Jira où vivent les tickets du projet." : "Aucun compte Jira : ajoutez-en un dans Modules, Atlassian."}
            value={valeurs?.reglages["jira.compte"] || COMPTE_DEFAUT}
            options={[{ id: COMPTE_DEFAUT, label: "Compte par défaut" }, ...(valeurs?.jira ?? []).map((compte) => ({ id: compte.id, label: compte.label }))]}
            onChange={(id) => void enregistrer("jira.compte", id === COMPTE_DEFAUT || id === null ? "" : id)}
          />
          <ReglageTexte
            label="Projets Jira"
            description="Clés des projets suivis, séparées par des virgules. Vide : tous les tickets ouverts."
            placeholder="ATOM, SUP"
            valeur={projetsSuivis(valeurs?.reglages["jira.projets"]).join(", ")}
            enregistrer={(valeur) => enregistrer("jira.projets", projetsSuivis(valeur).join(","))}
          />
        </Stack>
      </PageSection>
      <PageSection title="Secrets" description="L’ordre des composants dans la page Secrets.">
        <ReglageTexte
          label="Ordre des composants"
          description="Noms des dossiers de secrets, séparés par des virgules. Les autres suivent, par ordre alphabétique."
          placeholder="web, api, batch"
          valeur={projetsSuivis(valeurs?.reglages["secrets.ordre"])
            .map((nom) => nom.toLowerCase())
            .join(", ")}
          enregistrer={(valeur) =>
            enregistrer(
              "secrets.ordre",
              projetsSuivis(valeur)
                .map((nom) => nom.toLowerCase())
                .join(","),
            )
          }
        />
      </PageSection>
      <PageSection title="Démonstration" description="Des données fictives pour voir Accès, Secrets, Usine et Projet sans aucun compte.">
        <Stack gap="xs">
          <Text weight="strong">{`Données de démonstration : ${valeurs?.demo ? "actives" : "inactives"}`}</Text>
          <Text tone="muted">
            {valeurs?.demo
              ? "Fictives, rien n’est lu ni modifié chez les services. Pour les quitter : pastille « Exemple » de la barre du haut."
              : "Pour les voir : interrupteur « Données d’exemple » de Réglages, Modules, Atom."}
          </Text>
        </Stack>
      </PageSection>
    </Page>
  );
}
