// Démonstration d’Atom : un jeu de données fictif, tenu entièrement ici, pour voir les pages sans aucun compte.
// Rien n’est lu ni écrit chez un service, rien n’est écrit en base ; aucune valeur de secret n’existe (seuls les noms
// des clés sont montrés). Les identifiants portent tous le préfixe « demo- » et les courriels le domaine exemple.test.

import { colonnesMembreDemo, reponseDemoProjet } from "./demo-projet";
const ENVS = [
  { id: "demo-dev", nom: "Développement", code: "DEV", nature: "developpement", couleur: "steel" },
  { id: "demo-int", nom: "Intégration", code: "INT", nature: "integration", couleur: "blue" },
  { id: "demo-rec", nom: "Recette", code: "REC", nature: "recette", couleur: "violet" },
  { id: "demo-val", nom: "Validation", code: "VAL", nature: "validation", couleur: "green" },
  { id: "demo-pprod", nom: "Préproduction", code: "PPROD", nature: "preproduction", couleur: "orange" },
  { id: "demo-prod", nom: "Production", code: "PROD", nature: "production", couleur: "red" },
] as const;
type EnvId = (typeof ENVS)[number]["id"];
const OUTILS = ["keycloak", "grafana", "openbao", "portainer"] as const;
const LIBELLES: Record<string, string> = { keycloak: "Keycloak", grafana: "Grafana", openbao: "OpenBao", portainer: "Portainer" };
/** Instance d’un outil pour un environnement : « demo-rec » pour tous les outils de Recette. */
const envDe = (instance: unknown) => ENVS.find((env) => env.id === instance)?.id as EnvId | undefined;

// ------------------------------------------------------------------------------------------------ Base du module
const PROFILS = [
  { id: "demo-profil-dev", nom: "Développeur ATOM", description: "Développe et teste les applications", groupes: ["/ATOM/Développeurs"], equipes: ["ATOM"] },
  { id: "demo-profil-exploit", nom: "Exploitation", description: "Déploie et surveille", groupes: ["/ATOM/Exploitation"], equipes: ["Exploitation"] },
  { id: "demo-profil-support", nom: "Support", description: "Répond aux utilisateurs", groupes: ["/Support"], equipes: [] },
];
const PERSONNES = [
  { identifiant: "chloe.petit", nom: "Chloé Petit", email: "chloe.petit@exemple.test", profils: ["demo-profil-support"] },
  { identifiant: "emma.durand", nom: "Emma Durand", email: "emma.durand@exemple.test", profils: [] },
  { identifiant: "hugo.bernard", nom: "Hugo Bernard", email: "hugo.bernard@exemple.test", profils: ["demo-profil-dev", "demo-profil-exploit"] },
  { identifiant: "lea.martin", nom: "Léa Martin", email: "lea.martin@exemple.test", profils: ["demo-profil-dev"] },
  { identifiant: "nicolas.roux", nom: "Nicolas Roux", email: "nicolas.roux@exemple.test", profils: ["demo-profil-dev"] },
];
const EQUIPES = [
  { id: "demo-equipe-portail", nom: "Portail", membres: ["hugo.bernard", "lea.martin"] },
  { id: "demo-equipe-batch", nom: "Traitements", membres: ["nicolas.roux", "chloe.petit"] },
];
const REGLAGES = { "jira.compte": "demo-jira", "jira.projets": "ATOM", "secrets.ordre": "web,api,batch" };

/** Lignes d’une lecture de la base, d’après la table lue (toutes ses colonnes, dans l’ordre voulu par les pages). */
export function lignesDemo(sql: string): Record<string, unknown>[] {
  const table = sql.match(/\bFROM\s+(atom_\w+)/i)?.[1];
  switch (table) {
    case "atom_environnements":
      return ENVS.map((env, index) => ({ ...env, ordre: index + 1 }));
    case "atom_rattachements":
      return ENVS.flatMap((env) => OUTILS.map((outil) => ({ environnement: env.id, outil, instance: env.id })));
    case "atom_profils":
      return PROFILS.map((p) => ({ ...p, groupes: JSON.stringify(p.groupes), equipes: JSON.stringify(p.equipes) }));
    case "atom_personnes":
      return PERSONNES.map((p) => ({ ...p, profils: JSON.stringify(p.profils) }));
    case "atom_equipes":
      return EQUIPES.map(({ id, nom }) => ({ id, nom }));
    case "atom_equipe_membres":
      return EQUIPES.flatMap((equipe) =>
        equipe.membres.map((identifiant) => {
          const personne = PERSONNES.find((p) => p.identifiant === identifiant);
          return { equipe: equipe.id, identifiant, nom: personne?.nom ?? identifiant, email: personne?.email ?? "", ...colonnesMembreDemo(identifiant) };
        }),
      );
    case "atom_reglages":
      return Object.entries(REGLAGES).map(([cle, valeur]) => ({ cle, valeur }));
    default:
      return [];
  }
}

