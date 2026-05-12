// load-canary.js — Stage 5 del release pipeline para webserver-api02.
//
// Apunta al STABLE service: durante un canary activo, el stable svc tiene
// el split de tráfico (5/25/50% al canary RS según setWeight). Pegar al
// stable simula tráfico real distribuido.
//
// Calibrado para k3d local (mismo criterio que load-bluegreen):
//   - 1000 VUs no es viable contra 600m baseline → pipeline falla.
//   - Ramp suave hasta 300 sustained con toque a 500.
//   - El stress de 1000 VUs vive en el burn pipeline.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

export const errorRate = new Rate('errors');
export const canaryHits = new Counter('canary_hits');
export const stableHits = new Counter('stable_hits');
export const latencyTrend = new Trend('latency_ms', true);

export const options = {
  scenarios: {
    canary_ramp: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '60s', target: 150 },
        { duration: '60s', target: 300 },
        { duration: '20s', target: 500 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<3000', 'p(99)<5000'],
    http_req_failed:   ['rate<0.20'],
    errors:            ['rate<0.20'],
    // canary_hits es informativo (no falla el pipeline). Requiere
    // CANARY_VERSION env var que el pipeline no pasa hoy. Si lo querés
    // como hard check, agregar `'count>0'` y modificar task-load-test.yaml
    // para pasar -e CANARY_VERSION=$IMAGE_TAG.
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://api02.localhost:8888';
const CANARY_VERSION = __ENV.CANARY_VERSION || '';

export default function () {
  const healthRes = http.get(`${BASE_URL}/api02/health`, { tags: { endpoint: 'health' } });
  check(healthRes, { 'health 200': (r) => r.status === 200 });

  const apiRes = http.get(`${BASE_URL}/api02/hello`, { tags: { endpoint: 'hello' } });
  const ok = check(apiRes, {
    'api 200': (r) => r.status === 200,
    'version present': (r) => {
      try { return JSON.parse(r.body).version !== undefined; } catch { return false; }
    },
  });
  errorRate.add(!ok);
  latencyTrend.add(apiRes.timings.duration);

  const itemsRes = http.get(`${BASE_URL}/api02/items`, { tags: { endpoint: 'items' } });
  check(itemsRes, { 'items 200': (r) => r.status === 200 });

  if (CANARY_VERSION) {
    try {
      const v = JSON.parse(apiRes.body).version;
      if (v === CANARY_VERSION) canaryHits.add(1);
      else stableHits.add(1);
    } catch { /* ignore */ }
  }

  sleep(0.3);
}
