// Démonstration de la page Projet : tickets Jira fictifs avec suivi du temps, rang partagé et historique, personnes
// des équipes avec leurs jours travaillés et leurs absences, disponibilités Outlook. Rien n’est lu ni écrit ailleurs.
// Les dates sont calculées depuis aujourd’hui, pour que le kanban et le planning soient toujours remplis.

const JOUR = 86_400_000;
const parisAujourdhui = () => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${v.year}-${v.month}-${v.day}`;
};
const date = (decalage: number) => new Date(Date.parse(`${parisAujourdhui()}T12:00:00Z`) + decalage * JOUR).toISOString().slice(0, 10);
const instant = (decalage: number, heure = "09:30") => `${date(decalage)}T${heure}:00.000+0100`;
/** Prochain jour de la semaine voulu (1 = lundi), à partir de dans `apres` jours. */
const prochain = (jour: number, apres = 1) => {
  for (let n = apres; n < apres + 8; n++) if (new Date(`${date(n)}T12:00:00Z`).getUTCDay() === jour) return n;
  return apres;
};

const PERSONNES: Record<string, { nom: string; email: string }> = {
  "hugo.bernard": { nom: "Hugo Bernard", email: "hugo.bernard@exemple.test" },
  "lea.martin": { nom: "Léa Martin", email: "lea.martin@exemple.test" },
  "nicolas.roux": { nom: "Nicolas Roux", email: "nicolas.roux@exemple.test" },
  "chloe.petit": { nom: "Chloé Petit", email: "chloe.petit@exemple.test" },
  "sophie.laurent": { nom: "Sophie Laurent", email: "sophie.laurent@exemple.test" },
};

/** Jours travaillés, présence et absences de chaque personne des équipes de démonstration. */
export function membreDemo(identifiant: string) {
  const mardi = prochain(2, 3);
  const lundi = prochain(1, 9);
  switch (identifiant) {
    case "lea.martin":
      return { jours: [1, 2, 3, 4, 5], absences: [{ from: date(mardi), to: date(mardi + 1) }], debut: "2025-09-01" };
    case "hugo.bernard":
      return { jours: [1, 2, 3, 4, 5], absences: [{ from: date(lundi), to: date(lundi), source: "calendar" }], debut: "2024-03-04" };
    case "nicolas.roux":
      return { jours: [1, 2, 3, 4], absences: [], debut: "2025-01-06" };
    case "chloe.petit":
      return { jours: [1, 2, 4, 5], absences: [{ from: date(prochain(5, 2)), to: date(prochain(5, 2)) }], debut: "2026-02-02", fin: date(60) };
    default:
      return { jours: [1, 2, 3, 4, 5], absences: [], debut: "1970-01-01" };
  }
}
/** Colonnes ajoutées par la migration 0003 pour une ligne de `atom_equipe_membres`. */
export function colonnesMembreDemo(identifiant: string) {
  const m = membreDemo(identifiant);
  return {
    keycloak: identifiant,
    debut: m.debut,
    fin: "fin" in m ? m.fin : "",
    jours: JSON.stringify(m.jours),
    absences: JSON.stringify(m.absences),
    comptes: JSON.stringify({ jira: identifiant }),
  };
}

type Ligne = [cle: string, titre: string, statut: string, categorie: string, type: string, priorite: string, assigne: string | null, estimation: number | null, restant: number | null, debut?: number];
// Estimation et reste à faire en jours de 8 h ; `debut` : passé en cours il y a n jours.
const ACTIFS: Ligne[] = [
  ["ATOM-101", "Connexion OIDC du portail en recette", "À faire", "new", "Story", "High", null, 2, 2],
  ["ATOM-102", "Écran de suivi des commandes", "À faire", "new", "Story", "Medium", "lea.martin", 3, 3],
  ["ATOM-103", "Purge des journaux du batch", "À faire", "new", "Task", "Low", null, null, null],
  ["ATOM-104", "Migration de la base vers la version 16", "En cours", "indeterminate", "Task", "High", "hugo.bernard", 5, 2.5, 4],
  ["ATOM-105", "Délai d’expiration de l’API trop court", "En cours", "indeterminate", "Bug", "Highest", "nicolas.roux", 1, 0.5, 1],
  ["ATOM-106", "Export CSV des accès", "En revue", "indeterminate", "Story", "Medium", "lea.martin", 2, 1, 3],
  ["ATOM-107", "Certificat SFTP du partenaire", "Suspendu", "indeterminate", "Task", "High", "chloe.petit", 1, 1, 6],
  ["ATOM-108", "Accès Grafana de l’équipe support", "En attente", "indeterminate", "Task", "Medium", "hugo.bernard", 1, 1, 2],
  ["ATOM-112", "Tableau de bord des absences", "À faire", "new", "Story", "Medium", "hugo.bernard", 2, 2],
  ["ATOM-113", "Relance des lots en échec", "À faire", "new", "Task", "High", "nicolas.roux", 1.5, 1.5],
  ["ATOM-114", "Journal d’audit des secrets", "À faire", "new", "Story", "Medium", "lea.martin", null, null],
  ["ATOM-115", "Mise à jour de Keycloak 26", "À faire", "new", "Task", "High", "sophie.laurent", 3, 3],
  ["ATOM-116", "Rotation des clés OpenBao", "À faire", "new", "Task", "Medium", "chloe.petit", 2, 2],
  ["ATOM-117", "Page de maintenance du portail", "À faire", "new", "Story", "Low", "lea.martin", 1, 1],
  ["ATOM-118", "Alertes de saturation des disques", "À faire", "new", "Task", "Medium", null, 1, 1],
];
const TERMINES: Ligne[] = [
  ["ATOM-109", "Page d’accueil du portail", "Terminé", "done", "Story", "Medium", "lea.martin", 3, 0, 12],
  ["ATOM-110", "Variables d’environnement manquantes en production", "Terminé", "done", "Bug", "High", "nicolas.roux", 1, 0, 9],
  ["ATOM-111", "Tableau de bord des conteneurs", "Terminé", "done", "Story", "Low", "hugo.bernard", 2, 0, 14],
  ["ATOM-099", "Sauvegarde nocturne de la base", "Clôturé", "done", "Task", "Medium", "hugo.bernard", 1, 0, 20],
];
/** Ordre du board (Rank) : l’ordre des lignes ci-dessus. */
const rang = (index: number) => `0|i000${String(index).padStart(2, "0")}:`;

function ticket(ligne: Ligne, index: number) {
  const [cle, titre, statut, statutCategorie, type, priorite, assigne, estimation, restant, debut] = ligne;
  const personne = assigne ? PERSONNES[assigne] : undefined;
  const cree = debut !== undefined ? debut + 3 : 5 + (index % 4);
  const historique = [
    { le: instant(-cree), statut: "À faire", statutCategorie: "new", assigneId: assigne },
    ...(debut !== undefined ? [{ le: instant(-debut, "10:15"), statut: "En cours", statutCategorie: "indeterminate" }] : []),
    ...(debut !== undefined && statut !== "En cours" ? [{ le: instant(statutCategorie === "done" ? -debut + 3 : -1, "16:40"), statut, statutCategorie }] : []),
  ];
  return {
    cle,
    id: String(10100 + index),
    instance: "demo-jira",
    titre,
    projet: "ATOM",
    projetNom: "Atom",
    type,
    priorite,
    statut,
    statutCategorie,
    assigne: personne?.nom ?? null,
    assigneId: assigne,
    assigneLogin: assigne,
    assigneEmail: personne?.email ?? null,
    echeance: null,
    misAJour: instant(-(index % 5), "08:00"),
    cree: instant(-cree),
    estimationSecondes: estimation === null ? null : estimation * 8 * 3600,
    restantSecondes: restant === null ? null : restant * 8 * 3600,
    rang: rang(index),
    url: null,
    historique,
  };
}

/** Disponibilités Outlook de démonstration : « Absent » le prochain mardi de Léa (comme ses absences saisies). */
function disponibilites(email: string, debut: string, jours: number) {
  const absents = new Set<string>();
  if (email.startsWith("lea.martin")) [prochain(2, 3), prochain(2, 3) + 1].forEach((n) => absents.add(date(n)));
  if (email.startsWith("hugo.bernard")) absents.add(date(prochain(1, 9)));
  let statuts = "";
  for (let n = 0; n < jours; n++) {
    const jour = new Date(Date.parse(`${debut}T12:00:00Z`) + n * JOUR).toISOString().slice(0, 10);
    statuts += absents.has(jour) ? "3".repeat(48) : `${"0".repeat(18)}${"2".repeat(4)}${"0".repeat(26)}`;
  }
  return { email, debut, jours, minutesParCreneau: 30, statuts };
}

/** Réponse d’une fonction pour la page Projet en démonstration ; `undefined` si elle ne la concerne pas. */
export function reponseDemoProjet(nom: string, entree: Record<string, unknown>): unknown {
  switch (nom) {
    case "atlassian/lire-suivi-temps":
      return { heuresParJour: 8, configure: true };
    case "atlassian/lister-tickets-projet": {
      if (entree.mode === "termines") {
        const debut = Number(entree.debut ?? 0);
        const limite = Number(entree.limite ?? 25);
        const page = TERMINES.map((ligne, index) => ticket(ligne, ACTIFS.length + index)).slice(debut, debut + limite);
        return { tickets: page, total: TERMINES.length, debut, limite, rangDisponible: true };
      }
      return { tickets: ACTIFS.map(ticket), total: ACTIFS.length, debut: 0, limite: 100, rangDisponible: true };
    }
    case "atlassian/lire-ticket": {
      const index = [...ACTIFS, ...TERMINES].findIndex(([cle]) => cle === entree.cle);
      if (index < 0) return { ticket: null };
      const ligne = [...ACTIFS, ...TERMINES][index];
      return {
        ticket: {
          ...ticket(ligne, index),
          description: `Ticket de démonstration : ${ligne[1].toLowerCase()}.\n\nCritères d’acceptation : vérifié en recette, documenté dans le guide d’exploitation.`,
          descriptionHtml: "",
          rapporteur: "Emma Durand",
          commentaires: ligne[9] !== undefined ? [{ id: "1", auteur: "Emma Durand", quand: instant(-1, "11:02"), texte: "Priorité confirmée au point d’équipe." }] : [],
          transitions: [
            { id: "11", nom: "À faire", vers: "À faire" },
            { id: "21", nom: "Démarrer", vers: "En cours" },
            { id: "41", nom: "Suspendre", vers: "Suspendu" },
            { id: "31", nom: "Terminer", vers: "Terminé" },
          ],
        },
      };
    }
    case "atlassian/lister-assignables": {
      const cherche = String(entree.recherche ?? "").toLowerCase();
      return {
        utilisateurs: Object.entries(PERSONNES)
          .filter(([id, p]) => !cherche || id.includes(cherche) || p.nom.toLowerCase().includes(cherche) || p.email === cherche)
          .map(([id, p]) => ({ id, nom: p.nom, email: p.email })),
      };
    }
    case "outlook/lire-disponibilites":
      return disponibilites(String(entree.email ?? ""), String(entree.debut ?? date(0)), Number(entree.jours ?? 120));
  }
  return undefined;
}