// ------------------------------------------------------------------------------------------------ Keycloak, Grafana
/** Groupes Keycloak de chaque personne, par environnement ; absente : pas de compte dans cet environnement. */
function groupesKeycloak(env: EnvId, identifiant: string): string[] | null {
  switch (identifiant) {
    case "hugo.bernard":
      return ["/ATOM/Développeurs", "/ATOM/Exploitation"];
    case "lea.martin":
      return env === "demo-rec" || env === "demo-dev" ? ["/ATOM/Développeurs"] : [];
    case "nicolas.roux":
      return ["demo-dev", "demo-int"].includes(env) ? ["/ATOM/Développeurs"] : env === "demo-prod" ? null : [];
    case "chloe.petit":
      return env === "demo-dev" ? null : ["/Support"];
    case "emma.durand":
      return ["/Support"];
    default:
      return null;
  }
}
const GRAFANA = [
  { id: 12, login: "lea.martin", email: "lea.martin@exemple.test" },
  { id: 15, login: "hugo.bernard", email: "hugo.bernard@exemple.test" },
  { id: 18, login: "chloe.petit", email: "chloe.petit@exemple.test" },
  { id: 21, login: "nicolas.roux", email: "nicolas.roux@exemple.test" },
];
const EQUIPES_GRAFANA = [
  { id: 3, nom: "ATOM" },
  { id: 7, nom: "Exploitation" },
];
function membresGrafana(env: EnvId, equipe: number) {
  if (equipe === 7) return [15];
  return env === "demo-pprod" || env === "demo-prod" ? [15, 21] : [12, 15, 21];
}

// ------------------------------------------------------------------------------------------------ OpenBao
/** Clés de chaque secret, par environnement : des manquantes en Validation, Préproduction et Production. */
function coffre(env: EnvId): Record<string, string[]> {
  const prod = env === "demo-prod";
  return {
    "atom/api/config": ["DB_PASSWORD", "DB_USER", ...(prod ? [] : ["JWT_SECRET"]), ...(env === "demo-dev" || env === "demo-int" ? ["REDIS_URL"] : [])],
    "atom/batch/config": ["SFTP_HOST", ...(env === "demo-val" ? [] : ["SFTP_KEY"])],
    "atom/web/config": ["OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", ...(prod || env === "demo-pprod" ? [] : ["SENTRY_DSN"])],
    // Secrets hérités par chaque composant (page Secrets, comme OneApp) : partagés par le produit, puis par l’environnement.
    "atom/shared/config": ["LOG_LEVEL"],
    "shared/config": ["SMTP_HOST"],
  };
}
function niveau(env: EnvId, chemin: string) {
  const prefixe = chemin ? `${chemin.replace(/\/$/, "")}/` : "";
  const dossiers = new Set<string>();
  const secrets = new Set<string>();
  for (const complet of Object.keys(coffre(env))) {
    if (!complet.startsWith(prefixe)) continue;
    const reste = complet.slice(prefixe.length).split("/");
    if (reste.length > 1) dossiers.add(reste[0]);
    else secrets.add(reste[0]);
  }
  return { dossiers: [...dossiers].sort(), secrets: [...secrets].sort() };
}

