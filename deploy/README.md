# Publication du service Nova Flight

Objectif : les comptes Ghost Chat deviennent pilotes Nova Flight sans seconde inscription,
et deux joueurs qui lancent le jeu se retrouvent dans le meme salon.

La chaine complete (ticket signe -> cookie Nova -> salon partage -> WebSocket) a ete validee
en local a deux comptes. Il ne manque que la mise en ligne.

## Principe retenu : ne proxifier que `/api/`

`raphael.crea-doc.fr` sert aujourd'hui le jeu en fichiers statiques. On **ne change pas** cela :
Nginx continue de servir les `.html`, `.js` et les assets `.glb`, et on ajoute uniquement une
route `/api/` vers le service FastAPI du port 8010.

C'est le choix le moins risque : aucun deplacement des assets 3D, et le site reste debout meme
si le service Nova tombe. Les seules routes dynamiques du jeu sont `/api/sso/*` et
`/api/multiplayer/*`.

## 1. Secret partage

Les deux services doivent recevoir **exactement** la meme valeur. Un secret different produit
un ticket rejete avec pour seul message « Lien Ghost Chat invalide ».

Sur le VPS, cote Nova (`/home/ubuntu/nova-flight/.env`) :

```dotenv
NOVA_HOST=127.0.0.1
NOVA_PORT=8010
NOVA_SSO_SECRET=<LE_SECRET>
NOVA_COOKIE_SECURE=true
```

Cote Ghost Chat (`/home/ubuntu/private-chat/.env`) :

```dotenv
NOVA_SSO_SECRET=<LE_SECRET>
NOVA_FLIGHT_URL=https://raphael.crea-doc.fr/multiplayer.html
```

Ne jamais commiter la vraie valeur. Changer le secret n'invalide que les tickets et cookies
Nova en cours ; aucun compte Ghost Chat n'est touche.

## 2. Fichiers a publier

Service (dans `/home/ubuntu/nova-flight/`) :

- `app.py`
- `server_raphael.py`
- `requirements.txt`
- `multiplayer/__init__.py`
- `multiplayer/routes.py`

Fichiers statiques du jeu (dans la racine web existante) :

- `multiplayer.html` — **absent du serveur aujourd'hui**, c'est la page d'entree du SSO
- `maps/world-multiplayer.js` — client multijoueur

## 3. Installation du service

```bash
ssh ubuntu@57.129.110.251
mkdir -p /home/ubuntu/nova-flight
cd /home/ubuntu/nova-flight
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

sudo cp deploy/nova-flight.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now nova-flight
systemctl status nova-flight --no-pager
```

Un seul processus : les salons vivent en memoire, plusieurs workers donneraient des listes de
salons independantes et les deux pilotes ne se retrouveraient jamais.

## 4. Reverse proxy

Dans Nginx Proxy Manager, sur l'hote `raphael.crea-doc.fr`, activer **Websockets Support** puis
ajouter une location personnalisee :

```nginx
location /api/ {
    proxy_pass http://172.17.0.1:8010;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

Sans la mise a niveau WebSocket, l'echange SSO fonctionnera mais les avions resteront
invisibles : c'est le WebSocket qui transporte positions, tirs et degats.

## 5. Verifications, dans l'ordre

```bash
curl -s https://raphael.crea-doc.fr/api/health
# attendu: {"ok":true,"service":"nova-flight","multiplayer":2}

curl -s -o /dev/null -w "%{http_code}\n" https://raphael.crea-doc.fr/api/sso/me
# attendu: 401 (et surtout pas 404, qui signalerait que le proxy ne pointe pas sur le service)

curl -s -o /dev/null -w "%{http_code}\n" https://raphael.crea-doc.fr/multiplayer.html
# attendu: 200

curl -s -o /dev/null -w "%{http_code}\n" https://crea-doc.fr/chat/static/nova-launch.js
# attendu: 200
```

Puis, a deux comptes Ghost distincts dans deux navigateurs : les deux doivent atterrir dans le
meme salon et voir l'avion de l'autre.

## Point d'attention : COOKIE_SECURE cote Ghost Chat

`DEPLOIEMENT.md` recommande `COOKIE_SECURE=true`. **Ne pas l'appliquer en l'etat** :
l'APK Android `com.ghostchat.app` appelle `http://57.129.110.251:8025` en clair, et le passage
a `true` invaliderait son cookie de session. A traiter separement, en publiant d'abord un APK
qui pointe sur `https://crea-doc.fr/chat/`.

Cela n'affecte pas le SSO Nova : le ticket est auto-porteur et traverse sans probleme la
frontiere app-HTTP vers jeu-HTTPS.
