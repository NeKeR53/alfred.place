## 1.0.3 — 2026-11-27

- Support : la liste des demandes ne tombe plus en erreur quand un centre de services visible par l’API du support est un projet que la recherche de Jira ne vous laisse pas parcourir (Jira répondait 400 « does not exist for the field ’project’ »).

## 1.0.2 — 2026-11-27

- Jira : chaque champ du ticket ouvert se modifie sur place, dans la colonne de droite ; les tickets s'ouvrent dans des onglets.
- Bitbucket : une pull request s'ouvre dans une fenêtre (description, revue et analyse par l'agent) ; colonne « À propos » du dépôt ouvert.
- Les recherches gardent leur texte et leurs filtres d'une visite à l'autre.
- Les pages lisent les états partagés du module et se relisent après une écriture.
- Mise en page alignée sur la dernière version de socle-ui.

## 1.0.1 — 2026-11-24

- Panneau Détails du ticket : chaque champ se lit en texte et se modifie par l’action de sa ligne : un menu pour une liste, un choix multiple ou le sprint ; une fenêtre pour un texte, une date, un nombre, une personne ou des étiquettes. Le changement est enregistré aussitôt dans Jira, comme avant.
- L’en-tête du panneau nomme le ticket (clé et titre), avec son état, son type et son projet.

## 1.0.0 — 2026-11-23

Les pages passent sur socle-ui, le design system d'Alfred : listes, panneaux, formulaires et états suivent les gabarits Socle. Demande un Alfred passé sur socle-ui (novembre 2026) ; un Alfred plus ancien garde la version précédente.

## 0.1.0 — 2026-11-17

