import { db, functions, shell, useAsync } from "@alfred/sdk";
import type { ReactNode } from "react";
import { EmptyState, List, Page, PageSection, Select } from "socle-ui";
import { quand } from "./affichage";
import { ETATS_PR } from "./bitbucket-vues";

export interface Compte {
  id: string;
  label: string;
  default: boolean;
}

export interface Depot {
  slug: string;
  nom: string;
  description: string;
  projet: string;
  projetNom: string;
  archive: boolean;
  brancheDefaut: string | null;
  url: string | null;
  clones?: Array<{ nom: string; url: string }>;
  public?: boolean;
}

export interface Branche {
  nom: string;
  estDefaut: boolean;
  dernierCommit: string | null;
}

export interface Pr {
  id: number;
  version: number;
  titre: string;
  description: string;
  etat: string;
  auteur: string;
  source: string;
  cible: string;
  projet: string;
  depot: string;
  cree: number | null;
  misAJour: number | null;
  commentaires: number | null;
  evaluateurs: Array<{ nom: string; statut: string }>;
  url: string | null;
}

export interface CommentairePr {
  id: string;
  auteur: string;
  texte: string;
  cree: number | null;
}

export function separerDepot(cle: string): { projet: string; depot: string } {
  const morceaux = cle.split("/");
  return { projet: morceaux[0] ?? "", depot: morceaux.slice(1).join("/") };
}

export const RISQUES: Record<string, { label: string; tone: "danger" | "warning" | "neutral" }> = {
  eleve: { label: "Risque élevé", tone: "danger" },
  moyen: { label: "Risque moyen", tone: "warning" },
  faible: { label: "Risque faible", tone: "neutral" },
};

// ——— Navigation entre les onglets ———

/** L’onglet d’où l’on a ouvert le dépôt : « Dépôts », « Favoris » ou « À traiter ». */
export type OrigineBitbucket = "bitbucket" | "favoris" | "a-traiter";

export interface Ouverture {
  instance: string;
  depot: string; // « PROJET/dépôt »
  pr?: string; // « PROJET/dépôt/numéro »
  origine: OrigineBitbucket;
  ouvertLe: number;
}

const CLE_OUVERTURE = "bitbucket.ouvert";
const CLE_COMPTE = "bitbucket.compte";

async function ecrireReglage(cle: string, valeur: string) {
  await db.execute(
    "INSERT INTO atlassian_reglages (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur",
    [cle, valeur],
  );
}

/** Ouvre un dépôt (ou une de ses pull requests) dans l’onglet « Dépôt ouvert ». */
export async function ouvrirDansDepot(ouverture: Omit<Ouverture, "ouvertLe">) {
  await ecrireReglage(CLE_OUVERTURE, JSON.stringify({ ...ouverture, ouvertLe: Date.now() }));
  await shell.navigate("atlassian/depot-ouvert");
}

export async function lireOuverture(): Promise<Ouverture | null> {
  const [ligne] = await db.query<{ valeur: string }>("SELECT valeur FROM atlassian_reglages WHERE cle = ?", [CLE_OUVERTURE]);
  if (!ligne) return null;
  try {
    const valeur = JSON.parse(ligne.valeur) as Ouverture;
    return valeur?.depot ? valeur : null;
  } catch {
    return null;
  }
}

// ——— Compte Bitbucket, commun aux onglets ———

