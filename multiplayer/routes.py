import asyncio
import math
import os
import secrets
import time
import uuid
from dataclasses import dataclass, field

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, WebSocket, WebSocketDisconnect
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from pydantic import BaseModel

router = APIRouter()
SSO_SECRET = os.getenv("NOVA_SSO_SECRET", "development-only-change-me")
COOKIE_SECURE = os.getenv("NOVA_COOKIE_SECURE", "false").lower() == "true"
TICKET_SERIALIZER = URLSafeTimedSerializer(SSO_SECRET, salt="ghost-chat-nova-flight")
SESSION_SERIALIZER = URLSafeTimedSerializer(SSO_SECRET, salt="nova-flight-session")
SESSION_COOKIE = "nova_flight_session"
MAX_PLAYERS = 2


@dataclass
class Pilot:
    user_id: int
    username: str
    websocket: WebSocket
    state: dict = field(default_factory=dict)
    hp: int = 100
    last_state_at: float = 0
    last_fire_at: float = 0


@dataclass
class MatchRoom:
    id: str
    reservations: dict[int, float] = field(default_factory=dict)
    pilots: dict[int, Pilot] = field(default_factory=dict)


rooms: dict[str, MatchRoom] = {}


class TicketBody(BaseModel):
    ticket: str


def read_session(token: str | None) -> dict:
    if not token:
        raise HTTPException(401, "Connexion Ghost Chat requise")
    try:
        payload = SESSION_SERIALIZER.loads(token, max_age=60 * 60 * 24 * 7)
    except (BadSignature, SignatureExpired) as error:
        raise HTTPException(401, "Session Nova Flight expirée") from error
    if not isinstance(payload.get("user_id"), int) or not payload.get("username"):
        raise HTTPException(401, "Session Nova Flight invalide")
    return payload


def current_pilot(nova_flight_session: str | None = Cookie(default=None)) -> dict:
    return read_session(nova_flight_session)


@router.post("/api/sso/exchange")
def exchange_ticket(body: TicketBody, response: Response):
    try:
        identity = TICKET_SERIALIZER.loads(body.ticket, max_age=120)
    except SignatureExpired as error:
        raise HTTPException(401, "Le lien Ghost Chat a expiré") from error
    except BadSignature as error:
        raise HTTPException(401, "Lien Ghost Chat invalide") from error
    if not isinstance(identity.get("user_id"), int) or not identity.get("username"):
        raise HTTPException(401, "Identité Ghost Chat invalide")
    session = SESSION_SERIALIZER.dumps(
        {"user_id": identity["user_id"], "username": str(identity["username"])[:32]}
    )
    response.set_cookie(
        SESSION_COOKIE,
        session,
        max_age=60 * 60 * 24 * 7,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )
    return {"user_id": identity["user_id"], "username": identity["username"]}


@router.get("/api/sso/me")
def sso_me(pilot=Depends(current_pilot)):
    return pilot


def clean_rooms():
    cutoff = time.monotonic() - 90
    for room_id, room in list(rooms.items()):
        room.reservations = {
            user_id: created for user_id, created in room.reservations.items()
            if created >= cutoff or user_id in room.pilots
        }
        if not room.reservations and not room.pilots:
            rooms.pop(room_id, None)


@router.post("/api/multiplayer/quick-join")
def quick_join(pilot=Depends(current_pilot)):
    clean_rooms()
    user_id = pilot["user_id"]
    for room in rooms.values():
        if user_id in room.reservations or user_id in room.pilots:
            return {"room_id": room.id, "players": len(room.pilots), "max_players": MAX_PLAYERS}
    room = next(
        (
            item for item in rooms.values()
            if len(set(item.reservations) | set(item.pilots)) < MAX_PLAYERS
        ),
        None,
    )
    if room is None:
        room = MatchRoom(id=secrets.token_urlsafe(8))
        rooms[room.id] = room
    room.reservations[user_id] = time.monotonic()
    return {"room_id": room.id, "players": len(room.pilots), "max_players": MAX_PLAYERS}


def finite_vector(value, size=3, limit=5000):
    if not isinstance(value, list) or len(value) != size:
        return None
    try:
        vector = [float(item) for item in value]
    except (TypeError, ValueError):
        return None
    if not all(math.isfinite(item) and abs(item) <= limit for item in vector):
        return None
    return vector


async def send_safe(websocket: WebSocket, payload: dict):
    try:
        await websocket.send_json(payload)
        return True
    except Exception:
        return False


async def broadcast(room: MatchRoom, payload: dict, exclude: int | None = None):
    for user_id, pilot in list(room.pilots.items()):
        if user_id != exclude:
            await send_safe(pilot.websocket, payload)


