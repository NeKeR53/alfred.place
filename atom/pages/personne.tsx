import { shell, usePageContext } from "@alfred/sdk";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Drawer, type DetailSection, DropdownMenu, type StatusTone } from "socle-ui";
import type { CaseAcces, LigneVue } from "../lib/acces";

type Selection = {
  cle: string;
  lignes: LigneVue[];
  profils: { id: string; nom: string }[];
  envs: { id: string; nom: string }[];
  occupe: boolean;
};

/** Valeur du choix « Sans profil ». */
const SANS_PROFIL = "__sans-profil__";

/** Profil appliqué aujourd’hui : le premier lu dans un environnement où une des personnes a un accès profilé. */
function profilActuel(lignes: readonly LigneVue[], profils: Selection["profils"]) {
  const nom = lignes
    .flatMap((l) => Object.values(l.cases))
    .filter((c) => c.etat !== "sans-profil")
    .flatMap(({ profils: noms }) => noms.split(", "))
    .find(Boolean);
  return profils.find((profil) => profil.nom === nom)?.id ?? "";
}

/** État d’une personne seule dans un environnement, en résumé de sa section. */
function etat(acces?: CaseAcces): { label: string; tone?: StatusTone } {
  if (!acces) return { label: "Aucun accès" };
  if (acces.etat === "conforme") return { label: acces.profils || "Aucun profil", tone: "success" };
  if (acces.etat === "sans-profil") return { label: "Sans profil" };
  return { label: `Écart · ${acces.profils || "aucun profil"}`, tone: "warning" };
}

/**
 * Accès d’une ou de plusieurs personnes en un seul geste (AccessPersonPanel de OneApp) : un profil, les environnements
 * où l’appliquer, puis « Appliquer… ». L’aperçu, ouvert par la page, réaligne chacune sur ce profil dans chaque
 * environnement coché (ajouts et retraits).
 */
function Formulaire({ selection }: { selection: Selection }) {
  const { lignes, profils, envs, occupe } = selection;
  const [seule] = lignes;
  const plusieurs = lignes.length > 1;
  const [profil, setProfil] = useState(() => profilActuel(lignes, profils));
  // Une présence dans un groupe ne vaut pas attribution d’un profil.
  const [cochees, setCochees] = useState(() =>
    profilActuel(lignes, profils)
      ? envs
          .filter(({ nom }) => lignes.some((l) => l.cases[nom] && l.cases[nom].etat !== "sans-profil" && Boolean(l.cases[nom].profils)))
          .map(({ id }) => id)
      : [],
  );
  const basculer = (id: string, coche: boolean) =>
    setCochees((actuelles) => (coche ? [...new Set([...actuelles, id])] : actuelles.filter((item) => item !== id)));

  const sections: DetailSection[] = [
    {
      id: "profil",
      title: "Profil",
      // Le profil se lit en texte ; il se choisit dans le menu de la ligne.
      fields: [
        {
          id: "profil",
          label: "Profil",
          value: profils.find((p) => p.id === profil)?.nom ?? "Sans profil",
          action: {
            type: "icon",
            icon: <ChevronDown size={16} />,
            label: "Changer le profil",
            menu: (
              <DropdownMenu.Section
                title="Profil"
                selectionMode="single"
                selectedKeys={[profil || SANS_PROFIL]}
                onSelectionChange={(cles) => {
                  const id = [...cles][0];
                  if (id !== undefined) setProfil(id === SANS_PROFIL ? "" : String(id));
                }}
              >
                {[...profils.map((p) => ({ id: p.id, nom: p.nom })), { id: SANS_PROFIL, nom: "Sans profil" }].map((p) => (
                  <DropdownMenu.Item key={p.id} id={p.id} label={p.nom} />
                ))}
              </DropdownMenu.Section>
            ),
          },
        },
      ],
      content: "Les groupes et équipes du profil sont rétablis, les autres accès gérés retirés.",
    },
    ...envs.map(({ id, nom }): DetailSection => {
      const cases = lignes.map((l) => l.cases[nom]);
      const presents = cases.filter(Boolean).length;
      const ecarts = cases.filter((c) => c?.etat === "ecart").length;
      const acces = cases[0];
      const detail = !plusieurs && acces && acces.etat !== "conforme" ? acces.detail : undefined;
      return {
        id: `env-${id}`,
        title: nom,
        // Plusieurs personnes : combien ont un accès ici, et combien sont en écart.
        summary: plusieurs
          ? { label: `${presents} / ${lignes.length} avec accès${ecarts ? ` · ${ecarts} en écart` : ""}`, tone: ecarts ? "warning" : "neutral" }
          : etat(acces),
        // Appliquer ici ou non : l’interrupteur de la ligne.
        fields: [
          {
            id: "appliquer",
            label: "Appliquer ici",
            value: cochees.includes(id),
            type: "boolean",
            action: { type: "switch", isSelected: cochees.includes(id), onChange: (coche) => basculer(id, coche) },
          },
          ...(detail
          ? [
              { label: "Groupes Keycloak", value: detail.groupes || "Aucun groupe" },
              { label: "Groupes manquants", value: detail.groupesManquants, hideEmpty: true },
              { label: "Groupes en trop", value: detail.groupesEnTrop, hideEmpty: true },
              { label: "Équipes Grafana", value: detail.equipes, hideEmpty: true },
              { label: "Équipes manquantes", value: detail.equipesManquantes, hideEmpty: true },
              { label: "Équipes en trop", value: detail.equipesEnTrop, hideEmpty: true },
              { label: "Équipes à la première connexion", value: detail.equipesPremiereConnexion, hideEmpty: true },
            ]
          : []),
        ],
      };
    }),
  ];

  return (
    <Drawer
      header={{
        title: plusieurs ? `${lignes.length} personnes` : seule.personne,
        subtitle: plusieurs ? lignes.map(({ personne }) => personne).join(", ") : seule.email || seule.identifiant,
        actions: [
          {
            id: "appliquer",
            label: "Appliquer…",
            icon: <Check size={16} />,
            primary: true,
            isDisabled: occupe || !cochees.length,
            onPress: () => void shell.send({ appliquer: { profil, envs: cochees } }),
          },
        ],
      }}
      sections={sections}
    />
  );
}

export default function PersonnePanneau() {
  const selection = usePageContext()?.selection as Selection | null | undefined;
  if (!selection?.lignes?.length)
    return <Drawer emptyMessage="Choisissez une personne, ou cochez-en plusieurs, pour régler leurs accès." />;
  // Une autre personne repart de son propre profil ; cocher une personne de plus garde les choix en cours.
  return <Formulaire key={selection.cle} selection={selection} />;
}
