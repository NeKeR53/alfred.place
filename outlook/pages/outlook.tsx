import { Stack } from "@alfred/kit";
import { notifyActionError, shell, states, useAsync } from "@alfred/sdk";
import type { EtatComptes } from "../lib/etats";
import { PlugZap } from "lucide-react";
import { useEffect, useState } from "react";
import { Page, PageSection, TextInput, Toggle } from "socle-ui";
import { ecrireReglage, lireReglages } from "../lib/regles";

/** Fait relire les comptes Outlook, puis dit si l’application répond et à quelle boîte. */
async function tester() {
  let etat: EtatComptes | undefined;
  try {
    const lecture = await states.get("comptes");
    await lecture.refresh();
    etat = (await states.get("comptes")).value as EtatComptes | undefined;
  } catch {
    etat = undefined;
  }
  if (!etat?.pret) {
    shell.notify({
      title: "Outlook ne répond pas",
      description: "Ouvrez Microsoft Outlook sur votre PC Windows, puis réessayez.",
      tone: "warning",
    });
    return;
  }
  const qui = etat.profil?.adresse || etat.profil?.nom || "votre boîte";
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
          <Toggle
            isSelected={actif("releve_active")}
            onChange={(v) => enregistrer("releve_active", v ? "1" : "0")}
            description="Toutes les dix minutes, tant qu’Alfred est ouvert."
          >
            Relever la boîte régulièrement
          </Toggle>
          <Toggle
            isSelected={actif("notifier")}
            onChange={(v) => enregistrer("notifier", v ? "1" : "0")}
            description="Une notification quand de nouveaux messages arrivent."
          >
            Me prévenir des nouveaux messages
          </Toggle>
        </Stack>
      </PageSection>
      <PageSection title="Rédaction">
        <TextInput
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
        <Toggle
          isSelected={actif("marquer_lu_ouverture")}
          onChange={(v) => enregistrer("marquer_lu_ouverture", v ? "1" : "0")}
          description="Un message ouvert depuis la boîte cesse d’être non lu."
        >
          Marquer comme lu à l’ouverture
        </Toggle>
      </PageSection>
    </Page>
  );
}
