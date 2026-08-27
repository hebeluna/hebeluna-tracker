// lib/cargotrack.js
//
// Este módulo es el ÚNICO lugar del proyecto que sabe que la fuente de datos
// es https://everest.cargotrack.net/m/track.asp. El cliente (navegador del
// usuario final) nunca llama a esa URL directamente: siempre pasa por
// nuestro propio backend (server.js), así que esa dirección jamás aparece
// en las herramientas de desarrollador del navegador del cliente.
//
// CÓMO FUNCIONA LA PÁGINA ORIGEN (investigado el 26/ago/2026):
//   1. Es una página clásica ASP que usa una cookie de sesión
//      (ASPSESSIONIDxxxxx). Por eso primero hacemos un GET para "abrir
//      sesión" y luego un POST con esa misma cookie.
//   2. El POST se hace a la MISMA url, con body:
//        track=<numero>&action2=process
//   3. La respuesta es HTML renderizado en el servidor (no hay una API
//      JSON). Extraemos los datos con selectores CSS (cheerio).
//
// MAPA DE ETAPAS: cargotrack.net usa una imagen "status_N.jpg" (N de 0 a 4)
// para pintar las 4 flechitas de progreso. Con guías reales confirmamos:
//   - N=0  -> "NO SE HA ENCONTRADO" (la guía no existe todavía)
//   - N=2  -> "EN TRANSITO"
//   - N=4  -> "ENTREGADO"
// N=1 y N=3 todavía no los hemos visto con una guía real. Según lo que tú
// misma describes, justo después de recibido el estado dice "EN ORIGEN"
// (no hay un estado separado de "guía asignada": la guía es solo un dato
// que aparece, no un paso del semáforo). Por eso N=1 se deja como "en
// origen" y N=3 queda como texto genérico hasta que veamos una guía real
// en esa etapa — en cuanto tengas una, la ajustamos aquí mismo.
//
// El color de cada paso sale de aquí (STAGE_INFO), pero el TEXTO que se le
// muestra al cliente sale de STATUS_TEXT_MAP más abajo, traducido del
// texto real que cargotrack.net devuelve en cada consulta — así el sitio
// siempre refleja lo que dice la fuente, no una suposición fija.
const STAGE_INFO = {
  0: { color: 'gray' },
  1: { color: 'teal' },
  2: { color: 'blue' },
  3: { color: 'indigo' },
  4: { color: 'green' },
};

// Traduce el texto de estado TAL CUAL lo devuelve cargotrack.net (en
// mayúsculas, sin acentos) al texto que quieres que vea tu cliente. Si un
// estado nuevo aparece y no está en esta lista, se muestra en "Formato
// Título" como respaldo (por ejemplo "EN ADUANA" -> "En Aduana") para que
// nunca se rompa, y conviene agregarlo aquí apenas lo veamos.
const STATUS_TEXT_MAP = {
  'EN ORIGEN': 'Recibido en Miami',
  'EN TRANSITO': 'En tránsito',
  // Cuando Everest marca "ENTREGADO" todavía no significa que el cliente
  // final ya lo tiene en sus manos: significa que ya está en nuestro poder
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

// TRADUCCIÓN DE EVENTOS: Everest describe sus propias bodegas/oficinas con
// nombres que no significan nada para tu cliente final (o que cuentan un
// paso intermedio que no necesita ver). Aquí traducimos esos textos a como
// tú le llamas a cada cosa. Se evalúan en orden y es case-insensitive;
// agregar una fila nueva es tan fácil como agregar una línea más.
const EVENT_TRANSLATIONS = [
  // Marítimo: primero llega a la bodega Santa María de Everest, y de ahí
  // pasa a la bodega donde tú retiras. De cara al cliente le llamamos
  // "bodega marítima" a ese primer paso.
  { test: /santa\s*mar[ií]a/i, replacement: 'Recibido en bodega marítima' },
  // Oficina de Everest en Managua donde llegan los paquetes.
  { test: /oficina\s*metrocentro/i, replacement: 'Recibido en Managua' },
  // "Delivered"/"Entregado" del transportista de Everest = ya está en
  // nuestro poder, listo para coordinar la entrega con el cliente.
  { test: /delivered|entregado/i, replacement: 'Listo para la entrega' },
];

function translateEventText(text) {
  for (const rule of EVENT_TRANSLATIONS) {
    if (rule.test.test(text)) return rule.replacement;
  }
  return text;
}

// Redondea el peso SOLO cuando el decimal es .50 o más, hacia el siguiente
// número entero de libras (0.70 lbs -> 1 lb, 2.50 lbs -> 3 lbs). Por debajo
// de .50 se deja exactamente como viene de la fuente, sin tocarlo
// (0.20 lbs sigue como "0.20 lbs", 2.30 lbs sigue como "2.30 lbs").
function roundWeightLabel(rawWeight) {
  if (!rawWeight) return rawWeight;
  const match = rawWeight.match(/([\d]+[.,]?[\d]*)/);
  if (!match) return rawWeight;
  const num = parseFloat(match[1].replace(',', '.'));
  if (Number.isNaN(num)) return rawWeight;
  const fraction = num - Math.floor(num);
  if (fraction < 0.5) return rawWeight;
  const rounded = Math.ceil(num);
  return `${rounded} ${rounded === 1 ? 'lb' : 'lbs'}`;
}

const SOURCE_URL = 'https://everest.cargotrack.net/m/track.asp';

const COMMON_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-NI,es;q=0.9,en;q=0.8',
};

