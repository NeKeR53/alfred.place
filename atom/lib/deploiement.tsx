// Fenêtres d’un conteneur de l’Usine, comme les fenêtres de déploiement de OneApp : « Logs du conteneur » (journal en
// direct) et « Console du conteneur » (session interactive). Ouvertes par `shell.openWindow("usine", { params })`.
// En données d’exemple, le journal défile et la console répond depuis lib/demo.ts, sans rien joindre.
import { ai, type ChannelEvent, files, isExampleMode, loadTerminal, shell, useAsync, useChannel, useTerminalConnection } from "@alfred/sdk";
import { Row, Text } from "@alfred/kit";
import { Copy, Download, Eraser, Lightbulb, RefreshCw, ScanSearch } from "lucide-react";
import {
  type Action,
  Button,
  Modal,
  EmptyState,
  type LogLine,
  LogViewer,
  type LogViewerView,
  Page,
  Select,
  Terminal,
  type TerminalConnection,
  type TerminalHandle,
  TextInput,
  useOpenForm,
} from "socle-ui";
import { Markdown } from "socle-ui/markdown";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { consoleDemo, journalDemo, ligneJournalDemo } from "./demo";
import { functions, useResumeAtom } from "./source";
import type { CibleDeploiement } from "./usine";

export const LIGNES_JOURNAL = [100, 300, 500, 1_000, 5_000, 10_000] as const;
/** Une nouvelle ligne du faux journal toutes les 1,2 s. */
const RYTHME_DEMO = 1_200;

const message = (erreur: unknown, defaut: string) => (erreur instanceof Error && erreur.message ? erreur.message : defaut);

/** Masque ce qui ressemble à un secret avant d’envoyer un extrait au modèle (mot de passe, jeton, clé). */
export function masquerSecrets(texte: string) {
  return texte
    .replace(/\b((?:pass(?:word)?|pwd|secret|token|api[_-]?key|authorization)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi, "$1***")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g, "$1 ***");
}

/** Extrait à analyser : titre de la boîte, texte et contexte donné au modèle. */
type Extrait = { boite: string; titre: string; texte: string; contexte: string };

/** Analyse d’un extrait par le modèle, dans une boîte : figée à l’ouverture, « Relancer » refait la même. */
function Analyse({ extrait, fermer }: { extrait: Extrait; fermer: () => void }) {
  const { titre, texte, contexte } = extrait;
  const [essai, setEssai] = useState(0);
  const analyse = useAsync(
    () =>
      ai.oneShot<{ analyse: string }>({
        instruction:
          "Tu analyses un extrait de journal ou de console d’un conteneur Docker. Réponds en français, en Markdown court : " +
          "ce qui se passe, les erreurs et leur cause probable, puis les vérifications ou corrections à faire. " +
          "Cite les lignes utiles. N’invente rien qui ne soit pas dans l’extrait.",
        context: { titre, contexte, extrait: masquerSecrets(texte.slice(-60_000)) },
        schema: {
          type: "object",
          required: ["analyse"],
          properties: { analyse: { type: "string", description: "Analyse en Markdown." } },
        },
      }),
    [essai],
  );
  return (
    <Modal
      isOpen
      size="lg"
      title={`${extrait.boite} · ${titre}`}
      onOpenChange={(ouverte) => {
        if (!ouverte) fermer();
      }}
      footer={
        <>
          <Button onPress={fermer}>Fermer</Button>
          <Button variant="primary" isPending={analyse.loading} onPress={() => setEssai((n) => n + 1)}>
            Relancer
          </Button>
        </>
      }
    >
      {analyse.loading ? (
        <Text tone="muted">Analyse du log en cours…</Text>
      ) : analyse.error ? (
        <EmptyState size="compact" title="Analyse impossible" description={analyse.error.message} />
      ) : (
        <Markdown>{analyse.data?.analyse ?? ""}</Markdown>
      )}
    </Modal>
  );
}

/** Une ligne lue dans le journal Docker horodaté : « 2026-11-20T10:00:00.123456789Z texte ». */
function ligneJournal(texte: string): LogLine {
  const horodate = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s(.*)$/.exec(texte);
  if (!horodate) return texte;
  const temps = Date.parse(horodate[1].replace(/(\.\d{3})\d+/, "$1"));
  return Number.isNaN(temps) ? texte : { text: horodate[2], time: temps };
}

