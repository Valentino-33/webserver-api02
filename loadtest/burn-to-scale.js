// burn-to-scale.js — usado por el Task `run-burn-to-scale` del pipeline
// (Stage 7) para validar que el HPA escala al cruzar el target de CPU.
//
// NO valida latencia ni errores — eso es Stage 5. Acá la única dimensión
// que importa es "¿se gatilla scale-up?". El éxito/falla lo decide el step
// kubectl monitor-hpa del Task, NO los thresholds de k6.
//
// Estrategia de carga:
//   - 200 VUs sostenidos sin sleep entre requests → push máximo de CPU.
//   - Duración suficiente para que HPA haga su evaluation (default 15s
//     resync, scale-up necesita ~30s de averageUtilization > target).
//   - Endpoint /api02/hello: barato pero suficiente para saturar CPU de
//     uvicorn cuando hay miles de requests/s contra 1 pod a 300m.
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
  http.get(`${TARGET_URL}/api02/hello`);
}
