// server.js
//
// Backend de Hebeluna Express Tracker.
// Sirve el sitio (carpeta /public) y expone /api/track, que es la UNICA
// puerta de entrada del cliente a la informacion de rastreo. Este archivo
// nunca expone al navegador del cliente la URL de la fuente de datos
// (eso vive unicamente en lib/cargotrack.js, del lado del servidor).

const path = require('path');
const express = require('express');
const { trackPackage } = require('./lib/cargotrack');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));

// Limite simple para evitar abuso / no saturar al proveedor de origen.
const hits = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;
function rateLimit(req, res, next) {
    const ip = req.ip || 'anon';
    const now = Date.now();
    const entry = hits.get(ip) || { count: 0, start: now };
    if (now - entry.start > WINDOW_MS) {
          entry.count = 0;
          entry.start = now;
    }
    entry.count += 1;
    hits.set(ip, entry);
    if (entry.count > MAX_PER_WINDOW) {
          return res.status(429).json({ error: 'Demasiadas busquedas, intenta de nuevo en un minuto.' });
    }
    next();
}

app.get('/api/track', rateLimit, async (req, res) => {
    const trackingNumber = (req.query.numero || req.query.number || '').toString().trim();

          if (!trackingNumber) {
                return res.status(400).json({ error: 'Falta el numero de tracking o guia.' });
          }
    if (trackingNumber.length > 60) {
          return res.status(400).json({ error: 'Numero de tracking invalido.' });
    }

          try {
                const result = await trackPackage(trackingNumber);
                res.json(result);
          } catch (err) {
                console.error('Error consultando tracking:', err.message);
                res.status(502).json({
                        error: 'No pudimos consultar el estado en este momento. Intenta de nuevo en unos minutos.',
                });
          }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
    console.log(`Hebeluna Express Tracker escuchando en el puerto ${PORT}`);
});