// ------------------------------------------------------------------------------------------------ Portainer
const il_y_a = (heures: number) => new Date(Date.now() - heures * 3_600_000).toISOString();
function conteneurs(env: EnvId) {
  const prod = env === "demo-prod";
  const liste = [
    { id: `${env}-web`, nom: "portail-web-1", image: `registre.exemple.test/atom/portail-web:${prod ? "2.4.0" : "2.4.1"}`, etat: "running", statut: "Up 2 days", pile: "portail", service: "web", creeLe: il_y_a(prod ? 220 : 46) },
    { id: `${env}-api`, nom: "portail-api-1", image: "registre.exemple.test/atom/portail-api:2.4.1", etat: env === "demo-rec" ? "restarting" : "running", statut: "Up 2 days", pile: "portail", service: "api", creeLe: il_y_a(46) },
    { id: `${env}-batch`, nom: "batch-1", image: "registre.exemple.test/atom/batch:1.2.0", etat: env === "demo-dev" ? "running" : "exited", statut: "Exited (0) 3 hours ago", pile: "batch", service: "batch", creeLe: il_y_a(3) },
  ];
  if (env !== "demo-dev")
    liste.push({ id: `${env}-agent`, nom: "supervision-agent-1", image: `registre.exemple.test/socle/agent:${env === "demo-int" ? "0.38" : "0.39"}`, etat: "running", statut: "Up 9 days", pile: "supervision", service: "agent", creeLe: il_y_a(216) });
  return liste;
}
function piles(env: EnvId) {
  return [
    { id: 12, nom: "portail", etat: "active", type: "compose", modifieLe: il_y_a(46), variables: ["TAG", "DB_PASSWORD"] },
    { id: 13, nom: "batch", etat: env === "demo-dev" ? "active" : "arretee", type: "compose", modifieLe: il_y_a(3), variables: [] },
    ...(env === "demo-dev" ? [] : [{ id: 14, nom: "supervision", etat: "active", type: "compose", modifieLe: il_y_a(216), variables: [] }]),
  ];
}

// ------------------------------------------------------------------------------------------------ Jira
const jours = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const TICKETS = [
  ["ATOM-101", "Connexion OIDC du portail en recette", "À faire", "new", "Story", "High", null, 5],
  ["ATOM-102", "Écran de suivi des commandes", "À faire", "new", "Story", "Medium", "Léa Martin", 12],
  ["ATOM-103", "Purge des journaux du batch", "À faire", "new", "Task", "Low", null, null],
  ["ATOM-104", "Migration de la base vers la version 16", "En cours", "indeterminate", "Task", "High", "Hugo Bernard", 3],
  ["ATOM-105", "Délai d’expiration de l’API trop court", "En cours", "indeterminate", "Bug", "Highest", "Nicolas Roux", 1],
  ["ATOM-106", "Export CSV des accès", "En revue", "indeterminate", "Story", "Medium", "Léa Martin", 7],
  ["ATOM-107", "Certificat SFTP du partenaire", "Bloqué", "indeterminate", "Task", "High", "Chloé Petit", -2],
  ["ATOM-108", "Accès Grafana de l’équipe support", "En attente", "indeterminate", "Task", "Medium", "Hugo Bernard", null],
  ["ATOM-109", "Page d’accueil du portail", "Terminé", "done", "Story", "Medium", "Léa Martin", null],
  ["ATOM-110", "Variables d’environnement manquantes en production", "Terminé", "done", "Bug", "High", "Nicolas Roux", null],
  ["ATOM-111", "Tableau de bord des conteneurs", "Terminé", "done", "Story", "Low", "Hugo Bernard", null],
] as const;
function tickets() {
  return TICKETS.map(([cle, titre, statut, statutCategorie, type, priorite, assigne, echeance], index) => ({
    cle,
    titre,
    statut,
    statutCategorie,
    type,
    priorite,
    assigne,
    assigneId: assigne ? PERSONNES.find((p) => p.nom === assigne)?.identifiant ?? null : null,
    echeance: echeance === null ? null : jours(echeance),
    projet: "ATOM",
    projetNom: "Atom",
    misAJour: il_y_a(index * 7 + 1),
    url: undefined,
    instance: "demo-jira",
  }));
}

// ------------------------------------------------------------------------------------------------ Fonctions
export const DEMO_LECTURE_SEULE = "Démonstration : rien n’est modifié. Quittez les données d’exemple (pastille « Exemple » de la barre du haut) pour agir sur les vrais services.";

