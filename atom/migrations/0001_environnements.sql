-- Environnements d’Atom et, pour chacun, le compte de chaque outil (Keycloak, Grafana, OpenBao, Portainer).
CREATE TABLE atom_environnements (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  code TEXT NOT NULL,
  nature TEXT NOT NULL DEFAULT 'integration'
    CHECK (nature IN ('developpement', 'integration', 'recette', 'validation', 'preproduction', 'production')),
  couleur TEXT NOT NULL DEFAULT 'steel'
    CHECK (couleur IN ('steel', 'blue', 'violet', 'pink', 'red', 'orange', 'green', 'teal')),
  ordre INTEGER NOT NULL,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  modifie_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX atom_environnements_code ON atom_environnements (code);
CREATE INDEX atom_environnements_ordre ON atom_environnements (ordre);

-- Un compte par outil et par environnement : `instance` est l’identifiant d’instance du client de l’outil.
CREATE TABLE atom_rattachements (
  environnement TEXT NOT NULL REFERENCES atom_environnements (id) ON DELETE CASCADE,
  outil TEXT NOT NULL CHECK (outil IN ('keycloak', 'grafana', 'openbao', 'portainer')),
  instance TEXT NOT NULL,
  modifie_le TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (environnement, outil)
);

INSERT INTO atom_environnements (id, nom, code, nature, couleur, ordre) VALUES
  ('dev', 'Développement', 'DEV', 'developpement', 'steel', 1),
  ('int', 'Intégration', 'INT', 'integration', 'blue', 2),
  ('rec', 'Recette', 'REC', 'recette', 'violet', 3),
  ('val', 'Validation', 'VAL', 'validation', 'teal', 4),
  ('preprod', 'Préproduction', 'PPROD', 'preproduction', 'orange', 5),
  ('prod', 'Production', 'PROD', 'production', 'red', 6);
