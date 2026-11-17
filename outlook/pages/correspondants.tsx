import { Mail } from "lucide-react";
import { db, functions, shell, useAsync } from "@alfred/sdk";
import { CollectionPage, FeedbackBanner } from "@alfred/ui";
import { raisonIndisponible } from "../lib/affichage";

interface Message {
  expediteur: string;
  expediteurAdresse: string;
  recu: string | null;
  lu: boolean;
}

interface Correspondant {
  adresse: string;
  nom: string;
  messages: number;
  nonLus: number;
  dernier: string | null;
}

const LOT = 100;
const LOTS = 3;

async function charger(): Promise<Correspondant[]> {
  const etat = await functions.call<{ pret: boolean }>("comptes-outlook").catch(() => null);
  if (!etat?.pret) return [];

  const parAdresse = new Map<string, Correspondant>();
  for (let lot = 0; lot < LOTS; lot += 1) {
    const page = await functions.call<{ messages: Message[]; suivant: boolean }>("lister-messages", {
      debut: lot * LOT,
      limite: LOT,
    });
    for (const message of page.messages) {
      const adresse = (message.expediteurAdresse || message.expediteur || "").toLowerCase();
      if (!adresse) continue;
      const fiche = parAdresse.get(adresse) ?? {
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
    if (!page.suivant) break;
  }
  return [...parAdresse.values()].sort((a, b) => b.messages - a.messages);
}

export default function CorrespondantsPage() {
  const comptes = useAsync(() => functions.call<{ pret: boolean }>("comptes-outlook"), []);
  const pret = comptes.data?.pret === true;

  async function voirMessages(correspondant: Correspondant) {
    await db.execute(
      `INSERT INTO outlook_reglages (cle, valeur) VALUES ('expediteur_actif', ?)
       ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur`,
      [`${correspondant.adresse}|${correspondant.nom}`],
    );
    await shell.navigate("outlook/boite-de-reception");
  }

  return (
    <CollectionPage<Correspondant>
      label="Correspondants"
      load={charger}
      rowKey={(correspondant) => correspondant.adresse}
      columns={[
        { key: "nom", header: "Nom" },
        { key: "adresse", header: "Adresse", type: "email" },
        { key: "messages", header: "Messages", type: "number" },
        { key: "nonLus", header: "Non lus", type: "number" },
        { key: "dernier", header: "Dernier message", type: "relative" },
      ]}
      search={{
        label: "Rechercher un correspondant",
        text: (correspondant) => `${correspondant.nom} ${correspondant.adresse}`,
      }}
      views={{
        label: "Vue",
        items: [
          { id: "tous", label: "Tous", test: () => true },
          { id: "nonLus", label: "Avec des non lus", test: (correspondant) => correspondant.nonLus > 0 },
        ],
      }}
      emptyTitle="Aucun correspondant"
      emptyDescription="Les personnes qui vous écrivent apparaissent ici, classées par nombre de messages."
      onOpen={voirMessages}
      rowActions={(correspondant) => [
        { label: "Voir ses messages", icon: Mail, onClick: () => voirMessages(correspondant) },
      ]}
      banner={
        comptes.error || (comptes.data && !pret) ? (
          <FeedbackBanner tone="warning">{raisonIndisponible(comptes.error)}</FeedbackBanner>
        ) : undefined
      }
    />
  );
}
