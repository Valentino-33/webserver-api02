# Guía rápida de comandos — webserver-api02

> App Python FastAPI con estrategia **Canary** vía ArgoRollouts.
> Este repo no tiene Makefile — los comandos son `docker`, `git` y `k6`.

---

## Desarrollo local

```bash
# Instalar dependencias
pip install -e .

# Correr en modo desarrollo (puerto 8001 para no colisionar con api01)
uvicorn app.main:app --reload --port 8001

# Probar endpoints
curl localhost:8001/health
curl localhost:8001/version
curl localhost:8001/api02/hello
curl localhost:8001/api02/metrics
```

---

## Docker

```bash
# Build local
docker build -t local/api02:test .

# Correr el contenedor
docker run --rm -p 8001:8000 -e APP_VERSION=0.1.0 local/api02:test

# Build + tag + push para DockerHub
docker build -t valentinobruno/webserver-api02:v1.0.0 .
docker push valentinobruno/webserver-api02:v1.0.0
```

---

## Disparar el pipeline CI/CD

```bash
# Canary (rollout gradual: 5% → 25% → 50% → 100%)
git tag -a v1.0.0 -m "strategy:Canary"
git push origin v1.0.0

# RollingUpdate (sin annotation = default)
git tag v1.0.0
git push origin v1.0.0
```

---

## Gestión del rollout Canary

```bash
# Ver estado del rollout (con distribución de tráfico)
kubectl argo rollouts get rollout webserver-api02 -n dev --watch

# Avanzar al siguiente step (5% → 25% → 50% → 100%)
kubectl argo rollouts promote webserver-api02 -n dev

# Abortar y volver a stable
kubectl argo rollouts abort webserver-api02 -n dev
```

---

## Load tests con k6

```bash
# Smoke test
k6 run loadtest/smoke.js -e BASE_URL=http://localhost:8001

# Load test de canary (verifica distribución del tráfico durante el rollout)
k6 run loadtest/load-canary.js -e BASE_URL=http://localhost:8001
```

---

## Estructura del repo

```
webserver-api02/
├── Dockerfile
├── pyproject.toml          ← FastAPI + uvicorn + structlog + prometheus_client
├── app/
│   ├── main.py             ← endpoints /, /health, /version, /api02/hello, /api02/metrics
│   └── logging_config.py   ← logging estructurado con structlog (JSON)
├── loadtest/
│   ├── smoke.js            ← smoke test básico
│   └── load-canary.js      ← load test durante el rollout canary
└── .tekton/
    └── pipelinerun.yaml    ← template del PipelineRun
```
