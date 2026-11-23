-- Points d’entrée : les catégories entre lesquelles chaque message est classé par la décision locale.
CREATE TABLE outlook_points_entree (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  dossier TEXT NOT NULL DEFAULT '',
  actif INTEGER NOT NULL DEFAULT 1,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  maj_le TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Classement de chaque message, gardé tant que la liste des points d’entrée ne change pas (signature).
CREATE TABLE outlook_classements (
  message_id TEXT PRIMARY KEY,
  point_id TEXT,
  certitude REAL NOT NULL DEFAULT 0,
  statut TEXT NOT NULL,
  signature TEXT NOT NULL,
  classe_le TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX outlook_classements_point ON outlook_classements (point_id);