async def respawn(room: MatchRoom, user_id: int):
    await asyncio.sleep(3)
    pilot = room.pilots.get(user_id)
    if not pilot:
        return
    pilot.hp = 100
    await broadcast(room, {"type": "respawn", "user_id": user_id, "hp": 100})


async def handle_fire(room: MatchRoom, attacker: Pilot, message: dict):
    weapon = message.get("weapon")
    cooldown = 1.2 if weapon == "missile" else 0.08
    damage = 100 if weapon == "missile" else 10
    now = time.monotonic()
    if weapon not in {"gun", "missile"} or now - attacker.last_fire_at < cooldown:
        return
    attacker.last_fire_at = now
    origin = finite_vector(attacker.state.get("position"))
    forward = finite_vector(message.get("forward"), limit=1.1)
    target = next((item for uid, item in room.pilots.items() if uid != attacker.user_id and item.hp > 0), None)
    await broadcast(
        room,
        {"type": "shot", "user_id": attacker.user_id, "weapon": weapon, "origin": origin, "forward": forward},
        exclude=attacker.user_id,
    )
    if not target or not origin or not forward:
        return
    target_position = finite_vector(target.state.get("position"))
    if not target_position:
        return
    delta = [target_position[i] - origin[i] for i in range(3)]
    distance = math.sqrt(sum(item * item for item in delta))
    forward_length = math.sqrt(sum(item * item for item in forward))
    if distance <= 0.01 or forward_length <= 0.01 or distance > (1400 if weapon == "missile" else 900):
        return
    alignment = sum((delta[i] / distance) * (forward[i] / forward_length) for i in range(3))
    required_alignment = 0.94 if weapon == "missile" else 0.985
    if alignment < required_alignment:
        return
    target.hp = max(0, target.hp - damage)
    await broadcast(
        room,
        {
            "type": "damage",
            "target_id": target.user_id,
            "attacker_id": attacker.user_id,
            "weapon": weapon,
            "hp": target.hp,
        },
    )
    if target.hp == 0:
        await broadcast(
            room,
            {"type": "destroyed", "user_id": target.user_id, "by": attacker.user_id},
        )
        asyncio.create_task(respawn(room, target.user_id))


@router.websocket("/api/multiplayer/ws/{room_id}")
async def multiplayer_socket(websocket: WebSocket, room_id: str):
    try:
        identity = read_session(websocket.cookies.get(SESSION_COOKIE))
    except HTTPException:
        await websocket.close(code=4401)
        return
    clean_rooms()
    room = rooms.get(room_id)
    user_id = identity["user_id"]
    if not room or (user_id not in room.reservations and user_id not in room.pilots):
        await websocket.close(code=4404)
        return
    if user_id not in room.pilots and len(room.pilots) >= MAX_PLAYERS:
        await websocket.close(code=4409)
        return
    await websocket.accept()
    pilot = Pilot(user_id=user_id, username=identity["username"], websocket=websocket)
    previous = room.pilots.get(user_id)
    if previous:
        await previous.websocket.close(code=4000)
    room.pilots[user_id] = pilot
    room.reservations[user_id] = time.monotonic()
    await websocket.send_json(
        {
            "type": "welcome",
            "user_id": user_id,
            "username": pilot.username,
            "room_id": room.id,
            "max_players": MAX_PLAYERS,
            "players": [
                {"user_id": item.user_id, "username": item.username, "state": item.state, "hp": item.hp}
                for uid, item in room.pilots.items() if uid != user_id
            ],
        }
    )
    await broadcast(
        room,
        {"type": "joined", "user_id": user_id, "username": pilot.username, "hp": pilot.hp},
        exclude=user_id,
    )
    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")
            if message_type == "state":
                now = time.monotonic()
                if now - pilot.last_state_at < 1 / 30:
                    continue
                position = finite_vector(message.get("position"))
                rotation = finite_vector(message.get("rotation"), limit=7)
                speed = message.get("speed", 0)
                if not position or not rotation or not isinstance(speed, (int, float)) or not math.isfinite(speed):
                    continue
                pilot.last_state_at = now
                pilot.state = {
                    "position": position,
                    "rotation": rotation,
                    "speed": max(0, min(float(speed), 250)),
                    "sent_at": message.get("sent_at"),
                }
                await broadcast(
                    room,
                    {"type": "state", "user_id": user_id, "state": pilot.state, "hp": pilot.hp},
                    exclude=user_id,
                )
            elif message_type == "fire":
                await handle_fire(room, pilot, message)
            elif message_type == "ping":
                await websocket.send_json({"type": "pong", "sent_at": message.get("sent_at")})
    except WebSocketDisconnect:
        pass
    finally:
        if room.pilots.get(user_id) is pilot:
            room.pilots.pop(user_id, None)
            room.reservations.pop(user_id, None)
            await broadcast(room, {"type": "left", "user_id": user_id})
        clean_rooms()

