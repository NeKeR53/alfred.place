import { db, notifyActionError, shell, useAlfredState } from "@alfred/sdk";
import { useMemo } from "react";
import { Mail } from "lucide-react";
import { ListPage } from "socle-ui";
import { raisonIndisponible } from "../lib/affichage";
import { useComptesOutlook } from "../lib/etats";

interface Message {
  expediteur: string;
  expediteurAdresse: string;
  recu: string | null;
  lu: boolean;
}

interface Correspondant {
  id: string;
  adresse: string;
  nom: string;
  messages: number;
  nonLus: number;
  dernier: string | null;
}

const LOT = 100;

interface PageMessages {
  messages: Message[];
  suivant: boolean;
}

/** Regroupe les messages par expéditeur, du plus fréquent au plus rare. */
function regrouper(pages: Array<PageMessages | undefined>): Correspondant[] {
  const parAdresse = new Map<string, Correspondant>();
  for (const page of pages) {
    for (const message of page?.messages ?? []) {
      const adresse = (message.expediteurAdresse || message.expediteur || "").toLowerCase();
      if (!adresse) continue;
      const fiche = parAdresse.get(adresse) ?? {
        id: adresse,
        adresse,
        nom: message.expediteur || adresse,
        messages: 0,
        nonLus: 0,
        dernier: null,
      };
      fiche.messages += 1;
      if (!message.lu) fiche.nonLus += 1;
      if (message.recu && (!fiche.dernier || message.recu > fiche.dernier)) fiche.dernier = message.recu;
      parAdresse.set(adresse, fiche);
    }
  }
  return [...parAdresse.values()].sort((a, b) => b.messages - a.messages);
}

/** Les trois cents derniers messages de la boîte, par lots de cent suivis en direct. */
function useDerniersMessages(pret: boolean) {
  const premier = useAlfredState<PageMessages>(pret ? "messages" : null, { params: { compte: "", debut: 0, limite: LOT } });
  const deuxieme = useAlfredState<PageMessages>(pret && premier.data?.suivant ? "messages" : null, {
    params: { compte: "", debut: LOT, limite: LOT },
  });
  const troisieme = useAlfredState<PageMessages>(pret && deuxieme.data?.suivant ? "messages" : null, {
    params: { compte: "", debut: 2 * LOT, limite: LOT },
  });
  const lots = [premier, deuxieme, troisieme];
  return {
    pages: lots.map((lot) => lot.data),
    loading: premier.loading,
    error: premier.error && !premier.data ? premier.error : undefined,
    refresh: () => Promise.all(lots.map((lot) => lot.refresh())).then(() => undefined),
  };
}

export default function CorrespondantsPage() {
  const { comptes, pret, indisponible } = useComptesOutlook();
  const derniers = useDerniersMessages(pret);
  const [page1, page2, page3] = derniers.pages;
  const correspondants = useMemo(() => regrouper([page1, page2, page3]), [page1, page2, page3]);
  const chargement = !indisponible && (comptes.loading || (pret && derniers.loading));

  async function voirMessages(correspondant: Correspondant) {
    await db.execute(
      `INSERT INTO outlook_reglages (cle, valeur) VALUES ('expediteur_actif', ?)
       ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`,
      [`${correspondant.adresse}|${correspondant.nom}`],
    );
    await shell.navigate("outlook/boite-de-reception");
  }

  return (
    <ListPage<Correspondant>
      title="Correspondants"
      rows={indisponible ? [] : chargement ? undefined : correspondants}
      columns={[
        { id: "nom", label: "Nom" },
        { id: "adresse", label: "Adresse", type: "email" },
        { id: "messages", label: "Messages", type: "number" },
        { id: "nonLus", label: "Non lus", type: "number" },
        { id: "dernier", label: "Dernier message", type: "relative" },
      ]}
      search={{ label: "les correspondants", text: (correspondant) => `${correspondant.nom} ${correspondant.adresse}` }}
      filters={[
        {
          id: "vue",
          label: "Vue",
          allLabel: "Tous",
          options: [{ id: "nonLus", label: "Avec des non lus" }],
          value: (correspondant) => (correspondant.nonLus > 0 ? "nonLus" : null),
        },
      ]}
      empty={
        indisponible
          ? { title: "Outlook ne répond pas", description: raisonIndisponible(comptes.error) }
          : {
              title: "Aucun correspondant",
              description: "Les personnes qui vous écrivent apparaissent ici, classées par nombre de messages.",
            }
      }
      onOpen={(correspondant) => void voirMessages(correspondant)}
      rowActions={(correspondant) => [
        { id: "messages", label: "Voir ses messages", icon: <Mail size={16} />, onPress: () => voirMessages(correspondant) },
      ]}
      isLoading={chargement}
      hasError={Boolean(derniers.error)}
      onRetry={() => void (pret ? derniers.refresh() : comptes.refresh())}
      onActionError={notifyActionError}
    />
  );
}