/** Réponse d’une fonction de connecteur en démonstration ; une écriture est refusée. */
export function reponseDemo(nom: string, entree: Record<string, unknown>): unknown {
  const env = envDe(entree.instance);
  // Accès (page Accès) : comptes, groupes, attribut des profils, équipes et dossiers Grafana.
  const acces = reponseDemoAcces(nom, entree, env);
  if (acces !== undefined) return acces;
  // Projet (page Projet) : tickets avec suivi du temps, rang et historique ; disponibilités Outlook.
  const projet = reponseDemoProjet(nom, entree);
  if (projet !== undefined) return projet;
  const [outil, fonction] = nom.split("/");
  if (fonction === "lister-comptes")
    return { comptes: ENVS.map((e) => ({ id: e.id, label: `${LIBELLES[outil] ?? outil} ${e.nom} (démonstration)`, default: false })) };
  switch (nom) {
    case "atlassian/comptes-jira":
      return { comptes: [{ id: "demo-jira", label: "Jira (démonstration)" }] };
    case "atlassian/lister-tickets":
      return { tickets: tickets() };
    case "atlassian/lister-assignables":
      return { utilisateurs: PERSONNES.map((p) => ({ id: p.identifiant, nom: p.nom, email: p.email })) };
    case "atlassian/transitionner-ticket":
      if (entree.transition) break;
      return { transitions: [{ id: "11", nom: "À faire" }, { id: "21", nom: "En cours" }, { id: "31", nom: "Terminé" }] };
    case "keycloak/chercher-utilisateurs": {
      if (!env) return { utilisateurs: [] };
      const cherche = String(entree.email ?? entree.recherche ?? "").toLowerCase();
      return {
        utilisateurs: PERSONNES.filter((p) => groupesKeycloak(env, p.identifiant) !== null)
          .filter((p) => !cherche || p.email === cherche || p.identifiant.includes(cherche) || p.nom.toLowerCase().includes(cherche))
          .map((p) => ({ id: `demo-kc-${p.identifiant}`, identifiant: p.identifiant, email: p.email, prenom: p.nom.split(" ")[0], nom: p.nom.split(" ").slice(1).join(" "), actif: true })),
      };
    }
    case "keycloak/lister-groupes-utilisateur": {
      const identifiant = String(entree.utilisateur ?? "").replace(/^demo-kc-/, "");
      return { groupes: (env ? (groupesKeycloak(env, identifiant) ?? []) : []).map((chemin) => ({ id: `demo-g${chemin}`, nom: chemin.split("/").pop(), chemin })) };
    }
    case "keycloak/lire-groupe-par-chemin":
      return { groupe: { id: `demo-g${entree.chemin}`, nom: String(entree.chemin).split("/").pop(), chemin: entree.chemin } };
    case "grafana/lister-utilisateurs":
      return { utilisateurs: env ? GRAFANA.filter((u) => !(env === "demo-dev" && u.login === "chloe.petit")) : [] };
    case "grafana/lister-equipes":
      return { equipes: EQUIPES_GRAFANA };
    case "grafana/lister-membres-equipe":
      return { membres: env ? membresGrafana(env, Number(entree.equipe)).map((id) => ({ id })) : [] };
    case "openbao/lister-dossier":
      return env ? niveau(env, String(entree.chemin ?? "")) : { dossiers: [], secrets: [] };
    case "openbao/lire-secret": {
      const chemin = String(entree.chemin ?? "");
      const cles = env ? (coffre(env)[chemin] ?? []) : [];
      // Aucune valeur, même fictive : la démonstration ne montre que les noms des clés.
      return { chemin, trouve: cles.length > 0, version: cles.length ? 3 : 0, cles, valeurs: {} };
    }
    case "portainer/lister-conteneurs":
      return { conteneurs: env ? conteneurs(env).map((c) => ({ ...c, url: urlDemo(env, c.service) })) : [] };
    case "portainer/lister-piles":
      return { piles: env ? piles(env) : [] };
    case "portainer/suivre-journal":
      return { canal: null };
  }
  throw new Error(DEMO_LECTURE_SEULE);
}

// ------------------------------------------------------------------------------------------------ Accès
// Le profil de chaque personne est enregistré sur son compte Keycloak (attribut « oneapp-profils », par nom), comme
// le fait OneApp ; Emma Durand n’en a aucun (« Sans profil »). Le dossier Grafana « Exploitation » n’existe pas et,
// en Validation, l’équipe ATOM n’a pas de droit sur le sien : la page signale ces éléments de configuration.
const nomProfil = (id: string) => PROFILS.find((p) => p.id === id)?.nom ?? id;
function compteDemo(p: (typeof PERSONNES)[number]) {
  return {
    id: `demo-kc-${p.identifiant}`,
    identifiant: p.identifiant,
    email: p.email,
    prenom: p.nom.split(" ")[0],
    nom: p.nom.split(" ").slice(1).join(" "),
    actif: true,
    creeLe: null,
    attributs: p.profils.length ? { "oneapp-profils": p.profils.map(nomProfil) } : {},
  };
}
const groupeDemo = (chemin: string) => ({ id: `demo-g${chemin}`, nom: chemin.split("/").pop() ?? chemin, chemin, attributs: {} });
const DOSSIERS_GRAFANA = [{ uid: "demo-dossier-atom", titre: "ATOM" }];

