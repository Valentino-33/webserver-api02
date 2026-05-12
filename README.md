# webserver-api02

API Python (FastAPI) con estrategia de deployment **Canary** vía ArgoRollouts.

## Endpoints

| Método | Path | Descripción |
|---|---|---|
| GET | `/` | Info del servicio y versión |
| GET | `/health` | Health check (liveness/readiness probe de K8s) |
| GET | `/version` | Versión actual |
| GET | `/api02/hello` | Endpoint de negocio |
| GET | `/api02/metrics` | Métricas Prometheus |

## Correr local

```bash
pip install -e .
uvicorn app.main:app --reload --port 8001
curl localhost:8001/health
```

## Docker

```bash
docker build -t local/api02:test .
docker run --rm -p 8001:8000 -e APP_VERSION=0.1.0 local/api02:test
```

## Estrategia de deploy — Canary

Rollout gradual: 5% → 25% → 50% → 100%. En cada step corre `loadtest/load-canary.js`.
Si algún check falla → rollback automático.

## Disparar el pipeline

```bash
git tag -a v1.0.0 -m "strategy:Canary"
git push origin v1.0.0
```

## Load tests

```bash
k6 run loadtest/smoke.js -e BASE_URL=http://localhost:8001
k6 run loadtest/load-canary.js -e BASE_URL=http://localhost:8001
```
