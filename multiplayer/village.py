"""Le salon de village — le multijoueur de Poilhes City.

Arnaud, 26/09/2026 : « passer au multijoueur : plusieurs sur l'ordinateur et
surtout plusieurs en ligne ». Rien à voir avec l'ancien salon des avions
(`routes.py`, deux comptes Ghost Chat) : ici, **un pseudo suffit**.

- `WS /api/village/ws/{village}?pseudo=…` : on entre dans le salon du village
  (Poilhes, Capestang), huit joueurs au plus ; au-delà, un salon « -2 », « -3 »…
  Le client envoie son état (position, cap, engin) une dizaine de fois par
  seconde ; le serveur renvoie à chacun l'état des autres, par paquets, 12 fois
  par seconde. Il ne calcule rien : il relaie.
- La **course à plusieurs** : un joueur demande le départ, le serveur fixe
  l'instant (dans 4 s) pour tout le salon ; chacun annonce son arrivée, le
  serveur diffuse le résultat.
- `GET/POST /api/village/classement/{village}` : le classement partagé de la
  boucle (meilleur temps par pseudo, les 20 premiers), dans
  `config/race-leaderboards/boucle-<village>.json` — le dossier `config/` est
  protégé des mises en ligne (voir le workflow).

Un seul worker : les salons vivent en mémoire (même contrainte que `routes.py`).
"""
import asyncio
import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

router = APIRouter()

VILLAGES = {"poilhes", "capestang"}
PLACES = 8
CADENCE = 1 / 12                    # s entre deux paquets d'états
DEPART_DANS = 4.0                   # s entre la demande de départ et le « GO »
TEMPS_MINI = 20.0                   # s : un tour plus court est une erreur (ou une triche)
PSEUDO = re.compile(r"[^\w \-'.]", re.UNICODE)
ROOT = Path(__file__).resolve().parent.parent
CLASSEMENTS = ROOT / "config" / "race-leaderboards"


def propre(pseudo: str) -> str:
    p = PSEUDO.sub("", (pseudo or "").strip())[:16].strip()
    return p or "Pilote"


@dataclass
class Joueur:
    id: int
    pseudo: str
    ws: WebSocket
    etat: dict = field(default_factory=dict)
    vu: float = field(default_factory=time.monotonic)


@dataclass
class Salon:
    nom: str
    joueurs: dict = field(default_factory=dict)       # id -> Joueur
    course: dict | None = None                        # {"depart": t, "resultats": [...]}
    tache: asyncio.Task | None = None


salons: dict[str, Salon] = {}
prochain_id = 1


async def envoyer(ws: WebSocket, message: dict) -> None:
    try:
        await ws.send_text(json.dumps(message, separators=(",", ":")))
    except Exception:
        pass


async def diffuser(salon: Salon, message: dict, sauf: int | None = None) -> None:
    await asyncio.gather(*(envoyer(j.ws, message) for j in list(salon.joueurs.values()) if j.id != sauf))


async def boucle_salon(salon: Salon) -> None:
    """Le cœur : toutes les 1/12 s, chacun reçoit l'état des autres."""
    while salon.joueurs:
        await asyncio.sleep(CADENCE)
        maintenant = time.monotonic()
        etats = {str(j.id): j.etat for j in salon.joueurs.values() if j.etat}
        for j in list(salon.joueurs.values()):
            autres = {k: v for k, v in etats.items() if k != str(j.id)}
            if autres:
                await envoyer(j.ws, {"type": "etats", "t": maintenant, "joueurs": autres})
    salons.pop(salon.nom, None)


def choisir_salon(village: str) -> Salon:
    k = 1
    while True:
        nom = village if k == 1 else f"{village}-{k}"
        salon = salons.get(nom)
        if salon is None:
            salon = salons[nom] = Salon(nom=nom)
        if len(salon.joueurs) < PLACES:
            return salon
        k += 1


def liste(salon: Salon) -> list:
    return [{"id": j.id, "pseudo": j.pseudo} for j in salon.joueurs.values()]


