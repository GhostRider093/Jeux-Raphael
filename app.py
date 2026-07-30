import hashlib
import json
import os
import re
import secrets
import time
import unicodedata
from pathlib import Path

from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel

from multiplayer.routes import router as multiplayer_router

ROOT = Path(__file__).resolve().parent
PROFILE_DIR = ROOT / "config" / "gamepad-profiles"
LEADERBOARD_DIR = ROOT / "config" / "race-leaderboards"
MAX_PROFILE_SIZE = 64 * 1024
MAX_LEADERBOARD_ENTRIES = 100
MAX_RACE_TIME_MS = 60 * 60 * 1000
WORLD_ID_PATTERN = re.compile(r"^[a-z0-9-]{1,40}$")

# Fente manette : identifiant du joueur tant que Ghost Chat n'est pas branche.
# Quand le SSO sera actif, le cookie de session prend le dessus (voir
# resolve_slot) et ce mecanisme devient un simple repli.
SLOT_SECRET = os.getenv("NOVA_SSO_SECRET", "development-only-change-me")
SLOT_SERIALIZER = URLSafeTimedSerializer(SLOT_SECRET, salt="nova-flight-gamepad-slot")
SLOT_COOKIE = "nova_gamepad_slot"
SLOT_MAX_AGE = 60 * 60 * 24 * 365
COOKIE_SECURE = os.getenv("NOVA_COOKIE_SECURE", "false").lower() == "true"

NAME_PATTERN = re.compile(r"[^a-z0-9-]")
CODE_PATTERN = re.compile(r"^\d{4}$")

# Un code a 4 chiffres ne resiste pas a 10 000 essais automatises : sans
# limitation, la protection serait decorative sur le serveur public.
MAX_FAILED_ATTEMPTS = 8
ATTEMPT_WINDOW_S = 600
failed_attempts: dict[str, list[float]] = {}

app = FastAPI(title="Nova Flight Service", version="2.0.0")
app.include_router(multiplayer_router)


class ClaimBody(BaseModel):
    prenom: str
    code: str


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "microphone=(self), fullscreen=(self)"
    if request.url.path.endswith((".html", ".js", ".css")) or request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


def normalize_name(raw: str) -> str:
    """« Raphaël » -> « raphael ». Le resultat sert de nom de fichier : il ne
    doit contenir que [a-z0-9-], sinon on ouvre une traversee de chemin."""
    text = unicodedata.normalize("NFKD", str(raw or "")).encode("ascii", "ignore").decode("ascii")
    name = NAME_PATTERN.sub("", text.strip().lower().replace(" ", "-"))
    name = re.sub(r"-{2,}", "-", name).strip("-")
    if not 1 <= len(name) <= 24:
        raise HTTPException(400, "Prénom invalide : 1 à 24 lettres ou chiffres.")
    return name


def slot_path(slot: str) -> Path:
    path = (PROFILE_DIR / f"{slot}.json").resolve()
    # Ceinture et bretelles : meme si normalize_name est contourne, on refuse
    # tout chemin qui sortirait du dossier des profils.
    if path.parent != PROFILE_DIR.resolve():
        raise HTTPException(400, "Fente de profil invalide")
    return path


