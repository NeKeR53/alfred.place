import { functions, shell } from "@alfred/sdk";
import { FileText, Play, RotateCw } from "lucide-react";
import { type Action, Button, Modal, useConfirm } from "socle-ui";
import { ExecutionDialog } from "./Execution";
import { avecInstance, lancer } from "./prefect";
import { RapportEchec } from "./RapportEchec";
import { marquerLu, type Rapport } from "./rapport";

const FORMAT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const nomRapport = (rapport: Rapport) => rapport.deploiement ?? rapport.flux ?? "Exécution";
export const titreRapport = (rapport: Rapport) => rapport.titre ?? `Échec de « ${nomRapport(rapport)} »`;

export function contexteRapport(rapport: Rapport): string {
  const date = rapport.fini_le ? FORMAT.format(new Date(rapport.fini_le)) : null;
  const etat = rapport.etat === "CRASHED" ? "plantée" : "échouée";
  return [rapport.nom ? `Exécution ${rapport.nom}` : null, date ? `${etat} le ${date}` : null].filter(Boolean).join(" · ");
}

/** Ce que la page ouvre en modale : une exécution (logs, tâches, détails), ou un rapport d’échec. */
export type Fenetre = { kind: "execution"; instance: string; id: string } | { kind: "rapport"; rapport: Rapport };

/** Un rapport s’ouvre : il est marqué lu. */
export function ouvrirRapport(rapport: Rapport, apres: () => void): Fenetre {
  if (!rapport.lu && rapport.statut === "prete") void marquerLu(rapport.execution).then(apres);
  return { kind: "rapport", rapport };
}

const relancer = async (rapport: Rapport, apres: () => void) => {
  await lancer(rapport.instance, rapport.deploiement_id ?? "");
  shell.notify({ title: "Exécution lancée", tone: "success" });
  setTimeout(apres, 1500);
};

const analyserDeNouveau = async (rapport: Rapport, apres: () => void) => {
  await functions.call("analyser-echec", { ...avecInstance(rapport.instance), execution: rapport.execution });
  shell.notify({ title: "Rapport mis à jour", tone: "success" });
  apres();
};

/** Actions d’un rapport : relire les logs, relancer le déploiement, refaire l’analyse. */
export function actionsRapport(rapport: Rapport, apres: () => void, ouvrir: (fenetre: Fenetre) => void): Action[] {
  return [
    {
      id: "logs",
      label: "Voir les logs",
      icon: <FileText size={16} />,
      onPress: () => ouvrir({ kind: "execution", instance: rapport.instance, id: rapport.execution }),
    },
    {
      id: "relancer",
      label: "Relancer",
      icon: <Play size={16} />,
      isHidden: !rapport.deploiement_id,
      confirm: {
        title: `Relancer « ${nomRapport(rapport)} » ?`,
        message: "Une exécution démarre avec les paramètres par défaut du déploiement.",
        confirmLabel: "Relancer",
      },
      onPress: () => relancer(rapport, apres),
    },
    {
      id: "analyser",
      label: "Analyser à nouveau",
      icon: <RotateCw size={16} />,
      onPress: () => analyserDeNouveau(rapport, apres),
    },
  ];
}

/** La modale ouverte par la page : une exécution, ou un rapport d’échec. */
export function Fenetres({
  fenetre,
  onClose,
  ouvrir,
  apres,
}: {
  fenetre: Fenetre | null;
  onClose: () => void;
  ouvrir: (fenetre: Fenetre) => void;
  apres: () => void;
}) {
  const confirm = useConfirm();
  if (!fenetre) return null;
  if (fenetre.kind === "execution")
    return <ExecutionDialog instance={fenetre.instance} id={fenetre.id} apresAction={apres} onClose={onClose} />;
  const { rapport } = fenetre;
  return (
    <Modal
      isOpen
      size="lg"
      title={titreRapport(rapport)}
      description={`${nomRapport(rapport)} · ${contexteRapport(rapport)}`}
      onOpenChange={(ouverte) => {
        if (!ouverte) onClose();
      }}
      footer={
        <>
          <Button
            icon={<FileText size={16} />}
            onPress={() => ouvrir({ kind: "execution", instance: rapport.instance, id: rapport.execution })}
          >
            Voir les logs
          </Button>
          <Button icon={<RotateCw size={16} />} onPress={() => void analyserDeNouveau(rapport, apres)}>
            Analyser à nouveau
          </Button>
          {rapport.deploiement_id ? (
            <Button
              variant="primary"
              icon={<Play size={16} />}
              onPress={async () => {
                if (
                  await confirm({
                    title: `Relancer « ${nomRapport(rapport)} » ?`,
                    message: "Une exécution démarre avec les paramètres par défaut du déploiement.",
                    confirmLabel: "Relancer",
                    tone: "default",
                  })
                )
                  await relancer(rapport, apres);
              }}
            >
              Relancer
            </Button>
          ) : null}
        </>
      }
    >
      <RapportEchec rapport={rapport} />
    </Modal>
  );
}
