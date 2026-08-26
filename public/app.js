// app.js
// Todo lo que este archivo hace es llamarle a NUESTRO backend (/api/track).
// El navegador del cliente nunca ve ni llama a la pagina de origen: eso
// solo ocurre del lado del servidor (ver lib/cargotrack.js).

const form = document.getElementById('track-form');
const input = document.getElementById('track-input');
const btn = document.getElementById('track-btn');
const btnLabel = btn.querySelector('.btn-label');
const btnSpinner = btn.querySelector('.btn-spinner');

const resultSection = document.getElementById('result');
const notFoundSection = document.getElementById('not-found');
const errorBox = document.getElementById('error-box');
const errorMessage = document.getElementById('error-message');

const resultTracking = document.getElementById('result-tracking');
const resultBadge = document.getElementById('result-badge');
const resultDetails = document.getElementById('result-details');
const progressEl = document.getElementById('progress');
const eventsWrap = document.getElementById('events-wrap');
const eventsList = document.getElementById('events-list');

function hideAll() {
    resultSection.hidden = true;
    notFoundSection.hidden = true;
    errorBox.hidden = true;
}

function setLoading(loading) {
    btn.disabled = loading;
    btnSpinner.hidden = !loading;
    btnLabel.textContent = loading ? 'Buscando...' : 'Rastrear';
}

// cargotrack.net maneja 5 etapas (0-4) pero al cliente le mostramos solo 3
// pasos (Recibido en Miami / En transito / Listo para entrega). Aqui se
// agrupan las etapas reales en esos 3 pasos visibles.
function toDisplayStep(stage) {
    if (stage >= 4) return 3;
    if (stage >= 2) return 2;
    if (stage >= 1) return 1;
    return 0;
}

function renderProgress(stage) {
    const step = toDisplayStep(stage);
    const items = progressEl.querySelectorAll('li');
    items.forEach((li) => {
          const s = parseInt(li.dataset.stage, 10);
          li.classList.remove('done', 'current');
          if (step >= 3 || s < step) li.classList.add('done');
          else if (s === step) li.classList.add('current');
    });
}

function renderResult(data) {
    resultTracking.textContent = data.trackingNumber;
    resultBadge.textContent = data.short || data.label;
    resultBadge.className = 'badge ' + (data.color || 'gray');

  renderProgress(data.stage || 0);

  const rows = [];
    if (data.guideNumber) {
          rows.push(`<div><strong>Guia asignada:</strong> ${escapeHtml(data.guideNumber)}</div>`);
    } else {
          rows.push(`<div><strong>Guia asignada:</strong> aun no asignada</div>`);
    }
    if (data.weight) {
          rows.push(`<div><strong>Peso registrado en Miami:</strong> ${escapeHtml(data.weight)}</div>`);
    }
    if (data.packages) {
          rows.push(`<div><strong>Bultos:</strong> ${escapeHtml(data.packages)}</div>`);
    }
    if (data.receivedAt) {
          rows.push(`<div><strong>Recibido el:</strong> ${escapeHtml(data.receivedAt)}</div>`);
    }
    resultDetails.innerHTML = rows.join('');

  if (data.events && data.events.length) {
        eventsList.innerHTML = data.events
          .map(
                    (e) =>
                                `<li><b>${escapeHtml(e.description)}</b>${e.date ? escapeHtml(e.date) : ''}</li>`
                  )
          .join('');
        eventsWrap.hidden = false;
  } else {
        eventsWrap.hidden = true;
  }

  resultSection.hidden = false;
}

function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
}

async function handleSubmit(e) {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;

  hideAll();
    setLoading(true);

  try {
        const res = await fetch(`/api/track?numero=${encodeURIComponent(value)}`);
        const data = await res.json();

      if (!res.ok) {
              throw new Error(data.error || 'Ocurrio un error al consultar.');
      }

      if (!data.found) {
              notFoundSection.hidden = false;
      } else {
              renderResult(data);
      }
  } catch (err) {
        errorMessage.textContent = err.message || 'No pudimos completar la busqueda.';
        errorBox.hidden = false;
  } finally {
        setLoading(false);
  }
}

form.addEventListener('submit', handleSubmit);

const noticesToggle = document.getElementById('notices-toggle');
const noticesPanel = document.getElementById('notices-panel');
noticesToggle.addEventListener('click', () => {
    const expanded = noticesToggle.getAttribute('aria-expanded') === 'true';
    noticesToggle.setAttribute('aria-expanded', String(!expanded));
    noticesPanel.hidden = expanded;
});

document.getElementById('year').textContent = new Date().getFullYear();
