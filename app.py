import json
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from multiplayer.routes import router as multiplayer_router

ROOT = Path(__file__).resolve().parent
PROFILE_FILE = ROOT / "config" / "gamepad-profile.json"
MAX_PROFILE_SIZE = 64 * 1024

app = FastAPI(title="Nova Flight Service", version="2.0.0")
app.include_router(multiplayer_router)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "microphone=(self), fullscreen=(self)"
    if request.url.path.endswith((".html", ".js", ".css")) or request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
def health():
    return {"ok": True, "service": "nova-flight", "multiplayer": 2}


@app.get("/api/gamepad-profile")
def get_gamepad_profile():
    if not PROFILE_FILE.exists():
        return {}
    try:
        return json.loads(PROFILE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


@app.post("/api/gamepad-profile")
async def save_gamepad_profile(request: Request):
    try:
        raw = await request.body()
        if not raw or len(raw) > MAX_PROFILE_SIZE:
            raise ValueError("taille invalide")
        profile = json.loads(raw)
        if not isinstance(profile, dict):
            raise ValueError("profil invalide")
        PROFILE_FILE.parent.mkdir(parents=True, exist_ok=True)
        temporary = PROFILE_FILE.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(PROFILE_FILE)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        raise HTTPException(400, str(error)) from error
    return {"ok": True}


@app.delete("/api/gamepad-profile")
def delete_gamepad_profile():
    try:
        PROFILE_FILE.unlink(missing_ok=True)
    except OSError as error:
        raise HTTPException(500, str(error)) from error
    return {"ok": True}


@app.exception_handler(HTTPException)
async def api_error(_request: Request, error: HTTPException):
    return JSONResponse({"detail": error.detail}, status_code=error.status_code)


app.mount("/", StaticFiles(directory=ROOT, html=True), name="frontend")
