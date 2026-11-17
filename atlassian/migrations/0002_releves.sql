-- Éléments déjà signalés par les relevés (tickets assignés, pull requests, demandes), pour ne prévenir qu’une fois.
CREATE TABLE atlassian_vus (
  service TEXT NOT NULL,
  instance TEXT NOT NULL,
  cle TEXT NOT NULL,
  vu_le TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (service, instance, cle)
);
