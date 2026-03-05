const host = window.location.hostname;
const isLocalHost =
  host === "localhost" ||
  host === "127.0.0.1" ||
  host.startsWith("100.") || // Tailscale IPv4
  host.startsWith("192.168.") ||
  host.startsWith("10.") ||
  host.startsWith("172.16.") ||
  host.startsWith("172.17.") ||
  host.startsWith("172.18.") ||
  host.startsWith("172.19.") ||
  host.startsWith("172.2") ||
  host.startsWith("172.30.") ||
  host.startsWith("172.31.");

const API = isLocalHost
  ? `${window.location.protocol}//${host}:3001`
  : "https://control-horas-backend.onrender.com";
let USER_ID = null;
let selectedMonth = null;
let graficoMensualInstance = null;

window.onload = async () => {
  await initUser();

  const { data } = await client.auth.getUser();

  if (data.user) {
    USER_ID = data.user.id;
    seleccionarMesActual();
  }
};

/* ---------- MES ACTUAL ---------- */
function seleccionarMesActual() {
  const hoy = new Date();
  let month = hoy.getMonth() + 1;
  let year = hoy.getFullYear();

  if (hoy.getDate() <= 20) {
    month--;
    if (month === 0) {
      month = 12;
      year--;
    }
  }

  seleccionarMes(month, year);
}

document.querySelectorAll('.mes-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    seleccionarMes(Number(btn.dataset.month), new Date().getFullYear());
  });
});

function seleccionarMes(month, year) {
  selectedMonth = { month, year };

  document.querySelectorAll('.mes-btn').forEach(btn => {
    btn.classList.remove('activo');
  });

  document
    .querySelector(`.mes-btn[data-month="${month}"]`)
    ?.classList.add('activo');

  cargarDashboard();
}

/* ---------- DASHBOARD ---------- */
async function cargarDashboard() {
  if (!USER_ID || !selectedMonth) return;

  const res = await fetch(`${API}/resumen?user_id=${USER_ID}`);
  const resumen = await res.json();

  // 🔥 GENERAR GRÁFICO
  generarGraficoDesdeResumen(resumen);

  const key = `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, '0')}`;
  const dataMes = resumen[key] || { money: 0, hours: 0 };

  document.getElementById('totalMoney').innerText =
    `$${dataMes.money.toFixed(0)}`;

  document.getElementById('totalHours').innerText =
    `${dataMes.hours.toFixed(1)} h`;

  document.getElementById('periodo').innerText =
    `${selectedMonth.month}/${selectedMonth.year}`;

  cargarDetalle();
}

/* ---------- GRÁFICO ---------- */
function generarGraficoDesdeResumen(resumen) {
  const ctx = document.getElementById("graficoMensual");
  if (!ctx) return;

  const labels = [];
  const data = [];

  Object.keys(resumen)
    .sort()
    .forEach(key => {
      labels.push(key);
      data.push(resumen[key].money);
    });

  // destruir gráfico anterior si existe
  if (graficoMensualInstance) {
    graficoMensualInstance.destroy();
  }

  graficoMensualInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{
        label: "Ingresos por mes",
        data: data,
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          labels: {
            color: "#ffffff"
          }
        }
      },
      scales: {
        x: {
          ticks: { color: "#ffffff" }
        },
        y: {
          ticks: { color: "#ffffff" }
        }
      }
    }
  });
}

/* ---------- DETALLE ---------- */
async function cargarDetalle() {
  if (!USER_ID || !selectedMonth) return;

  const res = await fetch(
    `${API}/hours-by-month?user_id=${USER_ID}&year=${selectedMonth.year}&month=${selectedMonth.month}`
  );

  const data = await res.json();
  let html = '';

  if (data.registros && data.registros.length > 0) {
    html = `
      <table class="tabla-horas">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Horario</th>
            <th>Sector</th>
            <th>$</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
    `;

    data.registros.forEach(r => {
      html += `
        <tr>
          <td>${r.date}</td>
          <td>${r.start_time.slice(0,5)} - ${r.end_time.slice(0,5)}</td>
          <td>${r.sector}</td>
          <td>${r.money.toFixed(0)}</td>
          <td>
            <button class="btn-delete" data-id="${r.id}">🗑</button>
          </td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;
  } else {
    html = '<p>No hay horas cargadas</p>';
  }

  document.getElementById('resultado').innerHTML = html;
}

/* ---------- GUARDAR ---------- */
async function guardarHoras() {
  if (!USER_ID) {
    alert("Usuario no identificado");
    return;
  }

  const date = document.getElementById('date').value;
  const start = document.getElementById('start').value;
  const end = document.getElementById('end').value;
  const sector = document.getElementById('sector').value;

  const res = await fetch(`${API}/add-hours`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: USER_ID,
      date,
      start_time: start,
      end_time: end,
      sector
    })
  });

  if (res.ok) {
    mostrarMensajeExito();
    limpiarCampos();
    cargarDashboard();
  } else {
    alert("Error backend");
  }
}

/* ---------- MENSAJES ---------- */
function mostrarMensajeExito() {
  const mensaje = document.getElementById('mensajeExito');
  if (!mensaje) return;

  mensaje.classList.remove('oculto');
  mensaje.classList.add('visible');

  setTimeout(() => {
    mensaje.classList.remove('visible');
    mensaje.classList.add('oculto');
  }, 3000);
}

function mostrarMensajeBorrado() {
  const mensaje = document.getElementById('mensajeBorrado');
  if (!mensaje) return;

  mensaje.classList.remove('oculto');
  mensaje.classList.add('visible');

  setTimeout(() => {
    mensaje.classList.remove('visible');
    mensaje.classList.add('oculto');
  }, 3000);
}

/* ---------- LIMPIAR ---------- */
function limpiarCampos() {
  document.getElementById('date').value = '';
  document.getElementById('start').value = '';
  document.getElementById('end').value = '';
  document.getElementById('sector').value = '';
}

/* ---------- BORRAR ---------- */
document.getElementById('resultado').addEventListener('click', (e) => {
  if (e.target.tagName === 'BUTTON' && e.target.dataset.id) {
    borrarHora(e.target.dataset.id);
  }
});

async function borrarHora(id) {
  const res = await fetch(`${API}/delete-hour/${id}`, {
    method: 'DELETE'
  });

  if (res.ok) {
    mostrarMensajeBorrado();
    cargarDashboard();
  } else {
    alert("Error al borrar");
  }
}