def read_slot_file(slot: str) -> dict:
    path = slot_path(slot)
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def write_slot_file(slot: str, data: dict) -> None:
    path = slot_path(slot)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def hash_code(code: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", code.encode("utf-8"), bytes.fromhex(salt), 120_000).hex()


def check_rate_limit(slot: str) -> None:
    now = time.monotonic()
    attempts = [t for t in failed_attempts.get(slot, []) if now - t < ATTEMPT_WINDOW_S]
    failed_attempts[slot] = attempts
    if len(attempts) >= MAX_FAILED_ATTEMPTS:
        raise HTTPException(429, "Trop d'essais. Réessaie dans quelques minutes.")


def register_failure(slot: str) -> None:
    failed_attempts.setdefault(slot, []).append(time.monotonic())


def read_sso_slot(token: str | None) -> str | None:
    """Identite Ghost Chat si le SSO est branche. Prioritaire sur le prénom."""
    if not token:
        return None
    try:
        from multiplayer.routes import SESSION_SERIALIZER

        payload = SESSION_SERIALIZER.loads(token, max_age=60 * 60 * 24 * 7)
    except (BadSignature, SignatureExpired, ImportError):
        return None
    user_id = payload.get("user_id")
    return f"user-{user_id}" if isinstance(user_id, int) else None


def resolve_slot(
    nova_flight_session: str | None = Cookie(default=None),
    nova_gamepad_slot: str | None = Cookie(default=None),
) -> str:
    sso_slot = read_sso_slot(nova_flight_session)
    if sso_slot:
        return sso_slot
    if not nova_gamepad_slot:
        raise HTTPException(401, "Aucun profil manette choisi")
    try:
        slot = SLOT_SERIALIZER.loads(nova_gamepad_slot, max_age=SLOT_MAX_AGE)
    except (BadSignature, SignatureExpired) as error:
        raise HTTPException(401, "Profil manette expiré") from error
    if not isinstance(slot, str) or not slot:
        raise HTTPException(401, "Profil manette invalide")
    return slot


def resolve_slot_optional(
    nova_flight_session: str | None = Cookie(default=None),
    nova_gamepad_slot: str | None = Cookie(default=None),
) -> str | None:
    """Identite du joueur si elle existe, sans exiger d'etre connecte.

    Le classement doit rester consultable par un visiteur qui n'a pas encore
    choisi de profil : seul l'envoi d'un resultat demande une identite.
    """
    try:
        return resolve_slot(nova_flight_session, nova_gamepad_slot)
    except HTTPException:
        return None


@app.get("/api/health")
def health():
    return {"ok": True, "service": "nova-flight", "multiplayer": 2}


@app.post("/api/gamepad-profile/claim")
def claim_slot(body: ClaimBody, response: Response):
    """Cree la fente si le prénom est libre, l'ouvre si le code correspond."""
    name = normalize_name(body.prenom)
    if not CODE_PATTERN.match(str(body.code or "")):
        raise HTTPException(400, "Le code doit contenir exactement 4 chiffres.")
    slot = f"local-{name}"
    check_rate_limit(slot)
    existing = read_slot_file(slot)

    if not existing:
        salt = secrets.token_hex(16)
        write_slot_file(slot, {
            "slot": slot,
            "prenom": name,
            "salt": salt,
            "code_hash": hash_code(body.code, salt),
            "profile": {},
        })
        created = True
    else:
        expected = str(existing.get("code_hash", ""))
        salt = str(existing.get("salt", ""))
        if not salt or not secrets.compare_digest(hash_code(body.code, salt), expected):
            register_failure(slot)
            raise HTTPException(409, f"Ce prénom est déjà pris. Choisis-en un autre ({name}2) ou vérifie ton code.")
        created = False

    failed_attempts.pop(slot, None)
    response.set_cookie(
        SLOT_COOKIE,
        SLOT_SERIALIZER.dumps(slot),
        max_age=SLOT_MAX_AGE,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )
    return {"prenom": name, "slot": slot, "created": created}


@app.get("/api/gamepad-profile/whoami")
def whoami(slot: str = Depends(resolve_slot)):
    return {"slot": slot, "prenom": read_slot_file(slot).get("prenom", "")}


@app.post("/api/gamepad-profile/logout")
def logout(response: Response):
    response.delete_cookie(SLOT_COOKIE, path="/")
    return {"ok": True}


@app.get("/api/gamepad-profile")
def get_gamepad_profile(slot: str = Depends(resolve_slot)):
    return read_slot_file(slot).get("profile", {})


@app.post("/api/gamepad-profile")
async def save_gamepad_profile(request: Request, slot: str = Depends(resolve_slot)):
    try:
        raw = await request.body()
        if not raw or len(raw) > MAX_PROFILE_SIZE:
            raise ValueError("taille invalide")
        profile = json.loads(raw)
        if not isinstance(profile, dict):
            raise ValueError("profil invalide")
        record = read_slot_file(slot)
        # La fente SSO n'a jamais ete « reclamee » : on la cree a la volee.
        record.setdefault("slot", slot)
        record["profile"] = profile
        write_slot_file(slot, record)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise HTTPException(400, str(error)) from error
    return {"ok": True}


@app.delete("/api/gamepad-profile")
def delete_gamepad_profile(slot: str = Depends(resolve_slot)):
    try:
        record = read_slot_file(slot)
        if record:
            record["profile"] = {}
            write_slot_file(slot, record)
    except OSError as error:
        raise HTTPException(500, str(error)) from error
    return {"ok": True}


# ---------------------------------------------------------------------------
#  CLASSEMENT DE COURSE
# ---------------------------------------------------------------------------
#  Un fichier par monde, une seule entree par joueur : on ne garde que son
#  meilleur temps. L'identite reprend la fente manette (prenom + code) ou le
#  compte Ghost Chat, il n'y a pas de seconde base de joueurs.


class RaceResultBody(BaseModel):
    time_ms: int
    score: int
    gates: int


def leaderboard_path(world_id: str) -> Path:
    # Le nom de monde vient du client : il ne doit jamais servir tel quel a
    # construire un chemin.
    if not WORLD_ID_PATTERN.match(world_id):
        raise HTTPException(400, "Identifiant de monde invalide")
    path = (LEADERBOARD_DIR / f"{world_id}.json").resolve()
    if path.parent != LEADERBOARD_DIR.resolve():
        raise HTTPException(400, "Identifiant de monde invalide")
    return path


def read_leaderboard(world_id: str) -> list[dict]:
    path = leaderboard_path(world_id)
    if not path.exists():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def write_leaderboard(world_id: str, entries: list[dict]) -> None:
    path = leaderboard_path(world_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


@app.get("/api/race-leaderboard/{world_id}")
def get_race_leaderboard(world_id: str, slot: str | None = Depends(resolve_slot_optional)):
    entries = read_leaderboard(world_id)
    return {
        "world": world_id,
        "entries": [
            {
                "rank": index + 1,
                "prenom": entry.get("prenom", "?"),
                "timeMs": entry.get("timeMs", 0),
                "score": entry.get("score", 0),
                "me": bool(slot) and entry.get("slot") == slot,
            }
            for index, entry in enumerate(entries[:MAX_LEADERBOARD_ENTRIES])
        ],
    }


@app.post("/api/race-leaderboard/{world_id}")
def post_race_leaderboard(world_id: str, body: RaceResultBody, slot: str = Depends(resolve_slot)):
    if body.time_ms <= 0 or body.time_ms > MAX_RACE_TIME_MS:
        raise HTTPException(400, "Temps invalide")
    if body.gates <= 0 or body.gates > 64:
        raise HTTPException(400, "Nombre de portes invalide")

    record = read_slot_file(slot)
    prenom = str(record.get("prenom") or "Pilote")[:24]

    entries = [entry for entry in read_leaderboard(world_id) if isinstance(entry, dict)]
    previous = next((entry for entry in entries if entry.get("slot") == slot), None)
    improved = previous is None or body.time_ms < int(previous.get("timeMs", 1 << 62))
    if improved:
        entries = [entry for entry in entries if entry.get("slot") != slot]
        entries.append({
            "slot": slot,
            "prenom": prenom,
            "timeMs": body.time_ms,
            "score": body.score,
            "gates": body.gates,
            "at": int(time.time()),
        })
    # Le meilleur temps d'abord ; la liste est tronquee pour que le fichier ne
    # grossisse pas indefiniment.
    entries.sort(key=lambda entry: int(entry.get("timeMs", 1 << 62)))
    entries = entries[:MAX_LEADERBOARD_ENTRIES]
    write_leaderboard(world_id, entries)

    rank = next((index + 1 for index, entry in enumerate(entries) if entry.get("slot") == slot), None)
    return {"ok": True, "improved": improved, "rank": rank, "prenom": prenom}


# ---------------------------------------------------------------------------
#  CARTES PERSO
# ---------------------------------------------------------------------------
#  Une carte est un patch applique a un monde du catalogue : quelques kilo-
#  octets, jamais une copie du monde. Elles sont rattachees a la fente du
#  joueur, comme le profil manette.

MAX_CUSTOM_MAP_SIZE = 512 * 1024
MAX_CUSTOM_MAPS = 60
MAP_ID_PATTERN = re.compile(r"^[a-z0-9-]{1,60}$")


def custom_maps_of(slot: str) -> dict:
    record = read_slot_file(slot)
    maps = record.get("customMaps")
    return maps if isinstance(maps, dict) else {}


def store_custom_maps(slot: str, maps: dict) -> None:
    record = read_slot_file(slot)
    if not record:
        record = {"slot": slot}
    record["customMaps"] = maps
    write_slot_file(slot, record)


@app.get("/api/custom-maps")
def list_custom_maps(slot: str | None = Depends(resolve_slot_optional)):
    # Sans profil choisi, l'editeur retombe sur le stockage navigateur : on
    # renvoie une liste vide plutot qu'une erreur.
    if not slot:
        return {"maps": {}}
    return {"maps": custom_maps_of(slot)}


@app.get("/api/custom-maps/{map_id}")
def get_custom_map(map_id: str, slot: str | None = Depends(resolve_slot_optional)):
    if not MAP_ID_PATTERN.match(map_id):
        raise HTTPException(400, "Identifiant de carte invalide")
    if not slot:
        raise HTTPException(404, "Aucun profil choisi")
    found = custom_maps_of(slot).get(map_id)
    if not found:
        raise HTTPException(404, "Carte inconnue")
    return found


@app.post("/api/custom-maps/{map_id}")
async def save_custom_map(map_id: str, request: Request, slot: str = Depends(resolve_slot)):
    if not MAP_ID_PATTERN.match(map_id):
        raise HTTPException(400, "Identifiant de carte invalide")
    raw = await request.body()
    if len(raw) > MAX_CUSTOM_MAP_SIZE:
        raise HTTPException(413, "Carte trop volumineuse")
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise HTTPException(400, f"JSON invalide : {error}") from error
    if not isinstance(payload, dict):
        raise HTTPException(400, "Carte invalide")

    maps = custom_maps_of(slot)
    if map_id not in maps and len(maps) >= MAX_CUSTOM_MAPS:
        raise HTTPException(409, f"Limite de {MAX_CUSTOM_MAPS} cartes atteinte")
    payload["id"] = map_id
    maps[map_id] = payload
    store_custom_maps(slot, maps)
    return {"ok": True, "id": map_id, "count": len(maps)}


@app.delete("/api/custom-maps/{map_id}")
def remove_custom_map(map_id: str, slot: str = Depends(resolve_slot)):
    if not MAP_ID_PATTERN.match(map_id):
        raise HTTPException(400, "Identifiant de carte invalide")
    maps = custom_maps_of(slot)
    maps.pop(map_id, None)
    store_custom_maps(slot, maps)
    return {"ok": True, "count": len(maps)}


@app.exception_handler(HTTPException)
async def api_error(_request: Request, error: HTTPException):
    return JSONResponse({"detail": error.detail}, status_code=error.status_code)


app.mount("/", StaticFiles(directory=ROOT, html=True), name="frontend")
