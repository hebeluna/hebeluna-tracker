# Hebeluna Express — Portal de rastreo

Sitio de rastreo de paquetes para clientes de Hebeluna Express. El cliente
solo ve tu marca y tu dominio; nunca ve ni puede llegar a la página de
Cargotrack que usamos como fuente de datos (esa consulta ocurre del lado
del servidor, en `lib/cargotrack.js`).

## ¿Qué hay aquí?

- `server.js` — servidor web (Node + Express). Sirve el sitio y expone
  `/api/track?numero=...`.
- `lib/cargotrack.js` — el único archivo que sabe que la fuente es
  `everest.cargotrack.net`. Aquí se arma la consulta y se interpreta el
  resultado.
- `public/` — el sitio que ve el cliente (HTML, CSS, JS, logo).

## Cómo se arma el texto de estado

El sitio NO usa una etiqueta fija por etapa: toma el texto real que
cargotrack.net devuelve en cada consulta (por ejemplo `EN ORIGEN`,
`EN TRANSITO`, `ENTREGADO`) y lo traduce con `STATUS_TEXT_MAP`, en
`lib/cargotrack.js`. Así el sitio siempre refleja lo que dice la fuente en
ese momento, no una suposición fija.

```js
// lib/cargotrack.js
const STATUS_TEXT_MAP = {
  'EN ORIGEN': 'Recibido en Miami',
  'EN TRANSITO': 'En tránsito',
  ENTREGADO: 'Listo para la entrega',
};
```

Con guías reales confirmamos `EN TRANSITO` y `ENTREGADO`. Si cargotrack usa
un texto que no está en esta lista, el sitio no se rompe: lo muestra tal
cual en "Formato Título" como respaldo, y basta con agregarlo aquí como una
línea más en cuanto lo veamos.

## Traducir textos del historial de eventos

Everest describe sus propias bodegas y oficinas con nombres internos que no
significan nada para tu cliente (o que no quieres que vea). En el mismo
archivo `lib/cargotrack.js` está la lista `EVENT_TRANSLATIONS`, donde
cualquier texto que coincida se reemplaza antes de mostrarse:

```js
const EVENT_TRANSLATIONS = [
  { test: /santa\s*mar[ií]a/i, replacement: 'Recibido en bodega marítima' },
  { test: /oficina\s*metrocentro/i, replacement: 'Recibido en Managua' },
  { test: /delivered|entregado/i, replacement: 'Listo para la entrega' },
];
```

Para agregar una nueva traducción, solo se agrega una línea más con el
patrón a buscar y el texto que quieres mostrar en su lugar.

## El código ya está en GitHub — falta publicarlo

Este repositorio ya tiene todo el código. Lo único que falta para tener un
**link real que funcione para cualquiera** es publicarlo con Render
(gratis para empezar), en un solo paso.

### Publicarlo en Render

1. Crea una cuenta gratis en [render.com](https://render.com) — lo más
   rápido es registrarte directamente con tu cuenta de GitHub.
2. En el panel de Render, clic en **"New +" → "Web Service"**.
3. Conecta tu cuenta de GitHub y selecciona el repositorio
   `hebeluna-tracker`.
4. Render va a detectar que es un proyecto Node. Confirma estos valores:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Clic en **"Create Web Service"**. Render va a instalar todo y
   publicarlo — toma 1 o 2 minutos.
6. Cuando termine, te da una URL parecida a
   `https://hebeluna-tracker.onrender.com`. Esa es tu página en vivo,
   lista para compartir con tus clientes.

> Nota sobre el plan gratis: si nadie visita el sitio por 15 minutos, se
> "duerme" y la primera visita después de eso tarda unos segundos extra en
> despertar. Para que esté siempre activo al instante, Render tiene un plan
> pagado desde $7/mes — no es necesario para empezar.

### (Opcional) Usar tu propio dominio

Si más adelante compras un dominio como `rastreo.hebelunaexpress.com`, en
Render vas a **Settings → Custom Domain** y sigues las instrucciones para
apuntarlo.

## Cómo compartirlo con tus clientes

Una vez publicado, la URL que te da Render ya es corta y suficiente para
compartir tal cual. Algunas formas simples de ponerla frente a tus
clientes:

- **WhatsApp Business:** pégala en tu mensaje de saludo automático o en la
  sección "Enlace del catálogo/sitio web" de tu perfil de negocio.
- **Instagram / Facebook:** pégala como el link de tu bio o del botón
  "Sitio web" de tu página de Facebook.
- **Código QR:** cualquier generador gratis de QR convierte esa URL en un
  código que puedes poner en tus facturas, recibos o un rótulo en la
  oficina.
- **Dominio propio más corto** (opcional, más adelante): apúntalo a Render
  para que se vea más profesional.

## Actualizar el sitio más adelante

Cualquier cambio (texto, colores, nuevos avisos) se hace editando los
archivos de este repositorio en GitHub — Render vuelve a publicar
automáticamente en cuanto detecta el cambio.

## Probarlo en este momento, en tu computadora (opcional)

Si tienes Node.js instalado:

```bash
npm install
npm start
```

Y abres `http://localhost:3000` en tu navegador.
