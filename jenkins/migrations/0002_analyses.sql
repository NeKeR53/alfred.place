-- Rapports d’analyse des builds Jenkins en échec : un par build.
CREATE TABLE jenkins_analyses (
  id TEXT PRIMARY KEY,
  instance TEXT NOT NULL DEFAULT '',
  job TEXT NOT NULL,
  build INTEGER NOT NULL,
  resultat TEXT,
  fini_le TEXT,
  url TEXT,
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
  analyse_le TEXT,
  UNIQUE (instance, job, build)
);

CREATE INDEX jenkins_analyses_cree ON jenkins_analyses (cree_le);
