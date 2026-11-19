CREATE TABLE jenkins_vues (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE jenkins_cartes (
  id TEXT PRIMARY KEY,
  vue_id TEXT NOT NULL REFERENCES jenkins_vues (id) ON DELETE CASCADE,
  instance TEXT NOT NULL DEFAULT '',
  job TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  ajoute_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (vue_id, instance, job)
);

CREATE INDEX jenkins_cartes_vue ON jenkins_cartes (vue_id, position);

INSERT INTO jenkins_vues (id, nom, position) VALUES ('principale', 'Principale', 0);
