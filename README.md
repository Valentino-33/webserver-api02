# webserver-api02

API Python (FastAPI) con estrategia de deployment **Canary** vía Argo Rollouts. A diferencia de api01 (hello-world simple), api02 expone un **catálogo de items en memoria** + endpoint de echo — sirve para demos donde queremos ver claramente cuál pod respondió cada request durante el split de tráfico del canary.

**Todos los endpoints viven bajo `/api02/*`** — la raíz `/` NO responde nada. Los probes apuntan a `/api02/health`.

## Endpoints

| Método | Path | Descripción |
|---|---|---|
| GET | `/api02/` | Landing — service info + lista de endpoints |
| GET | `/api02/health` | Health check (liveness/readiness probe de k8s) |
| GET | `/api02/version` | Versión actual + metadata del deployment |
| GET | `/api02/hello` | Endpoint de negocio — saluda desde la versión actual |
| GET | `/api02/items` | Lista el catálogo completo (5 items) — **exclusivo de api02** |
| GET | `/api02/items/{id}` | Item del catálogo por ID (404 si no existe) — **exclusivo de api02** |
| GET | `/api02/echo?msg=X` | Echo del mensaje + metadata — **exclusivo de api02** |
| GET | `/api02/info` | Metadata extra: uptime, catalog size, log level |
| GET | `/api02/metrics` | Métricas Prometheus (scrapeadas vía ServiceMonitor) |

### Métricas custom

| Métrica | Tipo | Notas |
|---|---|---|
| `api02_requests_total` | Counter | Total de requests por method/endpoint/status |
| `api02_request_duration_seconds_*` | Histogram | Buckets de latencia |
| `api02_catalog_items` | **Gauge** | Tamaño del catálogo. **api01 no tiene esta métrica** — diferenciación visual en Grafana. |

## Correr local

```bash
pip install -e .
uvicorn app.main:app --reload --port 8001
curl localhost:8001/api02/health
curl localhost:8001/api02/items
curl localhost:8001/api02/echo?msg=test
```

## Docker

```bash
docker build -t local/api02:test .
docker run --rm -p 8001:8000 -e APP_VERSION=0.1.0 local/api02:test
```

## Logging

Los logs salen a stdout en **JSON** vía `structlog` (config: `app/logging_config.py`).
Cada línea es un evento parseable:

```json
{"event":"request","method":"GET","path":"/api02/health","status":200,"version":"v0.5.0","level":"info","timestamp":"2026-05-12T12:34:56Z"}
```

Fluent-bit los ingesta a Elasticsearch y aparecen en Kibana bajo `kubernetes.namespace_name : "webserver-api02-dev"`.
Ver guía completa en el repo de infra: `docs/logging-efk.md`.

## Estrategia de deploy — Canary

El Rollout sube el peso del canary RS por steps (5% → pause → 25% → pause → 50% → pause).
En cada `pause`, el pipeline corre `loadtest/load-canary.js` contra el svc stable — durante un
canary activo, ese svc envía una fracción del tráfico al RS nuevo (canary) según el step. Si
el load test pasa, el pipeline emite `kubectl patch status.promoteFull=true` y el canary salta
directo al 100%.

Detalle completo del pipeline en el repo de infra: `docs/pipeline-stages.md`.

## Disparar pipelines

El webhook del EventListener responde a **dos formatos de tag**:

### Release pipeline (`refs/tags/release/<semver>/<env>`)

```bash
# Deploy a dev:
git tag release/v1.2.0/dev
git push origin release/v1.2.0/dev

# Deploy a dev + staging en el mismo run:
git tag release/v1.2.0/dev,staging
git push origin release/v1.2.0/dev,staging
```

Nombre del PipelineRun determinístico: `webserver-api02-pipelinerun-v1.2.0`. Re-pushear el mismo tag falla (intencional — forzar nuevo semver).

### Burn pipeline (`refs/tags/burn/<env>`) — HPA capacity test on-demand

```bash
# Validar que el HPA escala bajo carga en dev:
git tag burn/dev
git push origin burn/dev
```

Nombre con `generateName`: `webserver-api02-burn-dev-<random>`. Re-pushear el mismo tag requiere borrarlo primero:

```bash
git tag -d burn/dev && git push --delete origin burn/dev
git tag burn/dev && git push origin burn/dev
```

> El burn pipeline es **independiente del release**. Disparalo cuando tunees el HPA, antes de un evento de alta carga, o como check periódico. NO corre en cada release porque mete ~3min de CPU saturada al ciclo y la config de HPA cambia raramente.

## Load tests

Tres scripts, cada uno con un propósito distinto:

| Script | Cuándo se usa | Propósito | Métrica clave |
|--------|---------------|-----------|---------------|
| `loadtest/smoke.js` | Local / verificación rápida | Sanity check de endpoints | status 200 + p95<500ms |
| `loadtest/load-canary.js` | **Release pipeline, Stage 5** | Validación funcional bajo carga real (1000 VUs, ramp + sustained) sobre el stable svc durante el canary | p95<2s, p99<3s, errors<5%, canary_hits>0 |
| `loadtest/burn-to-scale.js` | **Burn pipeline** (`burn/<env>` tag) | Saturar CPU del pod para validar que el HPA escala el Rollout. Corre on-demand, NO en cada release | (no thresholds — el éxito lo decide kubectl polling de replicas en el Task) |

Corrida local de cada uno:

```bash
# Smoke
k6 run loadtest/smoke.js -e BASE_URL=http://localhost:8001

# Load test canary — necesita el cluster k3d arriba (api02.localhost mapeado al ingress)
k6 run loadtest/load-canary.js -e BASE_URL=http://api02.localhost:8888

# Burn-to-scale — observar HPA en paralelo:
# kubectl get hpa webserver-api02-dev -n webserver-api02-dev -w
k6 run loadtest/burn-to-scale.js -e TARGET_URL=http://api02.localhost:8888
```

Para invocar los mismos tests vía el Makefile del repo de infra (clona este repo a /tmp):

```bash
make load-test-smoke APP=webserver-api02
make load-test-canary
```
