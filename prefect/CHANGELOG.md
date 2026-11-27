## 2.0.3 — 2026-11-27

- Déploiements : chaque déploiement est un bloc encadré plus compact. L’état et la barre d’avancement sont collés en bas du bloc, alignés d’un déploiement à l’autre.
- Demande socle-ui 1.25.0 ou plus récente : mettre Alfred à jour avant d’accepter cette version.

## 2.0.2 — 2026-11-27

- Déploiements : chaque déploiement est une section de la grille de la page, sans carte, pour garder un bon contraste au changement de thème.
- Les déploiements et leurs exécutions sont des états partagés : la page suit chaque changement, et l'avancement bouge pendant une exécution.
- Échecs : une liste plutôt qu'un tableau, pour lire le nom complet du déploiement même dans une fenêtre étroite.
- Mise en page alignée sur la dernière version de socle-ui.

## 2.0.1 — 2026-11-24

- Panneau Historique : le filtre des exécutions par état est une ligne « État », dont le menu propose les états.

## 2.0.0 — 2026-11-23

Les pages passent sur socle-ui, le design system d'Alfred : listes, panneaux, formulaires et états suivent les gabarits Socle. Demande un Alfred passé sur socle-ui (novembre 2026) ; un Alfred plus ancien garde la version précédente.

## 1.2.5 — 2026-11-19

- Un clic sur une carte de déploiement, en dehors de ses boutons, ouvre son détail et son historique dans le panneau de droite ; la carte ouverte est marquée. Entrée et Espace font de même au clavier.
- Demande un Alfred récent (commit 595054f) : sur une version plus ancienne, la carte n’est pas cliquable, « Voir l’historique » du menu « ⋯ » reste disponible.

## 1.2.4 — 2026-11-19

- La carte d’un déploiement est plus courte : titre, actions, état et dernière exécution avec sa barre.
- La planification, le bilan des exécutions précédentes et la prochaine exécution prévue sont dans le bloc « Détail » du panneau Historique.
- Le pied de carte reste collé en bas avec un Alfred à jour (commit dcca9aa ou plus récent).

## 1.2.3 — 2026-11-19

- Le pied de chaque carte (état, dernière exécution et durée, barre d’avancement) est collé en bas et aligné sur les cartes voisines, quelle que soit la version d’Alfred.
- Un déploiement jamais lancé a une barre vide, comme les autres cartes.

## 1.2.2 — 2026-11-19

- Tous les déploiements du compte s’affichent, même au-delà de 200 : la liste est lue page par page.
- L’état de chaque déploiement est lu, pas seulement celui des 60 premiers ; les filtres En échec, En cours et Suspendus les voient tous.
- Les déploiements suspendus, jamais lancés ou portant le même nom dans deux flows restent dans la liste.

## 1.2.1 — 2026-11-19

- La carte d’un déploiement est exactement celle de Jenkins : mêmes boutons, même pied collé en bas avec l’état et la barre d’avancement (alignement avec un Alfred récent, commit dcca9aa).
- Plus aucun extrait de log ni message d’échec dans la carte : ils s’ouvrent seulement dans la modale des logs.

## 1.2.0 — 2026-11-19

- La carte d’un déploiement reprend celle de Jenkins, avec la barre d’avancement collée au bas de la carte.
- Les logs, tâches et détails d’une exécution s’ouvrent dans une modale large, y compris depuis l’historique.
- Le panneau Historique reste fermé jusqu’à ce que vous ouvriez l’historique d’une carte.
- La recherche ignore les accents et la casse.
- La barre d’avancement demande un Alfred récent (pied de Surface, commit 5ef42d7) : sur une version plus ancienne, elle ne s’affiche pas.

## 1.1.0 — 2026-11-19

Un onglet par compte Prefect : la section garde une seule entrée au menu et chaque compte y a son onglet ; le panneau Historique suit le compte de l’onglet.

## 1.0.0 — 2026-11-19

Première publication
Déploiements Prefect en cartes : dernière exécution, lancement, historique, tâches et logs.