// pequeño caché en memoria para no golpear la página origen si el mismo
// número se busca varias veces seguidas (por ejemplo, el cliente recarga).
const cache = new Map();
const CACHE_TTL_MS = 60 * 1000; // 60 segundos

function getClient() {
  // axios + cookiejar se cargan de forma perezosa para que un fallo de
  // instalación de dependencias no rompa el arranque del servidor entero.
  const axios = require('axios');
  const { wrapper } = require('axios-cookiejar-support');
  const { CookieJar } = require('tough-cookie');
  const jar = new CookieJar();
  return wrapper(axios.create({ jar, withCredentials: true, timeout: 15000 }));
}

async function fetchRawHtml(trackingNumber) {
  const client = getClient();

  // 1) GET inicial para obtener cookie de sesión ASP
  await client.get(SOURCE_URL, { headers: COMMON_HEADERS });

  // 2) POST con el número de guía/tracking
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

  // Etapa según la imagen status_N.jpg (controla solo el color/avance)
  const statusImgSrc = $('img[src*="status_"]').attr('src') || '';
  const stageMatch = statusImgSrc.match(/status_(\d+)\.jpg/i);
  const stage = stageMatch ? parseInt(stageMatch[1], 10) : null;
  const stageColor = (STAGE_INFO[stage] || {}).color || 'gray';

  // Texto de estado tal cual lo dice cargotrack (EN ORIGEN, EN TRANSITO,
  // ENTREGADO, etc.). Esto es lo que se traduce con STATUS_TEXT_MAP y se
  // le muestra al cliente — así el texto siempre coincide con lo que
  // cargotrack.net está diciendo en ese momento, no con una suposición fija.
  //
  // Se busca por elemento (no por texto aplanado de <body>): el estado
  // vive en su propio nodo, todo en mayúsculas y sin hijos. Buscar así
  // evita arrastrar letras sueltas del bloque de "Recibido el..." que le
  // sigue inmediatamente después en el HTML.
  const ALLCAPS_RE = /^[A-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ]+)*$/;
  let rawStatus = null;
  $('td,div,span,b,strong,h1,h2,h3').each((_, el) => {
    if (rawStatus) return;
    const node = $(el);
    if (node.children().length > 0) return; // solo nodos hoja
    const text = node.text().trim();
    if (text.length >= 3 && text.length <= 40 && ALLCAPS_RE.test(text)) {
      rawStatus = text;
    }
  });
  const label = translateStatusText(rawStatus) || 'Actualizando información';

  // Guía y fecha/hora de recepción: cargotrack.net pinta el título de la
  // página ("Rastree su envío", "Buscando por ...") también dentro de
  // elementos <strong class="ntextbig">, mezclados con los <strong> que sí
  // traen los datos reales. En vez de asumir una posición fija (frágil ante
  // cualquier cambio de maquetado), se identifica cada dato por su propio
  // patrón, sin importar en qué posición aparezca:
  //   - fecha: "8/20/2026"
  //   - hora: "1:42:00 PM"
  //   - guía: solo dígitos (según nos confirmaste, son 6 dígitos, pero se
  //     deja algo de margen por si acaso)
  const strongs = $('strong')
    .map((_, el) => $(el).text().trim())
    .get();
  const receivedDate =
    strongs.find((t) => /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) || null;
  const receivedTime =
    strongs.find((t) => /^\d{1,2}:\d{2}:\d{2}\s*[AP]M$/i.test(t)) || null;
  const receivedAt = receivedDate && receivedTime ? `${receivedDate} ${receivedTime}` : null;
  const guideNumber = strongs.find((t) => /^\d{4,8}$/.test(t)) || null;

  // "X bulto(s) con Y lbs" — este es el peso oficial que Everest registró
  // al recibir el paquete en Miami. Se muestra redondeado a la libra
  // entera más cercana solo cuando el decimal es .50 o más (ver
  // roundWeightLabel).
  const pkgMatch = bodyText.match(/(\d+)\s*bulto\(s\)\s*con\s*([\d.,]+\s*lbs)/i);
  const packages = pkgMatch ? pkgMatch[1] : null;
  const weight = pkgMatch ? roundWeightLabel(pkgMatch[2]) : null;

  // Eventos de seguimiento: cada fila es un <td class="ntextrow"> con el
  // texto del evento seguido de una fecha (M/D/YYYY H:MM:SS AM/PM). La
  // primera fila de esta tabla es solo un encabezado ("Eventos de
  // Seguimiento") sin fecha: se ignora en vez de mostrarse como si fuera
  // un evento real.
  const events = [];
  $('.ntextrow').each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    const m = text.match(/^(.*?)\s(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s*[AP]M)$/i);
    if (m) {
      events.push({ description: translateEventText(m[1].trim()), date: m[2].trim() });
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
    const err = new Error('Número de tracking vacío');
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