function reponseDemoAcces(nom: string, entree: Record<string, unknown>, env: EnvId | undefined): unknown {
  const avecCompte = env ? PERSONNES.filter((p) => groupesKeycloak(env, p.identifiant) !== null) : [];
  switch (nom) {
    case "keycloak/lire-groupes-par-chemins": {
      const chemins = Array.isArray(entree.chemins) ? entree.chemins.map(String) : [];
      return {
        groupes: chemins.map((chemin) => ({
          chemin,
          groupe: groupeDemo(chemin),
          membres: env ? avecCompte.filter((p) => (groupesKeycloak(env, p.identifiant) ?? []).includes(chemin)).map(compteDemo) : [],
        })),
      };
    }
    case "keycloak/chercher-par-attribut":
      return { utilisateurs: avecCompte.filter((p) => p.profils.map(nomProfil).includes(String(entree.valeur ?? ""))).map(compteDemo) };
    case "keycloak/lire-utilisateur": {
      const cherche = String(entree.utilisateur ?? "").replace(/^demo-kc-/, "") || String(entree.identifiant ?? "").toLowerCase();
      const email = String(entree.email ?? "").toLowerCase();
      const p = avecCompte.find((item) => (email ? item.email === email : item.identifiant === cherche));
      if (!p) return { utilisateur: null, ...(entree.groupes ? { groupes: [] } : {}) };
      return {
        utilisateur: compteDemo(p),
        ...(entree.groupes && env ? { groupes: (groupesKeycloak(env, p.identifiant) ?? []).map(groupeDemo) } : {}),
      };
    }
    case "grafana/lister-dossiers":
      return { dossiers: DOSSIERS_GRAFANA };
    case "grafana/lister-droits-dossier":
      return { droits: env === "demo-val" ? [] : [{ equipe: { id: 3, nom: "ATOM" }, utilisateur: null, role: null, droit: 2, libelle: "Modification" }] };
    case "grafana/lister-equipes-utilisateur": {
      const compte = Number(entree.utilisateur);
      return { equipes: env ? EQUIPES_GRAFANA.filter((e) => membresGrafana(env, e.id).includes(compte)).map((e) => ({ ...e, email: "", membres: 0 })) : [] };
    }
  }
  return undefined;
}

// ------------------------------------------------------------------------------------------------ Usine : outils
/** Adresse fictive de l’application d’un service (domaine réservé exemple.test : rien n’est ouvert). */
function urlDemo(env: EnvId, service: string) {
  const code = ENVS.find((e) => e.id === env)?.code.toLowerCase() ?? "dev";
  return service === "web" ? `https://${code}.atom.exemple.test/portail/` : service === "api" ? `https://${code}.atom.exemple.test/api/` : null;
}

const MESSAGES_JOURNAL: Record<string, [niveau: string, texte: string][]> = {
  web: [
    ["INFO", "GET /portail/ 200 12ms"],
    ["INFO", "GET /portail/assets/app.js 304 2ms"],
    ["INFO", "GET /portail/api/session 200 38ms"],
    ["WARN", "Lenteur du service amont /api/commandes : 1 240 ms"],
    ["INFO", "POST /portail/api/panier 201 54ms"],
    ["ERROR", "Échec de l’appel /api/commandes : délai dépassé (5 000 ms)"],
  ],
  api: [
    ["INFO", "Requête GET /api/commandes?page=2 traitée en 41 ms"],
    ["INFO", "Pool de connexions : 7 actives / 20"],
    ["WARN", "Requête lente sur commandes (812 ms)"],
    ["INFO", "Jeton OIDC validé pour lea.martin"],
    ["ERROR", "java.lang.IllegalStateException: transaction déjà close"],
    ["INFO", "GET /api/health 200"],
  ],
};
const MESSAGES_PAR_DEFAUT: [string, string][] = [
  ["INFO", "Tâche planifiée terminée"],
  ["INFO", "Lecture de la file : 0 message"],
  ["WARN", "Disque à 82 %"],
  ["INFO", "Battement de cœur envoyé"],
];

/**
 * Ligne `n` du faux journal d’un service, horodatée comme `docker logs --timestamps` : surtout des infos, quelques
 * alertes et erreurs, pour voir les niveaux du lecteur de journal.
 */
export function ligneJournalDemo(service: string, n: number, quand = new Date()): string {
  const messages = MESSAGES_JOURNAL[service] ?? MESSAGES_PAR_DEFAUT;
  const [niveau, texte] = messages[(n * 7 + Math.floor(n / 3)) % messages.length];
  return `${quand.toISOString()} ${niveau.padEnd(5)} [${service}] ${texte}`;
}

