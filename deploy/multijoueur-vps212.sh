#!/usr/bin/env bash
# Mise en ligne du serveur de jeu de Poilhes City (multijoueur + classement en ligne)
# sur le VPS 212 — 26/09/2026.
#
# À lancer depuis le PC, dans Claude Code :   ! bash deploy/multijoueur-vps212.sh
#
# Ce que ça fait, dans l'ordre, et rien d'autre :
#   1. lance le conteneur `raphael-online-api` (python:3.12-slim) sur le réseau de
#      Nginx Proxy Manager : le code du site monté en LECTURE SEULE, seul `config/`
#      (classements) en écriture ; un secret aléatoire propre au serveur ;
#   2. vérifie qu'il répond (/api/health) depuis le proxy ;
#   3. sauvegarde `custom/http.conf` de NPM (copie datée), y ajoute une règle
#      `location /api/` (WebSocket compris) pour raphael.crea-doc.fr, teste la
#      configuration (`nginx -t`) et ne recharge que si le test passe — sinon il
#      remet la sauvegarde ;
#   4. contrôle https://raphael.crea-doc.fr/api/health.
#
# Retour arrière :  docker rm -f raphael-online-api  +  remettre la sauvegarde
#                   custom/http.conf.bak-multi-<date> et `nginx -s reload`.
# Après une mise en ligne qui change du Python : docker restart raphael-online-api
set -euo pipefail
VPS=root@212.227.147.177

ssh "$VPS" 'bash -s' <<'DISTANT'
set -euo pipefail
echo "== 1. conteneur du serveur de jeu"
if docker ps -a --format '{{.Names}}' | grep -qx raphael-online-api; then
  echo "   déjà présent : redémarrage"
  docker restart raphael-online-api >/dev/null
else
  docker run -d --name raphael-online-api --restart unless-stopped \
    --network nginx-proxy-manager_default \
    -v /opt/raphael-online-site:/app:ro -v /opt/raphael-online-site/config:/app/config -w /app \
    -e NOVA_HOST=0.0.0.0 -e NOVA_PORT=8010 -e NOVA_COOKIE_SECURE=true -e PYTHONDONTWRITEBYTECODE=1 \
    -e NOVA_SSO_SECRET="$(openssl rand -hex 32)" \
    python:3.12-slim sh -c "pip install --no-cache-dir -q -r requirements.txt && exec python server_raphael.py" >/dev/null
fi

echo "== 2. il répond ?"
for i in $(seq 1 30); do
  if docker exec nginx-proxy-manager-npm-1 sh -c "curl -sf http://raphael-online-api:8010/api/health" >/dev/null 2>&1; then
    echo "   oui : $(docker exec nginx-proxy-manager-npm-1 sh -c 'curl -s http://raphael-online-api:8010/api/health')"; break
  fi
  sleep 3
  if [ "$i" = 30 ]; then echo "   NON — journal :"; docker logs --tail 20 raphael-online-api; exit 1; fi
done

echo "== 3. règle /api/ dans le proxy"
CONF=/srv/docker/nginx-proxy-manager/data/nginx/custom/http.conf
if grep -q "raphael-online-api" "$CONF"; then
  echo "   déjà en place"
else
  SAUVE="$CONF.bak-multi-$(date +%Y%m%d-%H%M%S)"
  cp "$CONF" "$SAUVE"
  echo "   sauvegarde : $SAUVE"
  python3 - "$CONF" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
ancre = "        proxy_pass http://raphael-online:80;"
bloc = """    # Serveur de jeu (multijoueur, classement en ligne) — 26/09/2026
    location /api/ {
        proxy_pass http://raphael-online-api:8010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_buffering off;
    }

"""
i = s.index(ancre)
j = s.rindex("    location / {", 0, i)
assert "server_name raphael.crea-doc.fr;" in s[s.rindex("server {", 0, j):j]
open(p, "w", encoding="utf-8").write(s[:j] + bloc + s[j:])
PY
  if TEST=$(docker exec nginx-proxy-manager-npm-1 nginx -t 2>&1); then
    echo "$TEST" | tail -2
    docker exec nginx-proxy-manager-npm-1 nginx -s reload
    echo "   proxy rechargé"
  else
    cp "$SAUVE" "$CONF"
    echo "   ÉCHEC du test : configuration d'origine remise, rien n'est rechargé"; exit 1
  fi
fi
DISTANT

echo "== 4. contrôle public"
sleep 2
curl -s https://raphael.crea-doc.fr/api/health; echo
curl -s https://raphael.crea-doc.fr/api/village/classement/poilhes; echo
