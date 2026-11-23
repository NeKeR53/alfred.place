-- Règles Jira : des critères (ceux de la recherche, et au besoin une question tranchée sur l’ordinateur)
-- et l’action qui suit (lancer un agent avec une consigne, prévenir, commenter).
CREATE TABLE atlassian_regles (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  criteres TEXT NOT NULL DEFAULT '[]',
  question TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT 'agent',
  consigne TEXT NOT NULL DEFAULT '',
  automatique INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Réponse de la question d’une règle pour un ticket, gardée tant que ni le ticket ni la règle ne changent.
CREATE TABLE atlassian_regles_decisions (
  regle TEXT NOT NULL REFERENCES atlassian_regles (id) ON DELETE CASCADE,
  instance TEXT NOT NULL,
  cle TEXT NOT NULL,
  empreinte TEXT NOT NULL,
  oui INTEGER NOT NULL,
  confiance REAL NOT NULL,
  PRIMARY KEY (regle, instance, cle)
);

-- Ce qu’une règle a déjà fait pour un ticket : une règle n’agit qu’une fois par ticket.
CREATE TABLE atlassian_regles_executions (
  regle TEXT NOT NULL REFERENCES atlassian_regles (id) ON DELETE CASCADE,
  instance TEXT NOT NULL,
  cle TEXT NOT NULL,
  statut TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  quand TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (regle, instance, cle)
);
