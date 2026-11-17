CREATE TABLE atlassian_filtres (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  instance TEXT NOT NULL,
  nom TEXT NOT NULL,
  requete TEXT NOT NULL,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX atlassian_filtres_unique ON atlassian_filtres (service, instance, nom);

CREATE TABLE atlassian_favoris (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  instance TEXT NOT NULL,
  genre TEXT NOT NULL,
  cle TEXT NOT NULL,
  libelle TEXT NOT NULL,
  contexte TEXT,
  url TEXT,
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX atlassian_favoris_unique ON atlassian_favoris (service, instance, genre, cle);

CREATE TABLE atlassian_reglages (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL
);
