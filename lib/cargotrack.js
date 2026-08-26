// lib/cargotrack.js
//
// Este modulo es el UNICO lugar del proyecto que sabe que la fuente de datos
// es https://everest.cargotrack.net/m/track.asp. El cliente (navegador del
// usuario final) nunca llama a esa URL directamente: siempre pasa por
// nuestro propio backend (server.js), asi que esa direccion jamas aparece
// en las herramientas de desarrollador del navegador del cliente.
//
// COMO FUNCIONA LA PAGINA ORIGEN (investigado el 26/ago/2026):
//   1. Es una pagina clasica ASP que usa una cookie de sesion
//      (ASPSESSIONIDxxxxx). Por eso primero hacemos un GET para abrir
//      sesion y luego un POST con esa misma cookie.
//   2. El POST se hace a la MISMA url, con body:
//        track=<numero>&action2=process
//   3. La respuesta es HTML renderizado en el servidor (no hay una API
//      JSON). Extraemos los datos con selectores CSS (cheerio).
//
// MAPA DE ETAPAS: cargotrack.net usa una imagen status_N.jpg (N de 0 a 4)
// para pintar las 4 flechitas de progreso. Con guias reales confirmamos:
//   - N=0  -> NO SE HA ENCONTRADO (la guia no existe todavia)
//   - N=2  -> EN TRANSITO
//   - N=4  -> ENTREGADO
// N=1 y N=3 todavia no los hemos visto con una guia real. Segun lo que tu
// misma describes, justo despues de recibido el estado dice EN ORIGEN
// (no hay un estado separado de guia asignada: la guia es solo un dato
// que aparece, no un paso del semaforo). Por eso N=1 se deja como en
// origen y N=3 queda como texto generico hasta que veamos una guia real
// en esa etapa: en cuanto tengas una, la ajustamos aqui mismo.
//
// El color de cada paso sale de aqui (STAGE_INFO), pero el TEXTO que se le
// muestra al cliente sale de STATUS_TEXT_MAP mas abajo, traducido del
// texto real que cargotrack.net devuelve en cada consulta: asi el sitio
// siempre refleja lo que dice la fuente, no una suposicion fija.
const STAGE_INFO = {
    0: { color: 'gray' },
    1: { color: 'teal' },
    2: { color: 'blue' },
    3: { color: 'indigo' },
    4: { color: 'green' },
};

// Traduce el texto de estado TAL CUAL lo devuelve cargotrack.net (en
// mayusculas, sin acentos) al texto que quieres que vea tu cliente. Si un
// estado nuevo aparece y no esta en esta lista, se muestra en Formato
// Titulo como respaldo (por ejemplo EN ADUANA -> En Aduana) para que
// nunca se rompa, y conviene agregarlo aqui apenas lo veamos.
const STATUS_TEXT_MAP = {
    'EN ORIGEN': 'Recibido en Miami',
    'EN TRANSITO': 'En tránsito',
    // Cuando Everest marca ENTREGADO todavia no significa que el cliente
    // final ya lo tiene en sus manos: significa que ya esta en nuestro poder
    // en Nicaragua, listo para coordinar la entrega.
    ENTREGADO: 'Listo para la entrega',
};

function titleCase(text) {
    return text
      .toLowerCase()
      .split(' ')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
}

function translateStatusText(rawStatus) {
    if (!rawStatus) return null;
    const key = rawStatus.trim().toUpperCase();
    return STATUS_TEXT_MAP[key] || titleCase(rawStatus);
}

// TRADUCCION DE EVENTOS: Everest describe sus propias bodegas/oficinas con
// nombres que no significan nada para tu cliente final. Aqui traducimos
// esos textos a como tu le llamas a cada cosa. Se evaluan en orden y es
// case-insensitive; agregar una fila nueva es tan facil como agregar una
// linea mas.
const EVENT_TRANSLATIONS = [
    // Maritimo: primero llega a la bodega Santa Maria de Everest, y de ahi
    // pasa a la bodega donde tu retiras. De cara al cliente le llamamos
    // bodega maritima a ese primer paso.
  { test: /santa\s*mar[ií]a/i, replacement: 'Recibido en bodega marítima' },
    // Oficina de Everest en Managua donde llegan los paquetes.
  { test: /oficina\s*metrocentro/i, replacement: 'Recibido en Managua' },
    // Delivered/Entregado del transportista de Everest = ya esta en
    // nuestro poder, listo para coordinar la entrega con el cliente.
  { test: /delivered|entregado/i, replacement: 'Listo para la entrega' },
  ];

