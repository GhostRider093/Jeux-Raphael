# Déploiement Ghost Chat → Nova Flight

## Architecture de cette première version

Ghost Chat conserve les comptes existants et reste le seul écran de connexion. Nova Flight ne possède pas de seconde base utilisateurs.

1. Le joueur connecté clique sur « Jouer à Nova Flight » dans Ghost Chat.
2. Ghost Chat signe un ticket valable 120 secondes.
3. Nova Flight échange ce ticket contre un cookie HTTP-only valable sept jours.
4. Le matchmaking place au maximum deux comptes différents dans le même salon.
5. Le jeu ouvre un WebSocket pour les positions, tirs, dégâts, destructions et réapparitions.

Le port public de Ghost Chat reste `8025`, relié au port `8000` de son conteneur. Nova Flight écoute séparément sur `8010`.

## Variables obligatoires

Les deux services doivent recevoir exactement le même secret aléatoire :

```dotenv
NOVA_SSO_SECRET=une-longue-valeur-aleatoire-identique-sur-les-deux-services
```

Ghost Chat :

```dotenv
NOVA_FLIGHT_URL=https://raphael.crea-doc.fr/multiplayer.html
NOVA_SSO_SECRET=une-longue-valeur-aleatoire-identique-sur-les-deux-services
COOKIE_SECURE=true
```

Nova Flight :

```dotenv
NOVA_HOST=0.0.0.0
NOVA_PORT=8010
NOVA_SSO_SECRET=une-longue-valeur-aleatoire-identique-sur-les-deux-services
NOVA_COOKIE_SECURE=true
```

Ne jamais publier le vrai secret dans Git. Un nouveau secret invalide seulement les tickets et cookies Nova existants ; il ne supprime aucun compte Ghost Chat.

## Démarrage de Nova Flight

```bash
cd /chemin/vers/raphael-online
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
NOVA_PORT=8010 NOVA_COOKIE_SECURE=true .venv/bin/python server_raphael.py
```

Pour le MVP, lancer un seul processus/worker. Les salons étant en mémoire, plusieurs workers créeraient des listes de salons indépendantes.

## Reverse proxy

Conserver la route Ghost existante :

```nginx
location /chat/ {
    proxy_pass http://172.17.0.1:8025/;
}
```

Le domaine Nova doit pointer vers `8010` et laisser passer la mise à niveau WebSocket :

```nginx
location / {
    proxy_pass http://172.17.0.1:8010;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

Dans Nginx Proxy Manager, activer « Websockets Support » pour `raphael.crea-doc.fr`.

## Ordre de publication sûr

1. Publier Nova Flight et vérifier `https://raphael.crea-doc.fr/api/health`.
2. Vérifier que `/api/sso/me` répond `401` sans cookie, et non `404`.
3. Publier uniquement les fichiers Ghost modifiés ; ne pas remplacer en bloc son interface actuelle.
4. Vérifier qu'un compte Ghost connecté voit le bouton « Jouer à Nova Flight ».
5. Ouvrir deux navigateurs ou deux profils privés avec deux comptes Ghost distincts.
6. Les deux joueurs doivent arriver dans le même salon, voir deux chasseurs différents et recevoir les dégâts de l'autre.

Si Nova n'est pas encore prêt, ne publiez pas le bouton Ghost : cela évite d'envoyer les utilisateurs vers une page `404`.

## Limites connues du MVP

- Deux joueurs maximum.
- Matchmaking public automatique, sans liste de salons ni invitations.
- Salons en mémoire, perdus au redémarrage du service Nova.
- Pas encore de persistance de profil, classement ou historique de match.