/** Lignes des événements d’un canal : chaque événement porte un ou plusieurs morceaux de texte. */
function lignesDuCanal(events: readonly ChannelEvent[]): LogLine[] {
  const texte = events
    .map((event) => (event.data === undefined ? "" : event.base64 ? decoder(event.data) : event.data))
    .join("");
  return texte
    .split(/\r?\n/)
    .filter((ligne) => ligne.length)
    .map(ligneJournal);
}

function decoder(base64: string) {
  const binaire = atob(base64);
  const octets = new Uint8Array(binaire.length);
  for (let index = 0; index < binaire.length; index += 1) octets[index] = binaire.charCodeAt(index);
  return new TextDecoder().decode(octets);
}

async function copierTexte(texte: string) {
  await navigator.clipboard.writeText(texte);
}

const horodatageFichier = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");

// ------------------------------------------------------------------------------------------------------- Journal

/** Fenêtre « Logs du conteneur » : journal en direct, niveaux, recherche, effacement, analyse et téléchargement. */
export function FenetreJournal({ cible }: { cible: CibleDeploiement }) {
  const demo = isExampleMode();
  useResumeAtom(`Logs · ${cible.nom} · ${cible.envNom}`);
  const [lignes, setLignes] = useState<(typeof LIGNES_JOURNAL)[number]>(300);
  // Chaque lecture (première, « Actualiser », « Réessayer », autre nombre de lignes) rouvre le flux.
  const [lecture, setLecture] = useState(0);
  const [efface, setEfface] = useState<number | null>(null);

  // Vrai service : un canal ouvert par le connecteur Portainer, lu en continu.
  const ouvert = useAsync(
    async () =>
      demo
        ? null
        : functions.call<{ canal: string | null }>("portainer/suivre-journal", {
            instance: cible.instance,
            conteneur: cible.conteneur,
            lignes,
            horodatage: true,
          }),
    [cible.instance, cible.conteneur, lignes, lecture],
  );
  const flux = useChannel(ouvert.data?.canal ?? null, { keep: 5000 });
  // Effacer : seules les lignes arrivées après restent (rang des événements du canal).
  const canalAffiche = useMemo(
    () => (efface === null ? flux : { ...flux, events: flux.events.filter((event) => event.seq > efface) }),
    [flux, efface],
  );

  // Démonstration : le journal défile d’une ligne toutes les 1,2 s.
  const [lignesDemo, setLignesDemo] = useState<string[]>([]);
  useEffect(() => {
    if (!demo) return;
    let n = lignes;
    setLignesDemo([
      `${new Date().toISOString()} INFO  [démonstration] Journal fictif de ${cible.nom} : aucun conteneur n’est joint.`,
      ...journalDemo(cible.service, lignes),
    ]);
    const minuterie = window.setInterval(() => {
      n += 1;
      setLignesDemo((avant) => [...avant, ligneJournalDemo(cible.service, n)]);
    }, RYTHME_DEMO);
    return () => window.clearInterval(minuterie);
  }, [demo, cible.nom, cible.service, lignes, lecture]);
  const [demoEffaceA, setDemoEffaceA] = useState<number | null>(null);
  const lignesDemoAffichees = useMemo(
    () => (demoEffaceA === null ? lignesDemo : lignesDemo.slice(demoEffaceA)),
    [lignesDemo, demoEffaceA],
  );

  const relire = useCallback(() => {
    setEfface(null);
    setDemoEffaceA(null);
    setLecture((n) => n + 1);
  }, []);
  const effacer = () => {
    if (demo) setDemoEffaceA(lignesDemo.length);
    else setEfface(flux.events.at(-1)?.seq ?? -1);
  };
  const nettoye = demo ? demoEffaceA !== null : efface !== null;

  // F5 relit le journal, comme dans OneApp.
  useEffect(() => {
    const touche = (event: KeyboardEvent) => {
      if (event.key !== "F5" || event.ctrlKey || event.altKey || event.metaKey) return;
      event.preventDefault();
      relire();
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [relire]);

  const telecharger = async (texte: string) => {
    try {
      const fichier = await files.save({ name: `${cible.nom}-${horodatageFichier()}.log`, text: texte });
      if (await files.export(fichier.id)) void shell.notify({ title: "Logs téléchargés", description: cible.nom, tone: "success" });
    } catch (erreur) {
      void shell.notify({ title: "Téléchargement impossible", description: message(erreur, "Le fichier n’a pas été enregistré."), tone: "error" });
    }
  };

  const [extrait, setExtrait] = useState<Extrait | null>(null);
  const lignesCanal = useMemo(() => lignesDuCanal(canalAffiche.events), [canalAffiche.events]);

  const erreur = ouvert.error ? ouvert.error.message : flux.error?.message;
  const etatVide = ouvert.error ? (
    <EmptyState
      title="Logs indisponibles"
      description={erreur ?? "Impossible de charger les logs du conteneur."}
      action={<Button onPress={relire}>Réessayer</Button>}
    />
  ) : nettoye ? (
    <EmptyState
      title="Journal effacé"
      description="Les nouvelles lignes apparaîtront ici."
      action={<Button onPress={relire}>Tout réafficher</Button>}
    />
  ) : (
    <EmptyState title="Aucun log" description="Ce conteneur n’a encore rien écrit sur sa sortie." />
  );

  const actions = (vue: LogViewerView): Action[] => [
    { id: "actualiser", label: "Actualiser (F5)", icon: <RefreshCw size={16} />, onPress: relire },
    { id: "effacer", label: "Effacer l’affichage", icon: <Eraser size={16} />, isDisabled: vue.empty, onPress: effacer },
    {
      id: "analyser",
      label: "Analyser le log",
      icon: <ScanSearch size={16} />,
      isDisabled: vue.empty,
      onPress: () =>
        setExtrait({
          boite: "Analyse du log",
          titre: cible.nom,
          texte: vue.text(),
          contexte: [
            `Environnement : ${cible.envNom}`,
            nettoye ? "Seules les lignes écrites après l’effacement de l’affichage sont fournies." : "",
            vue.level !== "all" ? "Le journal est filtré sur les alertes ou les erreurs." : "",
            demo ? "Journal fictif de démonstration." : "",
          ]
            .filter(Boolean)
            .join("\n"),
        }),
    },
    {
      id: "telecharger",
      label: "Télécharger les logs affichés",
      icon: <Download size={16} />,
      isDisabled: vue.empty,
      onPress: () => telecharger(vue.text()),
    },
  ];

  return (
    <Page fill>
      <LogViewer
        key={demo ? `demo:${lecture}:${demoEffaceA ?? ""}` : `${ouvert.data?.canal ?? "attente"}:${efface ?? ""}`}
        label={`Logs de ${cible.nom}${demo ? " (démonstration)" : ""}`}
        fill
        levels
        wrap
        live={demo || Boolean(ouvert.data?.canal && !flux.closed)}
        lines={demo ? lignesDemoAffichees.map(ligneJournal) : lignesCanal}
        loading={!demo && ouvert.loading}
        empty={etatVide}
        tools={
          <Select
            label="Lignes"
            hideLabel
            width="xs"
            value={String(lignes)}
            options={LIGNES_JOURNAL.map((valeur) => ({ id: String(valeur), label: `${valeur.toLocaleString("fr-FR")} lignes` }))}
            onChange={(valeur) => {
              if (valeur) setLignes(Number(valeur) as (typeof LIGNES_JOURNAL)[number]);
            }}
          />
        }
        actions={actions}
      />
      {extrait ? <Analyse extrait={extrait} fermer={() => setExtrait(null)} /> : null}
    </Page>
  );
}

// ------------------------------------------------------------------------------------------------------- Console

type EtatConsole = "connexion" | "connecte" | "termine" | "erreur";
const ETATS: Record<EtatConsole, { label: string; tone: "pending" | "success" | "neutral" | "danger" }> = {
  connexion: { label: "Connexion…", tone: "pending" },
  connecte: { label: "Connecté", tone: "success" },
  termine: { label: "Session terminée", tone: "neutral" },
  erreur: { label: "Connexion impossible", tone: "danger" },
};
export const AIDE_CLAVIER = "F6 quitte le terminal · Ctrl+C copie la sélection · Ctrl+V colle · F5 hors du terminal reconnecte";
const LIGNES_ANALYSE = 400;

/** Fenêtre « Console du conteneur » : session TTY persistante, shell et utilisateur au choix, outils autour. */
export function FenetreConsole({ cible }: { cible: CibleDeploiement }) {
  const demo = isExampleMode();
  useResumeAtom(`Console · ${cible.nom} · ${cible.envNom}`);
  const [shellVoulu, setShell] = useState<"bash" | "sh">("bash");
  const [utilisateur, setUtilisateur] = useState("");
  const [session, setSession] = useState(0);
  const terminal = useRef<TerminalHandle>(null);
  const reglages = useRef({ shellVoulu, utilisateur });
  reglages.current = { shellVoulu, utilisateur };

  // Vrai service : une session exec ouverte par le connecteur Portainer (WebSocket), une par « Nouvelle session ».
  const ouverte = useAsync(
    async () =>
      demo
        ? null
        : functions.call<{ canal: string | null; exec: string | null }>("portainer/ouvrir-console", {
            instance: cible.instance,
            conteneur: cible.conteneur,
            shell: reglages.current.shellVoulu,
            utilisateur: reglages.current.utilisateur.trim() || undefined,
          }),
    [cible.instance, cible.conteneur, session],
  );
  const lien = useTerminalConnection(demo ? null : (ouverte.data?.canal ?? null));
  const openForm = useOpenForm();
  const [extrait, setExtrait] = useState<Extrait | null>(null);
  useEffect(() => {
    if (ouverte.error)
      void shell.notify({ title: "Console indisponible", description: ouverte.error.message, tone: "error" });
  }, [ouverte.error]);

  // Démonstration : un faux shell local branché sur le terminal.
  const [demoTerminee, setDemoTerminee] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: une nouvelle session (`session`) recrée le faux shell.
  const connexionDemo = useMemo<TerminalConnection | null>(() => {
    if (!demo) return null;
    let ecrire: ((texte: string) => void) | undefined;
    let faux: ReturnType<typeof consoleDemo> | undefined;
    let fini = false;
    return {
      send: (donnees) => {
        if (fini || !faux || !ecrire) return;
        if (!faux.envoyer(donnees)) {
          fini = true;
          ecrire("\r\n\x1b[2m[Session terminée.]\x1b[0m\r\n");
          setDemoTerminee(true);
        }
      },
      subscribe: (sortie) => {
        ecrire = (texte) => sortie(texte);
        setDemoTerminee(false);
        faux = consoleDemo({ nom: cible.nom, shell: reglages.current.shellVoulu, utilisateur: reglages.current.utilisateur }, ecrire);
        return () => {
          ecrire = undefined;
        };
      },
    };
  }, [demo, cible.nom, session]);

  const etat: EtatConsole = demo
    ? demoTerminee
      ? "termine"
      : "connecte"
    : ouverte.loading
      ? "connexion"
      : ouverte.error || lien.state === "error"
        ? "erreur"
        : lien.state === "closed"
          ? "termine"
          : ouverte.data?.canal
            ? "connecte"
            : "connexion";

  const nouvelleSession = useCallback(() => setSession((n) => n + 1), []);
  // F5 hors du terminal ouvre une nouvelle session ; dans le terminal, F5 appartient au programme en cours.
  useEffect(() => {
    const touche = (event: KeyboardEvent) => {
      if (event.key !== "F5" || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.target instanceof Element && event.target.closest(".xterm")) return;
      event.preventDefault();
      nouvelleSession();
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [nouvelleSession]);

  const proposer = () =>
    openForm({
      title: "Proposer une commande",
      fields: [
        {
          name: "intention",
          label: "Que voulez-vous faire ?",
          type: "textarea",
          placeholder: "lister les fichiers modifiés depuis une heure dans /var/log",
          isRequired: true,
          description: `La commande proposée pour /bin/${shellVoulu} est saisie dans le terminal sans être validée.`,
        },
      ],
      submitLabel: "Proposer",
      onSubmit: async ({ intention }) => {
        const fin = terminal.current?.text(80) ?? "";
        const proposition = await ai.oneShot<{ commande: string; nom: string; explication: string }>({
          instruction:
            "Propose une seule commande shell qui fait ce que demande l’utilisateur, dans la console interactive d’un conteneur " +
            "Docker Linux. Pas de commande destructive sans que ce soit demandé. Réponds en français pour le nom et l’explication.",
          context: masquerSecrets(
            [
              `Console interactive du conteneur « ${cible.nom} ».`,
              `Shell demandé : /bin/${shellVoulu}`,
              utilisateur.trim() ? `Utilisateur demandé : ${utilisateur.trim()}` : "",
              fin.trim() ? `Fin de la session :\n${fin.slice(-3_000)}` : "",
              `Demande : ${intention}`,
            ]
              .filter(Boolean)
              .join("\n"),
          ),
          schema: {
            type: "object",
            required: ["commande", "nom", "explication"],
            properties: {
              commande: { type: "string", description: "La commande, sans Entrée finale." },
              nom: { type: "string", description: "Ce que fait la commande, en quelques mots." },
              explication: { type: "string", description: "Une phrase d’explication." },
            },
          },
        });
        const commande = proposition.commande.replace(/\s+$/, "");
        const titre = proposition.nom || "Commande proposée";
        // Sur plusieurs lignes, un shell sans collage encadré l’exécuterait : elle est seulement copiée.
        if (commande.includes("\n") && !terminal.current?.bracketedPaste()) {
          await copierTexte(commande).catch(() => undefined);
          void shell.notify({
            title: titre,
            description: `${proposition.explication} Commande sur plusieurs lignes copiée dans le presse-papiers : ce shell l’exécuterait au collage.`,
            tone: "info",
          });
          return;
        }
        terminal.current?.paste(commande);
        window.setTimeout(() => terminal.current?.focus());
        void shell.notify({ title: titre, description: `${proposition.explication} Relisez-la avant de la valider avec Entrée.`, tone: "info" });
      },
    });

  const connecte = etat === "connecte";
  const copierSession = async () => {
    try {
      await copierTexte(terminal.current?.text() ?? "");
      void shell.notify({ title: "Session copiée", tone: "success" });
    } catch {
      void shell.notify({ title: "Copie impossible", tone: "error" });
    }
  };
  const analyserSortie = () => {
    const selection = terminal.current?.selection().trim();
    setExtrait({
      boite: "Analyse de la console",
      titre: selection ? `Sélection dans ${cible.nom}` : `Console de ${cible.nom}`,
      texte: selection || terminal.current?.text(LIGNES_ANALYSE) || "Aucune sortie.",
      contexte: [`Shell : /bin/${shellVoulu}`, utilisateur.trim() ? `Utilisateur : ${utilisateur.trim()}` : "", demo ? "Console fictive de démonstration." : ""]
        .filter(Boolean)
        .join("\n"),
    });
  };
  const etatTerminal = demo ? (demoTerminee ? "closed" : "open") : lien.state;
  return (
    <Page
      fill
      toolbar={
        <Row gap="sm">
          <Text tone="muted" size="meta">
            {ETATS[etat].label}
            {demo ? " · démonstration" : ""}
          </Text>
          <Select
            label="Shell"
            hideLabel
            width="sm"
            value={shellVoulu}
            options={[
              { id: "bash", label: "/bin/bash (sinon sh)" },
              { id: "sh", label: "/bin/sh" },
            ]}
            onChange={(valeur) => {
              if (valeur === "bash" || valeur === "sh") setShell(valeur);
            }}
          />
          <TextInput label="Utilisateur" hideLabel width="sm" value={utilisateur} placeholder="utilisateur par défaut" onChange={setUtilisateur} />
        </Row>
      }
      actions={[
        { id: "session", label: "Nouvelle session (F5)", icon: <RefreshCw size={16} />, onPress: nouvelleSession },
        { id: "proposer", label: "Proposer une commande", icon: <Lightbulb size={16} />, isDisabled: !connecte, onPress: () => void proposer() },
        { id: "analyser", label: "Analyser la sortie", icon: <ScanSearch size={16} />, onPress: analyserSortie },
        { id: "copier", label: "Copier la session", icon: <Copy size={16} />, onPress: copierSession },
        {
          id: "effacer",
          label: "Effacer l’historique affiché",
          icon: <Eraser size={16} />,
          onPress: () => {
            terminal.current?.clear();
            terminal.current?.focus();
          },
        },
      ]}
      actionsLabel={`la console de ${cible.nom}`}
      footer={<Text tone="muted" size="meta">{AIDE_CLAVIER}</Text>}
    >
      {demo || ouverte.data?.canal ? (
          <Terminal
            key={demo ? `demo:${session}` : (ouverte.data?.canal ?? "")}
            ref={terminal}
            label={`Terminal de ${cible.nom}`}
            engine={loadTerminal}
            fill
            state={etatTerminal}
            {...(demo ? (connexionDemo ? { connection: connexionDemo } : {}) : { connection: lien.connection, ...(lien.reason ? { reason: lien.reason } : {}) })}
            onResize={({ cols, rows }) =>
              !demo && ouverte.data?.exec
                ? functions.call("portainer/redimensionner-console", { instance: cible.instance, exec: ouverte.data.exec, colonnes: cols, lignes: rows })
                : undefined
            }
          />
      ) : ouverte.error ? (
        <EmptyState
          title="Connexion impossible"
          description={ouverte.error.message}
          action={<Button onPress={nouvelleSession}>Réessayer</Button>}
        />
      ) : (
        <EmptyState title="Connexion…" description={`Ouverture d’une console dans ${cible.nom}.`} />
      )}
      {extrait ? <Analyse extrait={extrait} fermer={() => setExtrait(null)} /> : null}
    </Page>
  );
}
