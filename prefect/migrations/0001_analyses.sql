-- Rapports d’analyse des exécutions Prefect en échec : un par exécution (flow run).
CREATE TABLE prefect_analyses (
  execution TEXT PRIMARY KEY,
  instance TEXT NOT NULL DEFAULT '',
  deploiement_id TEXT,
  deploiement TEXT,
  flux TEXT,
  nom TEXT,
  etat TEXT,
  message TEXT,
  fini_le TEXT,
  statut TEXT NOT NULL DEFAULT 'en_cours',
  titre TEXT,
  cause TEXT,
  resume TEXT,
  categorie TEXT,
  certitude TEXT,
  pistes TEXT NOT NULL DEFAULT '[]',
  lignes TEXT NOT NULL DEFAULT '[]',
  erreur TEXT,
  lu INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  analyse_le TEXT
);

CREATE INDEX prefect_analyses_cree ON prefect_analyses (cree_le);
CREATE INDEX prefect_analyses_deploiement ON prefect_analyses (deploiement_id);
