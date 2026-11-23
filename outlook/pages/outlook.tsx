import { Stack } from "@alfred/kit";
import { functions, notifyActionError, shell, useAsync } from "@alfred/sdk";
import { PlugZap } from "lucide-react";
import { useEffect, useState } from "react";
import { Page, PageSection, Switch, TextField } from "socle-ui";
import { ecrireReglage, lireReglages } from "../lib/regles";

/** Vérifie qu’Outlook répond sur ce poste, et dit à quelle boîte. */
async function tester() {
  const reponse = await functions.call<{ pret: boolean; profil: { nom: string; adresse: string } | null }>(
    "comptes-outlook",
  );
  if (!reponse.pret) {
    shell.notify({
      title: "Outlook ne répond pas",
      description: "Ouvrez Microsoft Outlook sur cet ordinateur, puis réessayez.",
      tone: "warning",
    });
    return;
  }
  const qui = reponse.profil?.adresse || reponse.profil?.nom || "votre boîte";
  shell.notify({ title: "Outlook répond", description: `Connecté à ${qui}.`, tone: "success" });
}

export default function ReglagesOutlook() {
  const reglages = useAsync(lireReglages, []);
  const valeurs = reglages.data;
  const [signature, setSignature] = useState("");
  useEffect(() => {
    if (valeurs) setSignature(valeurs.signature ?? "");
  }, [valeurs]);

  const enregistrer = (cle: string, valeur: string) =>
    ecrireReglage(cle, valeur).then(reglages.reload, (erreur) =>
      notifyActionError({ label: "Enregistrer le réglage" }, erreur),
    );
  const actif = (cle: string) => (valeurs?.[cle] ?? "1") !== "0";

  return (
    <Page state={reglages.error ? "error" : !valeurs ? "loading" : "ready"} onRetry={reglages.reload}>
      <PageSection
        title="Outlook sur cet ordinateur"
        description="Alfred pilote l’application Outlook installée sur ce PC. Aucun mot de passe n’est enregistré ici."
        actions={[{ id: "tester", label: "Tester la connexion", icon: <PlugZap size={16} />, onPress: tester }]}
      >
        <Stack gap="md">
          <Switch
            isSelected={actif("releve_active")}
            onChange={(v) => enregistrer("releve_active", v ? "1" : "0")}
            description="Toutes les dix minutes, tant qu’Alfred est ouvert."
          >
            Relever la boîte régulièrement
          </Switch>
          <Switch
            isSelected={actif("notifier")}
            onChange={(v) => enregistrer("notifier", v ? "1" : "0")}
            description="Une notification quand de nouveaux messages arrivent."
          >
            Me prévenir des nouveaux messages
          </Switch>
        </Stack>
      </PageSection>
      <PageSection title="Rédaction">
        <TextField
          label="Signature"
          width="lg"
          description="Ajoutée au bas de vos nouveaux messages, réponses et transferts."
          placeholder="Cordialement, Alexandre"
          value={signature}
          onChange={setSignature}
          onBlur={() => {
            if (signature !== (valeurs?.signature ?? "")) void enregistrer("signature", signature);
          }}
        />
      </PageSection>
      <PageSection title="Lecture">
        <Switch
          isSelected={actif("marquer_lu_ouverture")}
          onChange={(v) => enregistrer("marquer_lu_ouverture", v ? "1" : "0")}
          description="Un message ouvert depuis la boîte cesse d’être non lu."
        >
          Marquer comme lu à l’ouverture
        </Switch>
      </PageSection>
    </Page>
  );
}
