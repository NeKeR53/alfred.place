-- Profils d’accès : ce qu’une personne doit avoir dans chaque environnement (groupes Keycloak, équipes Grafana).
CREATE TABLE atom_profils (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  groupes TEXT NOT NULL DEFAULT '[]',   -- chemins de groupes Keycloak, en JSON (["/ATOM/Développeurs"])
  equipes TEXT NOT NULL DEFAULT '[]',   -- noms d’équipes Grafana, en JSON (["ATOM"])
  modifie_le TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Personnes suivies par la page Accès et leurs profils.
CREATE TABLE atom_personnes (
  identifiant TEXT PRIMARY KEY,         -- identifiant de connexion Keycloak (lea.martin)
  nom TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  profils TEXT NOT NULL DEFAULT '[]',   -- identifiants de profils, en JSON
  modifie_le TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Équipes du projet, pour filtrer le tableau des tickets.
CREATE TABLE atom_equipes (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL UNIQUE
);
CREATE TABLE atom_equipe_membres (
  equipe TEXT NOT NULL REFERENCES atom_equipes (id) ON DELETE CASCADE,
  identifiant TEXT NOT NULL,
  nom TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (equipe, identifiant)
);

-- Réglages d’Atom (compte Jira du projet, projets suivis…).
CREATE TABLE atom_reglages (
  cle TEXT PRIMARY KEY,
  valeur TEXT NOT NULL
);