function translateEventText(text) {
    for (const rule of EVENT_TRANSLATIONS) {
          if (rule.test.test(text)) return rule.replacement;
    }
    return text;
}

const SOURCE_URL = 'https://everest.cargotrack.net/m/track.asp';

const COMMON_HEADERS = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'es-NI,es;q=0.9,en;q=0.8',
};

// pequeno cache en memoria para no golpear la pagina origen si el mismo
// numero se busca varias veces seguidas (por ejemplo, el cliente recarga).
const cache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60 segundos

function getClient() {
    const axios = require('axios');
    const { wrapper } = require('axios-cookiejar-support');
    const { CookieJar } = require('tough-cookie');
    const jar = new CookieJar();
    return wrapper(axios.create({ jar, withCredentials: true, timeout: 15000 }));
}

async function fetchRawHtml(trackingNumber) {
    const client = getClient();

  await client.get(SOURCE_URL, { headers: COMMON_HEADERS });

  const body = new URLSearchParams({
        track: trackingNumber,
        action2: 'process',
  }).toString();

  const { data: html } = await client.post(SOURCE_URL, body, {
        headers: {
                ...COMMON_HEADERS,
                'Content-Type': 'application/x-www-form-urlencoded',
                Referer: SOURCE_URL,
        },
  });

  return html;
}

function parseHtml(html, trackingNumber) {
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();

  if (/NO SE HA ENCONTRADO/i.test(bodyText)) {
        return {
                found: false,
                trackingNumber,
                stage: 0,
                label: 'No encontrado',
                short: 'No encontrado',
                color: STAGE_INFO[0].color,
                guideNumber: null,
                receivedAt: null,
                packages: null,
                weight: null,
                events: [],
                rawStatus: 'NO SE HA ENCONTRADO',
        };
  }

  const statusImgSrc = $('img[src*="status_"]').attr('src') || '';
    const stageMatch = statusImgSrc.match(/status_(\d+)\.jpg/i);
    const stage = stageMatch ? parseInt(stageMatch[1], 10) : null;
    const stageColor = (STAGE_INFO[stage] || {}).color || 'gray';

  const ALLCAPS_RE = /^[A-Z]+(?:\s+[A-Z]+)*$/;
    let rawStatus = null;
    $('td,div,span,b,strong,h1,h2,h3').each((_, el) => {
          if (rawStatus) return;
          const node = $(el);
          if (node.children().length > 0) return;
          const text = node.text().trim();
          if (text.length >= 3 && text.length <= 40 && ALLCAPS_RE.test(text)) {
                  rawStatus = text;
          }
    });
    const label = translateStatusText(rawStatus) || 'Actualizando informacion';

  const guideNumber = $('.ntextbig').first().text().trim() || null;

  const strongs = $('strong')
      .map((_, el) => $(el).text().trim())
      .get();
    const receivedDate = strongs[0] || null;
    const receivedTime = strongs[1] || null;
    const receivedAt = receivedDate && receivedTime ? `${receivedDate} ${receivedTime}` : null;

  const pkgMatch = bodyText.match(/(\d+)\s*bulto\(s\)\s*con\s*([\d.,]+\s*lbs)/i);
    const packages = pkgMatch ? pkgMatch[1] : null;
    const weight = pkgMatch ? pkgMatch[2] : null;

  const events = [];
    $('.ntextrow').each((_, el) => {
          const text = $(el).text().trim().replace(/\s+/g, ' ');
          const m = text.match(/^(.*?)\s(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M)$/i);
          if (m) {
                  events.push({ description: translateEventText(m[1].trim()), date: m[2].trim() });
          } else if (text) {
                  events.push({ description: translateEventText(text), date: null });
          }
    });

  return {
        found: true,
        trackingNumber,
        stage,
        label,
        short: label,
        color: stageColor,
        rawStatus,
        guideNumber,
        receivedAt,
        packages,
        weight,
        events,
  };
}

async function trackPackage(trackingNumber) {
    const clean = String(trackingNumber || '').trim();
    if (!clean) {
          const err = new Error('Numero de tracking vacio');
          err.status = 400;
          throw err;
    }

  const cached = cache.get(clean);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
          return cached.data;
    }

  const html = await fetchRawHtml(clean);
    const result = parseHtml(html, clean);
    cache.set(clean, { at: Date.now(), data: result });
    return result;
}

module.exports = { trackPackage, STAGE_INFO, parseHtml, translateEventText, translateStatusText };
