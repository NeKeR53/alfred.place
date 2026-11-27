-- Projet, comme la page Projets de OneApp : chaque personne d’une équipe a sa période de présence, ses jours
-- travaillés, ses absences et ses comptes reliés (Jira). L’ordre local, la date de départ du planning, l’équipe
-- affichée et le passé du planning vont dans atom_reglages (clés projet.*), le reste (responsable, colonne,
-- durées, Rank) reste dans Jira.
ALTER TABLE atom_equipe_membres ADD COLUMN keycloak TEXT NOT NULL DEFAULT '';            -- identifiant Keycloak ('' : ajoutée par son seul nom)
ALTER TABLE atom_equipe_membres ADD COLUMN debut TEXT NOT NULL DEFAULT '1970-01-01';     -- présence à partir du (AAAA-MM-JJ)
ALTER TABLE atom_equipe_membres ADD COLUMN fin TEXT NOT NULL DEFAULT '';                 -- jusqu’au ('' : sans fin)
ALTER TABLE atom_equipe_membres ADD COLUMN jours TEXT NOT NULL DEFAULT '[1,2,3,4,5]';    -- jours travaillés (0 = dimanche), JSON
ALTER TABLE atom_equipe_membres ADD COLUMN absences TEXT NOT NULL DEFAULT '[]';          -- [{ "from", "to", "source"? }], JSON
ALTER TABLE atom_equipe_membres ADD COLUMN comptes TEXT NOT NULL DEFAULT '{}';           -- { "jira": "identifiant Jira" }, JSON
UPDATE atom_equipe_membres SET keycloak = identifiant;
