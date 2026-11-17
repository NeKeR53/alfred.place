import { functions, shell } from "@alfred/sdk";
import { SettingsPage } from "@alfred/ui";
import { ecrireReglage, lireReglages } from "../lib/regles";

export default function ReglagesOutlook() {
  return (
    <SettingsPage
      load={lireReglages}
      sections={(valeurs) => [
        {
          title: "Outlook sur cet ordinateur",
          description:
            "Alfred pilote l’application Outlook installée sur ce PC. Aucun mot de passe n’est enregistré ici.",
          settings: [
            {
              id: "tester",
              type: "action",
              title: "Vérifier Outlook",
              description: "Ouvre Outlook si besoin et vérifie que la boîte répond.",
              action: {
                label: "Tester la connexion",
                onClick: async () => {
                  const reponse = await functions.call<{
                    pret: boolean;
                    profil: { nom: string; adresse: string } | null;
                  }>("comptes-outlook");
                  if (!reponse.pret) {
                    await shell.notify({
                      title: "Outlook ne répond pas",
                      description:
                        "Ouvrez Microsoft Outlook sur cet ordinateur, puis réessayez.",
                      tone: "warning",
                    });
                    return;
                  }
                  const qui =
                    reponse.profil?.adresse || reponse.profil?.nom || "votre boîte";
                  await shell.notify({
                    title: "Outlook répond",
                    description: `Connecté à ${qui}.`,
                    tone: "success",
                  });
                },
              },
            },
            {
              id: "releve_active",
              type: "switch",
              title: "Relever la boîte régulièrement",
              description: "Toutes les dix minutes, tant qu’Alfred est ouvert.",
              value: (valeurs["releve_active"] ?? "1") !== "0",
              save: (actif) => ecrireReglage("releve_active", actif ? "1" : "0"),
            },
            {
              id: "notifier",
              type: "switch",
              title: "Me prévenir des nouveaux messages",
              description: "Une notification quand de nouveaux messages arrivent.",
              value: (valeurs["notifier"] ?? "1") !== "0",
              save: (actif) => ecrireReglage("notifier", actif ? "1" : "0"),
            },
          ],
        },
        {
          title: "Rédaction",
          settings: [
            {
              id: "signature",
              type: "text",
              title: "Signature",
              description: "Ajoutée au bas de vos nouveaux messages, réponses et transferts.",
              value: valeurs["signature"] ?? "",
              placeholder: "Cordialement, Alexandre",
              optional: true,
              save: (valeur) => ecrireReglage("signature", valeur),
            },
          ],
        },
        {
          title: "Lecture",
          settings: [
            {
              id: "marquer_lu_ouverture",
              type: "switch",
              title: "Marquer comme lu à l’ouverture",
              description: "Un message ouvert depuis la boîte cesse d’être non lu.",
              value: (valeurs["marquer_lu_ouverture"] ?? "1") !== "0",
              save: (actif) => ecrireReglage("marquer_lu_ouverture", actif ? "1" : "0"),
            },
          ],
        },
      ]}
    />
  );
}