export function useCompteBitbucket() {
  const comptes = useAsync(() => functions.call<{ comptes: Compte[] }>("comptes-bitbucket"), []);
  const choix = useAsync(
    () => db.query<{ valeur: string }>("SELECT valeur FROM atlassian_reglages WHERE cle = ?", [CLE_COMPTE]),
    [],
  );
  const liste = Array.isArray(comptes.data?.comptes) ? comptes.data.comptes : [];
  const pret = Boolean(comptes.data) && Boolean(choix.data);
  const choisi = choix.data?.[0]?.valeur ?? "";
  const compte = pret ? (liste.find((c) => c.id === choisi)?.id ?? liste[0]?.id ?? "") : "";

  async function choisir(id: string) {
    await ecrireReglage(CLE_COMPTE, id);
    choix.reload();
  }

  /** Écran à afficher tant que le compte n’est pas connu (chargement, erreur, aucun compte). */
  const attente: ReactNode =
    comptes.error || !pret ? (
      <Page state={comptes.error ? "error" : "loading"} onRetry={comptes.reload}>
        {null}
      </Page>
    ) : liste.length === 0 ? (
      <Page width="text">
        <PageSection
          title="Bitbucket"
          empty={{
            title: "Aucun compte Bitbucket relié",
            description:
              "Ouvrez Réglages, Modules, puis la fiche Atlassian pour ajouter l’adresse de votre Bitbucket et votre jeton personnel.",
          }}
        >
          {null}
        </PageSection>
      </Page>
    ) : null;

  const selecteur =
    liste.length > 1 ? (
      <Select
        label="Compte Bitbucket"
        hideLabel
        width="sm"
        value={compte}
        options={liste.map((element) => ({ id: element.id, label: element.label }))}
        onChange={(id) => id && void choisir(id)}
      />
    ) : null;

  return { compte, liste, attente, selecteur };
}

// ——— Listes ———

export function ListeDepots({
  depots,
  favoris,
  onOuvrir,
}: {
  depots: Depot[];
  favoris: Set<string>;
  onOuvrir: (cle: string) => void;
}) {
  return (
    <List
      label="Dépôts"
      selectionMode="none"
      items={depots.map((depot) => {
        const cle = `${depot.projet}/${depot.slug}`;
        return {
          id: cle,
          title: `${depot.projet} / ${depot.nom}`,
          subtitle: depot.description || depot.projetNom || undefined,
          meta: [favoris.has(cle) ? "Favori" : null, depot.projetNom].filter(Boolean).join(" · ") || undefined,
          status:
            depot.archive || depot.public !== undefined
              ? {
                  label: depot.archive ? "Archivé" : depot.public ? "Public" : "Privé",
                  tone: depot.archive ? ("warning" as const) : ("neutral" as const),
                }
              : undefined,
        };
      })}
      onAction={onOuvrir}
    />
  );
}

export function ListePrs({
  prs,
  onOuvrir,
  avecDepot,
  risques,
}: {
  prs: Pr[];
  onOuvrir: (pr: Pr) => void;
  avecDepot?: boolean;
  risques?: Map<string, { niveau: string; aVerifier: boolean }>;
}) {
  if (prs.length === 0) return <EmptyState size="compact" title="Aucune pull request ouverte" />;
  const cleDe = (pr: Pr) => `${pr.projet}/${pr.depot}/${pr.id}`;
  return (
    <List
      label="Pull requests"
      selectionMode="none"
      items={prs.map((pr) => {
        const risque = risques?.get(cleDe(pr));
        return {
          id: cleDe(pr),
          title: pr.titre,
          subtitle: `${avecDepot ? `${pr.projet}/${pr.depot} · ` : ""}#${pr.id} ouverte ${quand(pr.cree)} par ${pr.auteur} · ${pr.source} → ${pr.cible}`,
          meta:
            [
              risque ? `${RISQUES[risque.niveau]?.label ?? "Risque"}${risque.aVerifier ? " ?" : ""}` : null,
              (pr.commentaires ?? 0) > 0 ? `${pr.commentaires} commentaire${(pr.commentaires ?? 0) > 1 ? "s" : ""}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
          status: { label: ETATS_PR[pr.etat]?.label ?? pr.etat, tone: ETATS_PR[pr.etat]?.tone ?? "neutral" },
        };
      })}
      onAction={(id) => {
        const pr = prs.find((element) => cleDe(element) === id);
        if (pr) onOuvrir(pr);
      }}
    />
  );
}
