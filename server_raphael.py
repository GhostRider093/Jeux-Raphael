"""Local launcher for the unified Ghost Chat + Nova Flight server."""

import uvicorn


if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8010, reload=False)

