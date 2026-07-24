"""Local launcher for the Nova Flight HTTP and multiplayer service."""

import os

import uvicorn


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host=os.getenv("NOVA_HOST", "0.0.0.0"),
        port=int(os.getenv("NOVA_PORT", "8010")),
        reload=False,
    )
