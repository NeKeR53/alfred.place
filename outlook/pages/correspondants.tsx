import { db, functions, notifyActionError, shell, useAsync } from "@alfred/sdk";
import { Mail } from "lucide-react";
import { ListPage } from "socle-ui";
import { raisonIndisponible } from "../lib/affichage";

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
    if (!page.suivant) break;
  }
  return [...parAdresse.values()].sort((a, b) => b.messages - a.messages);
}

export default function CorrespondantsPage() {
  const comptes = useAsync(() => functions.call<{ pret: boolean }>("comptes-outlook"), []);
  const indisponible = Boolean(comptes.error) || (comptes.data !== undefined && comptes.data.pret !== true);
  const correspondants = useAsync(charger, []);

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
      rows={correspondants.data}
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
      isLoading={correspondants.loading}
      hasError={Boolean(correspondants.error)}
      onRetry={correspondants.reload}
      onActionError={notifyActionError}
    />
  );
}
