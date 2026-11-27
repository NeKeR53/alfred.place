## 2.0.2 — 2026-11-27

- Tableau de bord : chaque job est un bloc encadré plus compact. L’état et la barre d’avancement sont collés en bas du bloc, alignés d’un job à l’autre.
- Demande socle-ui 1.25.0 ou plus récente : mettre Alfred à jour avant d’accepter cette version.

## 2.0.1 — 2026-11-27

- Tableau de bord : chaque job suivi est une section de la grille de la page, sans carte, pour garder un bon contraste en thème clair.
- Échecs : liste des rapports avec le numéro de build et l'état écrits en texte.
- Mise en page alignée sur la dernière version de socle-ui.

## 2.0.0 — 2026-11-23

Les pages passent sur socle-ui, le design system d'Alfred : listes, panneaux, formulaires et états suivent les gabarits Socle. Demande un Alfred passé sur socle-ui (novembre 2026) ; un Alfred plus ancien garde la version précédente.

## 1.1.3 — 2026-11-19

- Le pied de carte n’utilise plus de style propre : il reste collé en bas avec un Alfred à jour (commit dcca9aa ou plus récent).

## 1.1.2 — 2026-11-19

- Le pied de chaque carte (état, numéro et durée du build, barre d’avancement) est collé en bas et aligné sur les cartes voisines, quelle que soit la version d’Alfred.
- Un job jamais lancé a une barre vide, comme les autres cartes.

## 1.1.1 — 2026-11-19

- La barre d’avancement s’affiche de nouveau sur chaque carte, verte pour un build réussi, quelle que soit la version d’Alfred.
- Le pied de la carte, avec l’état (« Réussi · il y a 3 heures ») et la barre, est collé tout en bas ; les pieds d’une rangée s’alignent avec un Alfred récent (commit dcca9aa).
- La carte est la même que celle de Prefect.

## 1.1.0 — 2026-11-19

- Tous les jobs sont trouvés, quelle que soit la profondeur des dossiers (dossiers, dossiers d’organisation, pipelines multibranches).
- La barre d’avancement est collée au bas de chaque carte.
- Le log d’un build s’ouvre dans une modale large.
- La barre d’avancement demande un Alfred récent (pied de Surface, commit 5ef42d7) : sur une version plus ancienne, elle ne s’affiche pas.

## 1.0.0 — 2026-11-19

Première publication
Tableau de bord des jobs Jenkins suivis : état en direct, logs et relance, en plusieurs vues.

