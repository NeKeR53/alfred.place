-- Lecture des messages par la décision locale (hameçonnage, urgence, réponse attendue), gardée par message.
CREATE TABLE outlook_analyses (
  id TEXT PRIMARY KEY,
  categorie TEXT NOT NULL DEFAULT '',
  hameconnage INTEGER NOT NULL DEFAULT 0,
  indesirable INTEGER NOT NULL DEFAULT 0,
  urgent INTEGER NOT NULL DEFAULT 0,
  reponse_attendue INTEGER NOT NULL DEFAULT 0,
  analyse_le TEXT NOT NULL DEFAULT (datetime('now'))
);
