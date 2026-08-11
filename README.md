# Guild Ledger

Je démarre un nouveau projet : "Trust & Greed", un jeu multijoueur web où des joueurs forment des guildes puis partent en expéditions collectives. Le cœur du jeu (pas encore construit aujourd'hui) repose sur une tension entre confiance, cupidité, et prise de risque collective. Le ton visuel doit refléter ça : un monde de guildes qui accumulent richesse et réputation, où chaque décision compte.

CONNEXIONS TECHNIQUES (à faire avant tout code)

- Connecte ce projet au dépôt GitHub existant : https://github.com/obliqgaming/TrustGreed — n'en crée pas un nouveau.

- Connecte le projet Supabase existant (intégration native Lovable, pas de clés collées à la main). Le schéma, les policies RLS et les fonctions RPC sont déjà en place dans ce projet Supabase — n'invente pas de nouvelles tables, utilise l'existant.

PÉRIMÈTRE STRICT DE CETTE PREMIÈRE VERSION

Construis uniquement le flux compte + personnage, rien d'autre. Pas de guildes, pas d'expéditions, pas de carte du monde, pas de chat — même si ça peut sembler être la suite logique, laisse ces écrans de côté pour l'instant.

1. Écran d'inscription : email, mot de passe, pseudo, et un champ obligatoire "code d'invitation". La création de compte Supabase (auth.signUp) doit être suivie immédiatement d'un appel à la fonction RPC `redeem_invitation(p_code, p_username)`. Si le code est invalide ou déjà utilisé, la fonction renverra une erreur PostgreSQL explicite — affiche ce message d'erreur tel quel à l'utilisateur, ne le réécris pas.

2. Écran de connexion classique (email/mot de passe) pour les comptes existants.

3. Une fois connecté, si le profil n'a pas encore de personnage vivant, affiche un écran de création de personnage (juste un champ "nom du personnage") qui appelle la fonction RPC `create_character(p_name)`.

4. Une fois le personnage créé, affiche un écran minimal "Bienvenue [nom du personnage]" avec son niveau (1) et son XP (0) — un simple écran de confirmation, pas un tableau de bord.

5. Génère aussi un petit écran "Inviter quelqu'un" accessible depuis ce dernier écran, qui appelle `create_invitation()` et affiche le code généré, copiable en un clic.

Ne construis rien au-delà de ces 5 écrans. Pas de menu de navigation vers des sections qui n'existent pas encore.

DIRECTION VISUELLE

Le thème central du jeu, c'est une guilde comme "bulle spéculative de confiance" : des gens qui mettent en commun de la richesse et se font mutuellement confiance, avec le risque toujours présent que ça s'effondre. Je veux que l'interface évoque un registre de guilde tenu à la main — quelque chose entre un grand livre de comptes et un contrat scellé — plutôt qu'un jeu vidéo fantasy générique (pas d'épées croisées, pas de parchemin usé cliché, pas de dégradés violets).

Palette suggérée : fond encre très sombre presque noir (#12110F), un or terni plutôt que doré brillant (#B8944D) comme accent unique, un blanc cassé pour le texte principal (#EDE9E0), et une touche de rouge sceau discret (#7A2E2E) réservé aux seuls messages d'erreur ou d'avertissement — pas utilisé ailleurs. N'utilise pas de terracotta/orange chaud générique, pas de fond crème.

Typographie : une serif à forte personnalité pour les titres (quelque chose qui évoque une gravure ou un tampon officiel, pas une serif éditoriale classique type Georgia), associée à une sans-serif neutre et très lisible pour les formulaires et le corps de texte. Les nombres (niveau, XP) peuvent utiliser une police à chasse fixe, comme des montants dans un registre.

Élément signature : le bouton de confirmation principal (valider l'inscription, créer le personnage) peut avoir un effet visuel de "sceau" ou de "validation officielle" au clic — quelque chose de bref et satisfaisant, pas une animation décorative permanente. Le reste de l'interface doit rester sobre et retenu autour de cet unique moment marquant.

Assure-toi que tout est responsive mobile, que le focus clavier est visible, et que le texte de l'interface est en français, avec un ton direct et sans fioritures (pas de formulations marketing).

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/4a5b4797-e24c-4fa9-ab56-0177023d31df).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
