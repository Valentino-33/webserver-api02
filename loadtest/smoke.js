// smoke.js — sanity check rápido contra /api02/health + /api02/items.
// Lo usa rollingupdate strategy o corridas locales `make load-test-smoke APP=webserver-api02`.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

export const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '10s', target: 5 },
    { duration: '20s', target: 5 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    errors:            ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://api02.localhost:8888';

export default function () {
  const healthRes = http.get(`${BASE_URL}/api02/health`);
  const healthOk = check(healthRes, {
    'health 200': (r) => r.status === 200,
    'body healthy': (r) => {
      try { return JSON.parse(r.body).status === 'healthy'; } catch { return false; }
    },
  });
  errorRate.add(!healthOk);

  // Verificamos también el catálogo — endpoint exclusivo de api02
  const itemsRes = http.get(`${BASE_URL}/api02/items`);
  check(itemsRes, {
    'items 200': (r) => r.status === 200,
    'has items': (r) => {
      try { return JSON.parse(r.body).total > 0; } catch { return false; }
    },
  });
  sleep(1);
}
