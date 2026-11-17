CREATE TABLE outlook_regles (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  actif INTEGER NOT NULL DEFAULT 1,
  conditions TEXT NOT NULL,
  actions TEXT NOT NULL,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE outlook_journal (
  id TEXT PRIMARY KEY,
  regle_id TEXT,
  message_id TEXT,
  sujet TEXT,
  action TEXT NOT NULL,
  quand TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX outlook_journal_quand ON outlook_journal (quand);

CREATE TABLE outlook_reglages (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL
);

CREATE TABLE outlook_etat (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL,
  maj_le TEXT NOT NULL DEFAULT (datetime('now'))
);
