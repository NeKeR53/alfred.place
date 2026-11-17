# alfred.place

Marketplace de modules pour [Alfred](https://github.com/NeKeR53/alfred) : un catalogue de modules partagé, que l’on branche dans Alfred pour importer ses modules dans un espace de travail.

Le catalogue démarre vide.

## Forme du dépôt

Un marketplace d’Alfred est un dépôt git ordinaire, sans fichier d’index : **chaque dossier à la racine qui contient un `module.json` est un module proposé**. Le nom du dossier est l’identifiant du module (minuscules, chiffres et tirets, 64 caractères au plus).

```
alfred.place/
├── README.md
├── crm/                 ← un module
│   ├── module.json      ← son manifeste (name, version, description, pages, functions, clients…)
│   ├── CHANGELOG.md     ← notes de version, tenues par Alfred à chaque publication
│   ├── pages/
│   └── functions/
└── …
```

Le reste de la racine (ce README, `.gitignore`) est ignoré par Alfred. La racine ne doit pas contenir `alfred.json` : ce serait un espace de travail, et Alfred refuserait la source.

## Brancher ce marketplace dans Alfred

1. Ouvrir **Réglages → Marketplace**, puis **Ajouter un marketplace**.
2. Coller l’adresse git : `https://github.com/NeKeR53/alfred.place.git`.
3. Valider : Alfred clone le dépôt dans ses données et affiche ses modules dans « Modules disponibles ».

Le dépôt est privé : Alfred utilise les identifiants git déjà configurés sur le poste (ici `gh auth git-credential`). Ne jamais mettre de jeton dans l’adresse, Alfred la refuse.

## Ajouter un module

**Depuis Alfred (recommandé).** Développer et valider le module dans un espace de travail, puis **Réglages → Modules**, menu « … » du module → **Publier…**. Choisir ce marketplace, la version (strictement supérieure à celle déjà publiée) et les notes de version. Alfred copie le dossier du module, retire ce qui ne concerne que le poste (`origin`, `published`), met à jour `CHANGELOG.md`, commite sous votre identité git et pousse sur la branche par défaut.

**À la main.** Copier le dossier du module à la racine sous son identifiant, vérifier que `module.json` porte `name`, `version` (`1.0.0`) et `description`, et qu’il ne contient ni `origin` ni `published`, puis commiter et pousser sur `main`. Dans Alfred, **Vérifier les marketplaces** fait apparaître le module.

## Mettre à jour un module

Republier une version supérieure. Les espaces de travail qui l’ont importé voient la mise à jour, avec ses notes, et l’acceptent ou non ; rien n’est remplacé sans accord.