/** Les `lignes` dernières lignes du faux journal, la dernière écrite maintenant, une toutes les 1,2 s avant. */
export function journalDemo(service: string, lignes: number): string[] {
  const maintenant = Date.now();
  return Array.from({ length: lignes }, (_, index) => ligneJournalDemo(service, index, new Date(maintenant - (lignes - index) * 1_200)));
}

/**
 * Fausse console d’un conteneur : un petit shell local qui répond à quelques commandes. Rien n’est envoyé à un
 * conteneur ; `ecrire` reçoit ce qu’il faut afficher.
 */
export function consoleDemo(options: { nom: string; shell: "bash" | "sh"; utilisateur?: string }, ecrire: (texte: string) => void) {
  const utilisateur = options.utilisateur?.trim() || "app";
  const hote = options.nom.replace(/[^a-z0-9-]/gi, "").slice(0, 63) || "conteneur";
  let dossier = "/app";
  let saisie = "";
  const invite = () => ecrire(`\x1b[32m${utilisateur}@${hote}\x1b[0m:\x1b[34m${dossier}\x1b[0m${utilisateur === "root" ? "#" : "$"} `);
  const fichiers: Record<string, string[]> = {
    "/app": ["config", "logs", "package.json", "server.js"],
    "/app/config": ["application.yml"],
    "/app/logs": ["app.log"],
    "/": ["app", "bin", "etc", "tmp", "usr", "var"],
  };
  const executer = (ligne: string) => {
    const [commande, ...args] = ligne.trim().split(/\s+/);
    switch (commande) {
      case undefined:
      case "":
        break;
      case "pwd":
        ecrire(`${dossier}\r\n`);
        break;
      case "whoami":
        ecrire(`${utilisateur}\r\n`);
        break;
      case "hostname":
        ecrire(`${hote}\r\n`);
        break;
      case "ls":
        ecrire(`${(fichiers[args.find((a) => !a.startsWith("-")) ?? dossier] ?? []).join("  ")}\r\n`);
        break;
      case "cd": {
        const cible = args[0] === ".." ? dossier.split("/").slice(0, -1).join("/") || "/" : args[0]?.startsWith("/") ? args[0] : `${dossier}/${args[0] ?? ""}`.replace(/\/+$/, "");
        if (!args[0]) dossier = "/app";
        else if (fichiers[cible]) dossier = cible;
        else ecrire(`${options.shell}: cd: ${args[0]}: No such file or directory\r\n`);
        break;
      }
      case "echo":
        ecrire(`${args.join(" ")}\r\n`);
        break;
      case "env":
        ecrire(`HOSTNAME=${hote}\r\nNODE_ENV=production\r\nTZ=Europe/Paris\r\nTERM=xterm-256color\r\n`);
        break;
      case "ps":
        ecrire("PID   USER     TIME  COMMAND\r\n    1 app       0:42 node server.js\r\n   57 app       0:00 sh\r\n");
        break;
      case "cat":
        if (args[0]?.endsWith("application.yml")) ecrire("server:\r\n  port: 8080\r\nlogging:\r\n  level: INFO\r\n");
        else ecrire(`cat: ${args[0] ?? ""}: No such file or directory\r\n`);
        break;
      case "clear":
        ecrire("\x1b[2J\x1b[H");
        break;
      case "exit":
        return false;
      default:
        ecrire(`${options.shell}: ${commande}: command not found\r\n`);
    }
    return true;
  };
  ecrire(`\x1b[2m[Démonstration : aucune commande n’est envoyée à un conteneur. Essayez ls, pwd, env, ps, exit.]\x1b[0m\r\n`);
  invite();
  return {
    /** Ce que tape l’utilisateur ; rend faux quand la session se termine (`exit`). */
    envoyer(donnees: string): boolean {
      for (const caractere of donnees) {
        if (caractere === "\r") {
          ecrire("\r\n");
          const suite = executer(saisie);
          saisie = "";
          if (!suite) return false;
          invite();
        } else if (caractere === "\u007f") {
          if (saisie) {
            saisie = saisie.slice(0, -1);
            ecrire("\b \b");
          }
        } else if (caractere === "\u0003") {
          saisie = "";
          ecrire("^C\r\n");
          invite();
        } else if (caractere >= " ") {
          saisie += caractere;
          ecrire(caractere);
        }
      }
      return true;
    },
  };
}
