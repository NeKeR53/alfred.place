import { Row } from "@alfred/kit";
import { db, useAsync, usePageState } from "@alfred/sdk";
import { Page, PageSection } from "socle-ui";
import { type Depot, ListeDepots, ouvrirDepot, separerDepot, useCompteBitbucket } from "../lib/bitbucket-commun";
import { useEtat } from "../lib/etat";
import { RechercheRetenue } from "../lib/recherche-retenue";

/** Onglet « Favoris » : les dépôts marqués d’une étoile. */
export default function FavorisBitbucket() {
  const { compte, attente, selecteur } = useCompteBitbucket();
  const [recherche, setRecherche] = usePageState<string>("bitbucket.favoris.recherche", "");
  const plier = (texte: string) => texte.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("fr");
  const mots = plier(recherche).split(/\s+/).filter(Boolean);
  const correspond = (...textes: string[]) => {
    const texte = plier(textes.join(" "));
    return mots.every((mot) => texte.includes(mot));
  };

  const favoris = useAsync(
    () =>
      compte
        ? db.query<{ cle: string; libelle: string; contexte: string | null; url: string | null }>(
            "SELECT cle, libelle, contexte, url FROM atlassian_favoris WHERE service = 'bitbucket' AND instance = ? ORDER BY libelle",
            [compte],
          )
        : Promise.resolve([]),
    [compte],
  );
  // Les dépôts du compte, pour compléter la description des favoris.
  const depots = useEtat<{ depots: Depot[] }>("depots", compte ? { instance: compte, limite: 100 } : null);

  if (attente) return attente;

  const lignesFavoris = Array.isArray(favoris.data) ? favoris.data : [];
  const connus = new Map((depots.data?.depots ?? []).map((d) => [`${d.projet}/${d.slug}`, d]));
  const lignes: Depot[] = lignesFavoris
    .map((f) => {
      const connu = connus.get(f.cle);
      if (connu) return connu;
      const { projet, depot } = separerDepot(f.cle);
      return {
        slug: depot,
        nom: f.libelle,
        description: "",
        projet,
        projetNom: f.contexte ?? projet,
        archive: false,
        brancheDefaut: null,
        url: f.url,
      };
    })
    .filter((d) => correspond(d.nom, d.projet, d.projetNom, d.description));

  return (
    <Page
      toolbar={
        <Row gap="sm">
          <RechercheRetenue label="les favoris" recherche={recherche} onChange={setRecherche} />
          {selecteur}
        </Row>
      }
    >
      <PageSection
        title="Favoris"
        state={favoris.error ? "error" : favoris.loading && !favoris.data ? "loading" : "ready"}
        onRetry={favoris.reload}
        empty={
          favoris.data && lignes.length === 0
            ? {
                title: lignesFavoris.length === 0 ? "Aucun dépôt favori" : "Aucun favori ne correspond",
                description:
                  lignesFavoris.length === 0
                    ? "Ouvrez un dépôt depuis l’onglet Dépôts, puis l’étoile, pour le retrouver ici."
                    : "Essayez un autre mot.",
              }
            : undefined
        }
      >
        <ListeDepots
          depots={lignes}
          favoris={new Set(lignesFavoris.map((f) => f.cle))}
          onOuvrir={(depot) => ouvrirDepot(compte, depot)}
        />
      </PageSection>
    </Page>
  );
}
