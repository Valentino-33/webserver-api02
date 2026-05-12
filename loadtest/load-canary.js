// load-canary.js — Stage 5 del pipeline para webserver-api02.
//
// Apunta al STABLE service: cuando un canary está activo, el stable svc
// recibe el split de tráfico configurado por argo-rollouts (5/25/50% inicial
// hacia canary, resto hacia la versión vieja). Pegarle al stable simula
// tráfico real — algunos requests caerán en el canary, otros no.
//
// Por qué no preview:
//   El svc preview enrutea 100% al canary RS. Eso es útil para smoke testing
//   directo del canary, pero no representa la distribución real de tráfico.
//   Para canary queremos ver cómo se comporta la app bajo el split realista.
//
// Ramp profile + thresholds: mismo criterio que load-bluegreen (1000 VUs).
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
        { duration: '20s', target: 50 },
        { duration: '30s', target: 200 },
        { duration: '30s', target: 500 },
        { duration: '60s', target: 1000 },
        { duration: '30s', target: 1000 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<2000', 'p(99)<3000'],
    http_req_failed:   ['rate<0.05'],
    errors:            ['rate<0.05'],
    // Importante: durante un canary activo, esperamos VER algunos hits en
    // la versión nueva. Si todos los responses traen versión vieja, algo
    // anda mal con el traffic split del rollout.
    canary_hits:       ['count>0'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://api02.localhost:8888';
// CANARY_VERSION: tag del image que el canary está sirviendo. Si responses
// vienen con ese version → suman canary_hits. Sin él, no podemos distinguir.
const CANARY_VERSION = __ENV.CANARY_VERSION || '';

export default function () {
  const healthRes = http.get(`${BASE_URL}/health`, { tags: { endpoint: 'health' } });
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

  // Contamos hits por versión — útil para verificar que el split de tráfico
  // del canary efectivamente está enrutando una fracción al RS nuevo.
  if (CANARY_VERSION) {
    try {
      const v = JSON.parse(apiRes.body).version;
      if (v === CANARY_VERSION) canaryHits.add(1);
      else stableHits.add(1);
    } catch { /* ignore */ }
  }

  sleep(0.2);
}
