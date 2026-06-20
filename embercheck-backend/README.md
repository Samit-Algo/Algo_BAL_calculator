# EmberCheck Backend

EmberCheck is a bushfire risk (BAL - Bushfire Attack Level) calculator for
properties in NSW, Australia. This backend is built with FastAPI.

This is currently just the project skeleton - no real BAL logic yet.

## Install

```
pip install -r requirements.txt
```

## Run

```
uvicorn app.main:app --reload
```

Once running, visit `http://127.0.0.1:8000/health` to check the server is up,
or `http://127.0.0.1:8000/docs` for the interactive API docs.
