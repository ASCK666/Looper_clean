# Reprise — suppression de la vitre de cassette

Date du constat : 2026-09-14

## Objectif

Supprimer uniquement l'apparence de la petite vitre et de son cadre dans la fenêtre centrale de la cassette.

Tout le reste doit rester strictement identique à la branche `120927` :

- corps et étiquettes de la cassette ;
- fond noir de l'habitacle ;
- bandes magnétiques ;
- images, dimensions et positions des deux bobines ;
- animation des bobines ;
- reste de l'interface et du lecteur.

Aucune grande vitre ne doit être ajoutée dans cette étape.

## État de référence

- Dépôt : `ASCK666/Looper_clean`
- Branche de référence : `120927`
- Commit de référence : `57a06681d6989399e9ace0a938ec648907e602b0`
- Branche de travail : `final-cassette`

La branche de travail a d'abord été replacée exactement au commit de référence. Une seule modification a ensuite été appliquée.

## État actuel de la branche de travail

Commit de travail :

`33e8c26344a437e5d4c2c5adb8cb60c97218a553`

Comparaison avec `120927` avant l'ajout du présent document :

- 1 commit d'avance ;
- 0 commit de retard ;
- un seul fichier de production modifié : `css/looper.css` ;
- 13 ajouts et 2 suppressions dans ce fichier ;
- aucun changement dans le HTML, le JavaScript ou les assets.

La modification actuelle applique un masque alpha uniquement à `.cassetteTape`. Le masque retire au rendu la zone rectangulaire contenant la vitre centrale dessinée dans `cassette.webp`.

## Éléments explicitement inchangés

- `assets/looper-ui/120927/cassette.webp`
- `assets/looper-ui/120927/reel-animation.webp`
- positions des bobines :
  - gauche : `left: 20.46%; top: 32.06%`
  - droite : `left: 62.53%; top: 32.06%`
- animation : `looperReelSpin`
- durée gauche : `2.91s`
- durée droite : `1.46s`
- état lecture/pause et logique JavaScript.

Il n'existe plus d'élément HTML `.cassetteGlass` dans cet état.

## Ce qui reste à valider

Le commit `33e8c263` n'a pas encore reçu de validation visuelle en navigateur, car le navigateur de travail est devenu indisponible après le commit.

La présence correcte du CSS ne suffit pas à valider le résultat. Il reste à vérifier :

- disparition complète du cadre/vitrage central ;
- absence de morceau résiduel sur les quatre bords ;
- absence de découpe sur les bobines ;
- fond d'habitacle visible derrière la zone retirée ;
- bandes toujours visibles et correctement alignées ;
- aucune apparition de la table ;
- cohérence au format réel, pas uniquement en zoom ;
- animation visuellement inchangée.

## Plan d'action de reprise

1. Ne pas fusionner la branche tant que le contrôle navigateur n'est pas terminé.
2. Ouvrir la référence `120927` et le commit exact `33e8c263` dans le même navigateur et avec la même taille de fenêtre.
3. Capturer une vue complète du lecteur puis un gros plan strictement cadré sur la cassette.
4. Comparer les deux rendus :
   - toute différence hors de la fenêtre centrale est un échec ;
   - les bobines doivent avoir exactement la même taille et la même position.
5. Inspecter le DOM et les styles calculés :
   - `.cassetteGlass` doit avoir un compteur égal à zéro ;
   - le masque doit être appliqué uniquement à `.cassetteTape`.
6. Tester l'état animé :
   - vérifier le nom et les deux durées d'animation ;
   - observer plusieurs instants de rotation ;
   - confirmer qu'aucune zone transparente ne montre la table.
7. Si le masque est mal aligné, modifier uniquement ses quatre limites dans `css/looper.css`, puis recommencer les étapes 2 à 6.
8. Ne pas régénérer `cassette.webp` avec un outil génératif : cela risquerait de modifier d'autres pixels.
9. Après validation visuelle, conserver un dernier diff prouvant que seuls le masque ciblé et ce document de reprise diffèrent de `120927`.
10. Fusionner ou reprendre le commit uniquement après accord explicite sur les captures navigateur.

## Critères d'acceptation

La tâche est terminée uniquement si :

- la petite vitre centrale et son cadre ne sont plus visibles ;
- l'habitacle et les bandes restent lisibles ;
- les bobines et leur animation sont identiques à `120927` ;
- aucun changement visuel n'apparaît ailleurs ;
- le résultat a été vérifié dans un navigateur sur le commit exact.
