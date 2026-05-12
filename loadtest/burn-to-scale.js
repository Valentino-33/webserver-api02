// burn-to-scale.js — usado por el burn pipeline (`pythonapps-burn-pipeline`)
// para validar que el HPA escala al cruzar el target de CPU.
//
// Mismo diseño que api01: 200 VUs sostenidos sin sleep contra un endpoint
// con trabajo de JSON serialization. La condición de éxito la evalúa el
// step kubectl del Task, no k6.
import http from 'k6/http';

export const options = {
  scenarios: {
    burn: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 200 },
        { duration: '120s', target: 200 },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {},
};

const TARGET_URL = __ENV.TARGET_URL || 'http://api02.localhost:8888';

export default function () {
  // /api02/items lista el catálogo completo (5 items + metadata) — más
  // costoso de serializar que /hello, satura CPU más rápido.
  http.get(`${TARGET_URL}/api02/items`);
}
