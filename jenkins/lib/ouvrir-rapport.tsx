import { functions, shell } from "@alfred/sdk";
import { ExternalLink, FileText, Play, RotateCw } from "lucide-react";
import { type Action, Button, Dialog, useConfirm } from "socle-ui";
import { JournalBuild } from "./JournalBuild";
import { RapportEchec } from "./RapportEchec";
import { marquerLu, type Rapport } from "./rapport";
import { dossierDe, nomCourt } from "./tableau";

const FORMAT = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function contexteRapport(rapport: Rapport): string {
  const quand = rapport.fini_le ?? rapport.analyse_le ?? rapport.cree_le;
  const date = quand ? FORMAT.format(new Date(quand.includes("T") ? quand : `${quand.replace(" ", "T")}Z`)) : null;
  const libelle = date ? `${rapport.fini_le ? "échoué" : "analysé"} le ${date}` : null;
  return [`Build n° ${rapport.build}`, libelle, dossierDe(rapport.job) || null].filter(Boolean).join(" · ");
}

export const titreRapport = (rapport: Rapport) => rapport.titre ?? `Échec de « ${nomCourt(rapport.job)} »`;

/** Ce que la page ouvre en modale : les logs d’un build, ou un rapport d’échec. */
export type Fenetre =
  | {
      kind: "logs";
      titre: string;
      description?: string;
      instance: string;
      job: string;
      build?: number;
      url?: string | null;
      onRelancer?: () => Promise<unknown>;
    }
  | { kind: "rapport"; rapport: Rapport };

export const fenetreLogs = (rapport: Rapport): Fenetre => ({
  kind: "logs",
  titre: `Logs de « ${nomCourt(rapport.job)} »`,
  description: `Build n° ${rapport.build}`,
  instance: rapport.instance,
  job: rapport.job,
  build: rapport.build,
  url: rapport.url,
});

/** Un rapport s’ouvre : il est marqué lu. */
export function ouvrirRapport(rapport: Rapport, apres: () => void): Fenetre {
  if (!rapport.lu && rapport.statut === "prete") void marquerLu(rapport.id).then(apres);
  return { kind: "rapport", rapport };
}

const relancerJob = async (rapport: Rapport, apres: () => void) => {
  await functions.call("relancer-job", { ...(rapport.instance ? { instance: rapport.instance } : {}), job: rapport.job });
  shell.notify({ title: "Build demandé", tone: "success" });
  setTimeout(apres, 1500);
};

const analyserDeNouveau = async (rapport: Rapport, apres: () => void) => {
  await functions.call("analyser-echec", {
    ...(rapport.instance ? { instance: rapport.instance } : {}),
    job: rapport.job,
    build: rapport.build,
  });
  shell.notify({ title: "Rapport mis à jour", tone: "success" });
  apres();
};

/** Actions d’un rapport : relire les logs, relancer le job, refaire l’analyse, ouvrir le build dans Jenkins. */
export function actionsRapport(rapport: Rapport, apres: () => void, ouvrir: (fenetre: Fenetre) => void): Action[] {
  const nom = nomCourt(rapport.job);
  return [
    { id: "logs", label: "Voir les logs", icon: <FileText size={16} />, onPress: () => ouvrir(fenetreLogs(rapport)) },
    {
      id: "relancer",
      label: "Relancer",
      icon: <Play size={16} />,
      confirm: { title: `Relancer le job « ${nom} » ?`, confirmLabel: "Relancer" },
      onPress: () => relancerJob(rapport, apres),
    },
    {
      id: "analyser",
      label: "Analyser à nouveau",
      icon: <RotateCw size={16} />,
      onPress: () => analyserDeNouveau(rapport, apres),
    },
    {
      id: "jenkins",
      label: "Ouvrir dans Jenkins",
      icon: <ExternalLink size={16} />,
      isHidden: !rapport.url,
      onPress: () => shell.openExternal(rapport.url ?? ""),
    },
  ];
}

/** La modale ouverte par la page : logs d’un build, ou rapport d’échec. */
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
  const fermeture = (ouverte: boolean) => {
    if (!ouverte) onClose();
  };
  if (fenetre.kind === "logs") {
    const relancer = fenetre.onRelancer;
    return (
      <Dialog
        isOpen
        size="xl"
        title={fenetre.titre}
        description={fenetre.description}
        onOpenChange={fermeture}
        footer={
          <>
            {fenetre.url ? (
              <Button
                icon={<ExternalLink size={16} />}
                onPress={() => void shell.openExternal(`${fenetre.url}console`)}
              >
                Ouvrir dans Jenkins
              </Button>
            ) : null}
            {relancer ? (
              <Button
                variant="primary"
                icon={<Play size={16} />}
                onPress={async () => {
                  if (await confirm({ title: "Relancer ce job ?", confirmLabel: "Relancer", tone: "default" }))
                    await relancer();
                }}
              >
                Relancer
              </Button>
            ) : null}
          </>
        }
      >
        <JournalBuild instance={fenetre.instance} job={fenetre.job} build={fenetre.build} />
      </Dialog>
    );
  }
  const { rapport } = fenetre;
  return (
    <Dialog
      isOpen
      size="lg"
      title={titreRapport(rapport)}
      description={`${nomCourt(rapport.job)} · ${contexteRapport(rapport)}`}
      onOpenChange={fermeture}
      footer={
        <>
          <Button icon={<FileText size={16} />} onPress={() => ouvrir(fenetreLogs(rapport))}>
            Voir les logs
          </Button>
          <Button icon={<RotateCw size={16} />} onPress={() => void analyserDeNouveau(rapport, apres)}>
            Analyser à nouveau
          </Button>
          <Button
            variant="primary"
            icon={<Play size={16} />}
            onPress={async () => {
              if (
                await confirm({
                  title: `Relancer le job « ${nomCourt(rapport.job)} » ?`,
                  confirmLabel: "Relancer",
                  tone: "default",
                })
              )
                await relancerJob(rapport, apres);
            }}
          >
            Relancer
          </Button>
        </>
      }
    >
      <RapportEchec rapport={rapport} />
    </Dialog>
  );
}