@router.websocket("/api/village/ws/{village}")
async def salon_village(websocket: WebSocket, village: str, pseudo: str = ""):
    global prochain_id
    if village not in VILLAGES:
        await websocket.close(code=4404)
        return
    await websocket.accept()
    salon = choisir_salon(village)
    moi = Joueur(id=prochain_id, pseudo=propre(pseudo), ws=websocket)
    prochain_id += 1
    salon.joueurs[moi.id] = moi
    if salon.tache is None or salon.tache.done():
        salon.tache = asyncio.create_task(boucle_salon(salon))
    await envoyer(websocket, {"type": "bienvenue", "id": moi.id, "salon": salon.nom, "joueurs": liste(salon)})
    await diffuser(salon, {"type": "arrive", "id": moi.id, "pseudo": moi.pseudo}, sauf=moi.id)
    try:
        while True:
            texte = await websocket.receive_text()
            if len(texte) > 2000:
                continue
            try:
                m = json.loads(texte)
            except json.JSONDecodeError:
                continue
            moi.vu = time.monotonic()
            genre = m.get("type")
            if genre == "etat":
                # on ne garde que ce qu'on sait relayer, bornes comprises
                e = {}
                for cle in ("x", "y", "z", "qx", "qy", "qz", "qw", "kmh"):
                    v = m.get(cle)
                    if isinstance(v, (int, float)) and abs(v) < 1e5:
                        e[cle] = round(float(v), 3)
                e["engin"] = str(m.get("engin", ""))[:12]
                moi.etat = e
            elif genre == "course":
                # un départ par salon à la fois ; une course dure au plus 10 minutes
                c = salon.course
                if c is None or time.monotonic() - c["depart"] > 600:
                    depart = time.monotonic() + DEPART_DANS
                    salon.course = {"depart": depart, "resultats": [], "par": moi.pseudo}
                    await diffuser(salon, {"type": "depart", "dans": DEPART_DANS, "par": moi.pseudo})
            elif genre == "arrivee":
                c = salon.course
                temps = m.get("temps")
                if c and isinstance(temps, (int, float)) and temps >= TEMPS_MINI \
                        and not any(r["id"] == moi.id for r in c["resultats"]):
                    c["resultats"].append({"id": moi.id, "pseudo": moi.pseudo, "temps": round(float(temps), 1),
                                           "engin": str(m.get("engin", ""))[:12]})
                    c["resultats"].sort(key=lambda r: r["temps"])
                    await diffuser(salon, {"type": "resultats", "resultats": c["resultats"]})
            elif genre == "ping":
                await envoyer(websocket, {"type": "pong", "t": m.get("t")})
    except WebSocketDisconnect:
        pass
    finally:
        salon.joueurs.pop(moi.id, None)
        await diffuser(salon, {"type": "part", "id": moi.id})


# ── le classement partagé de la boucle ─────────────────────────────────────
class Temps(BaseModel):
    pseudo: str
    temps: float
    engin: str = ""


def fichier(village: str) -> Path:
    return CLASSEMENTS / f"boucle-{village}.json"


def lire(village: str) -> list:
    try:
        data = json.loads(fichier(village).read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


@router.get("/api/village/classement/{village}")
def classement(village: str):
    if village not in VILLAGES:
        raise HTTPException(404, "Village inconnu")
    return {"village": village, "entrees": lire(village)[:20]}


@router.post("/api/village/classement/{village}")
def ajouter(village: str, corps: Temps):
    if village not in VILLAGES:
        raise HTTPException(404, "Village inconnu")
    if not (TEMPS_MINI <= corps.temps <= 3600):
        raise HTTPException(400, "Temps invalide")
    pseudo = propre(corps.pseudo)
    entrees = [e for e in lire(village) if isinstance(e, dict)]
    ancien = next((e for e in entrees if e.get("pseudo") == pseudo), None)
    if ancien is None or corps.temps < float(ancien.get("temps", 1e9)):
        entrees = [e for e in entrees if e.get("pseudo") != pseudo]
        entrees.append({"pseudo": pseudo, "temps": round(corps.temps, 1), "engin": corps.engin[:12],
                        "date": int(time.time())})
        entrees.sort(key=lambda e: e["temps"])
        entrees = entrees[:100]
        chemin = fichier(village)
        chemin.parent.mkdir(parents=True, exist_ok=True)
        tmp = chemin.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(entrees, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(chemin)
    rang = next((i + 1 for i, e in enumerate(entrees) if e.get("pseudo") == pseudo), None)
    return {"village": village, "rang": rang, "entrees": entrees[:20]}
