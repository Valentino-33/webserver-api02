// load-canary.js — Stage 5 del release pipeline para webserver-api02.
//
// Apunta al STABLE service: cuando un canary está activo, el stable svc
// recibe el split de tráfico configurado por argo-rollouts (5/25/50% al
// canary RS, resto a la versión vieja). Pegarle al stable simula tráfico
// real — algunos requests caerán en el canary, otros no.
//
// Por qué no preview:
//   El svc preview enrutea 100% al canary RS. Útil para smoke testing
//   directo, pero no representa distribución real. Para canary queremos
//   ver cómo se comporta el sistema bajo el split.
//
// Ramp y thresholds: mismo criterio que load-bluegreen (1000 VUs, 10%
// errors permitidos durante ventana de scale-up del HPA).
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
        { duration: '30s', target: 100 },
        { duration: '30s', target: 300 },
        { duration: '30s', target: 600 },
        { duration: '60s', target: 1000 },
        { duration: '30s', target: 1000 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<3000'],
    http_req_failed:   ['rate<0.10'],
    errors:            ['rate<0.10'],
    // Durante un canary activo esperamos VER hits en la versión nueva.
    // Si todos responses traen versión vieja, el traffic split del rollout
    // no está enrutando al RS nuevo → fail hard.
    canary_hits:       ['count>0'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://api02.localhost:8888';
const CANARY_VERSION = __ENV.CANARY_VERSION || '';

export default function () {
  // 1. /api02/health — schema más rico que api01 (incluye catalog_loaded)
  const healthRes = http.get(`${BASE_URL}/api02/health`, { tags: { endpoint: 'health' } });
  check(healthRes, { 'health 200': (r) => r.status === 200 });

  // 2. /api02/hello — endpoint de negocio
  const apiRes = http.get(`${BASE_URL}/api02/hello`, { tags: { endpoint: 'hello' } });
  const ok = check(apiRes, {
    'api 200': (r) => r.status === 200,
    'version present': (r) => {
      try { return JSON.parse(r.body).version !== undefined; } catch { return false; }
    },
  });
  errorRate.add(!ok);
  latencyTrend.add(apiRes.timings.duration);

  // 3. /api02/items — endpoint exclusivo de api02 (api01 no lo tiene),
  //    valida que el catálogo está cargado en el RS nuevo.
  const itemsRes = http.get(`${BASE_URL}/api02/items`, { tags: { endpoint: 'items' } });
  check(itemsRes, { 'items 200': (r) => r.status === 200 });

  // 4. Contar hits por versión — útil para verificar el split de tráfico
  //    del canary durante el step paused.
  if (CANARY_VERSION) {
    try {
      const v = JSON.parse(apiRes.body).version;
      if (v === CANARY_VERSION) canaryHits.add(1);
      else stableHits.add(1);
    } catch { /* ignore */ }
  }

  sleep(0.2);
}
