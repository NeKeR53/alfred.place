-- Criticité des tickets Jira, jugée sur l’ordinateur (décision locale), gardée tant que le ticket ne change pas.
CREATE TABLE atlassian_criticite (
  instance TEXT NOT NULL,
  cle TEXT NOT NULL,
  empreinte TEXT NOT NULL,
  niveau TEXT NOT NULL,
  confiance REAL NOT NULL,
  urgent INTEGER NOT NULL DEFAULT 0,
  bloquant INTEGER NOT NULL DEFAULT 0,
  frustration INTEGER NOT NULL DEFAULT 0,
  evalue_le TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (instance, cle)
);

-- Risque des pull requests Bitbucket, jugé de la même façon.
CREATE TABLE atlassian_risque_pr (
  instance TEXT NOT NULL,
  cle TEXT NOT NULL,
  empreinte TEXT NOT NULL,
  niveau TEXT NOT NULL,
  confiance REAL NOT NULL,
  evalue_le TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (instance, cle)
);

-- Pages Confluence déjà lues, gardées en texte pour la recherche par le sens.
CREATE TABLE atlassian_pages_lues (
  id TEXT PRIMARY KEY,
  instance TEXT NOT NULL,
  page_id TEXT NOT NULL,
  titre TEXT NOT NULL,
  espace TEXT NOT NULL DEFAULT '',
  texte TEXT NOT NULL DEFAULT '',
  lu_le TEXT NOT NULL DEFAULT (datetime('now'))
);
