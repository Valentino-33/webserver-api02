// burn-to-scale.js — pipeline DEDICADO (pythonapps-burn-pipeline) para
// validar HPA scale-up de api02. Mismo profile agresivo que api01.
import http from 'k6/http';

export const options = {
  scenarios: {
    burn: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 400 },
        { duration: '150s', target: 400 },
        { duration: '15s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {},
};

const TARGET_URL = __ENV.TARGET_URL || 'http://api02.localhost:8888';

export default function () {
  http.get(`${TARGET_URL}/api02/items`);
}
