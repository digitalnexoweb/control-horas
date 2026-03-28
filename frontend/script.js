const REMOTE_API = "https://control-horas-waxk.onrender.com";
const LOCAL_API_PORT = "3001";

function isLoopbackHost(host) {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

function isPrivateIpHost(host) {
  return (
    host.startsWith("100.") ||
    host.startsWith("192.168.") ||
    host.startsWith("10.") ||
    host.startsWith("172.16.") ||
    host.startsWith("172.17.") ||
    host.startsWith("172.18.") ||
    host.startsWith("172.19.") ||
    host.startsWith("172.2") ||
    host.startsWith("172.30.") ||
    host.startsWith("172.31.")
  );
}

function isTailnetDnsHost(host) {
  return host.endsWith(".ts.net") || host.endsWith(".beta.tailscale.net");
}

function isSingleLabelHost(host) {
  return /^[a-z0-9-]+$/i.test(host) && !host.includes(".");
}

function isPrivateOrTailnetHost(host) {
  return isPrivateIpHost(host) || isTailnetDnsHost(host) || isSingleLabelHost(host);
}

function getLocalApiUrl(host) {
  return `${window.location.protocol}//${host}:${LOCAL_API_PORT}`;
}

function resolveApiBaseUrl() {
  const host = window.location.hostname;
  const apiParam = new URLSearchParams(window.location.search).get("api");

  if (apiParam === "local") {
    return getLocalApiUrl(host);
  }

  if (apiParam === "remote") {
    return REMOTE_API;
  }

  if (apiParam) {
    try {
      return new URL(apiParam).toString().replace(/\/$/, "");
    } catch (error) {
      console.warn("Parametro api invalido, se usara la API remota", error);
    }
  }

  if (isLoopbackHost(host) || isPrivateOrTailnetHost(host)) {
    return getLocalApiUrl(host);
  }

  return REMOTE_API;
}

const API = resolveApiBaseUrl();
console.info("[control-horas] API base:", API, "host:", window.location.hostname);

const MONTH_NAMES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre"
];
const MONTH_SHORT_NAMES = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic"
];

let USER_ID = null;
let selectedMonth = null;
let graficoMensualInstance = null;
let currentMonthRegistros = [];
let calendarView = null;
let calendarWorkedDays = new Set();
let calendarSelectedDate = "";
let toastTimeout = null;
let currentProfile = null;
let editingHourId = null;
let currentAuthUser = null;
let currentUserSectors = [];

const PROFILE_STORAGE_PREFIX = "controlHorasPerfil:";
const RECEIPT_STORAGE_PREFIX = "controlHorasRecibos:";
const THEME_STORAGE_KEY = "controlHorasTheme";
const DEFAULT_BILLING_CUTOFF_DAY = 20;

function getPreferredTheme() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (savedTheme === "dark" || savedTheme === "light") return savedTheme;
  return "light";
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.body.classList.toggle("dark-mode", isDark);
  document.body.classList.toggle("light-mode", !isDark);
  localStorage.setItem(THEME_STORAGE_KEY, isDark ? "dark" : "light");

  const themeToggle = document.getElementById("themeToggle");
  if (!themeToggle) return;
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.setAttribute("aria-label", isDark ? "Activar modo claro" : "Activar modo oscuro");
  themeToggle.textContent = isDark ? "☀️ Modo claro" : "🌙 Modo oscuro";
}

function initThemeToggle() {
  applyTheme(getPreferredTheme());

  const themeToggle = document.getElementById("themeToggle");
  if (!themeToggle) return;

  themeToggle.addEventListener("click", () => {
    const isDark = document.body.classList.contains("dark-mode");
    applyTheme(isDark ? "light" : "dark");
  });
}

applyTheme(getPreferredTheme());

window.onload = async () => {
  initThemeToggle();
  initSideFeatures();
  initCalendarControls();
  initEditModal();
  initDetailModal();
  await initUser();

  const { data } = await client.auth.getUser();
  if (!data.user) return;

  currentAuthUser = data.user;
  USER_ID = data.user.id;
  updateProfileIdentity(data.user);
  await loadProfile();
  await loadUserSectors();
  loadReceipts();
  seleccionarMesActual();
  await refreshCalendarFromControls();
};

function getPayPeriodLabel(month, year) {
  if (!month || !year) return "--";
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function normalizeBillingCutoffDay(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) {
    return DEFAULT_BILLING_CUTOFF_DAY;
  }

  return parsed;
}

function getBillingPeriodDescription(cutoffDay = DEFAULT_BILLING_CUTOFF_DAY) {
  const normalizedCutoff = normalizeBillingCutoffDay(cutoffDay);
  const startDay = normalizedCutoff === 31 ? 1 : normalizedCutoff + 1;
  return `Cierre del ${startDay} al ${normalizedCutoff} según tu perfil.`;
}

function updateDashboardPeriodNote() {
  const periodNoteEl = document.getElementById("periodoNota");
  if (!periodNoteEl) return;
  periodNoteEl.textContent = getBillingPeriodDescription(currentProfile?.billing_cutoff_day);
}

function formatMonthKey(key) {
  if (!key || typeof key !== "string") return key || "";
  const [year, month] = key.split("-");
  const monthIndex = Number(month) - 1;
  if (!year || monthIndex < 0 || monthIndex > 11) return key;
  return `${MONTH_SHORT_NAMES[monthIndex]} ${year}`;
}

function formatDateLatam(isoDate) {
  if (!isoDate || typeof isoDate !== "string") return isoDate || "";
  const [year, month, day] = isoDate.split("-");
  if (!year || !month || !day) return isoDate;
  return `${day}/${month}/${year}`;
}

function formatTimeLabel(value) {
  return String(value || "").slice(0, 5);
}

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "No definido";
  return `$${amount.toFixed(2)}`;
}

function formatMoneyCompact(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? `$${amount.toFixed(0)}` : "$0";
}

function formatHours(value) {
  const hours = Number(value);
  return Number.isFinite(hours) ? `${hours.toFixed(1)} h` : "0.0 h";
}

function updateHourlyRateUI(hourlyRate, hourlyRateNight, billingCutoffDay = DEFAULT_BILLING_CUTOFF_DAY) {
  const hourlyRateEl = document.getElementById("currentHourlyRate");
  const hourlyRateNightEl = document.getElementById("currentHourlyRateNight");
  const billingCutoffEl = document.getElementById("currentBillingCutoffDay");
  if (hourlyRateEl) hourlyRateEl.textContent = formatCurrency(hourlyRate);
  if (hourlyRateNightEl) hourlyRateNightEl.textContent = formatCurrency(hourlyRateNight);
  if (billingCutoffEl) billingCutoffEl.textContent = String(normalizeBillingCutoffDay(billingCutoffDay));
}

function getUserDisplayName(user) {
  const metadataName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.user_metadata?.display_name ||
    "";

  if (metadataName && String(metadataName).trim()) {
    return String(metadataName).trim();
  }

  const email = String(user?.email || "").trim();
  if (!email) return "Usuario";

  const localPart = email.split("@")[0] || "";
  if (!localPart) return "Usuario";

  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getUserInitials(name, email) {
  const source = String(name || "").trim();
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean);
    const initials = parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join("");
    if (initials) return initials;
  }

  const fallback = String(email || "").trim().charAt(0).toUpperCase();
  return fallback || "U";
}

function updateProfileIdentity(user = currentAuthUser) {
  const profileUserName = document.getElementById("profileUserName");
  const profileUserEmail = document.getElementById("profileUserEmail");
  const profileUserAvatar = document.getElementById("profileUserAvatar");

  if (!profileUserName || !profileUserEmail || !profileUserAvatar) return;

  const name = getUserDisplayName(user);
  const email = String(user?.email || "").trim() || "Sin email disponible";

  profileUserName.textContent = name;
  profileUserEmail.textContent = email;
  profileUserAvatar.textContent = getUserInitials(name, email);
}

function syncModalBodyLock() {
  const hasOpenModal = Boolean(document.querySelector(".receipt-preview-modal:not(.hidden)"));
  document.body.classList.toggle("modal-open", hasOpenModal);
}

function openModalElement(modal) {
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  syncModalBodyLock();
}

function closeModalElement(modal) {
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  syncModalBodyLock();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeSectorName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function updateDetailSummary() {
  const summary = document.getElementById("detailSummaryText");
  if (!summary) return;

  const count = currentMonthRegistros.length;
  if (!selectedMonth) {
    summary.textContent = "Revisá tus registros sin ocupar toda la pantalla principal.";
    return;
  }

  const periodLabel = getPayPeriodLabel(selectedMonth.month, selectedMonth.year);
  if (!count) {
    summary.textContent = `No hay registros cargados para ${periodLabel}.`;
    return;
  }

  summary.textContent = `${count} ${count === 1 ? "registro cargado" : "registros cargados"} para ${periodLabel}.`;
}

function buildSectorOptions(selectedValue = "", { allowLegacy = false } = {}) {
  const normalizedSelected = normalizeSectorName(selectedValue);
  const sectors = [...currentUserSectors];

  if (allowLegacy && normalizedSelected && !sectors.some((sector) => sector.name === normalizedSelected)) {
    sectors.push({ id: `legacy-${normalizedSelected}`, name: normalizedSelected, legacy: true });
  }

  const placeholder = sectors.length
    ? "Seleccionar sector"
    : "Primero creá un sector en tu perfil";
  const options = [`<option value="">${placeholder}</option>`];
  sectors.forEach((sector) => {
    const label = sector.legacy ? `${sector.name} (actual)` : sector.name;
    options.push(`<option value="${escapeHtml(sector.name)}">${escapeHtml(label)}</option>`);
  });
  return options.join("");
}

function renderSectorSelect(selectId, selectedValue, options = {}) {
  const select = document.getElementById(selectId);
  if (!select) return;

  const fallbackValue = selectedValue !== undefined ? selectedValue : select.value;
  const normalizedValue = normalizeSectorName(fallbackValue);
  select.innerHTML = buildSectorOptions(normalizedValue, options);
  select.value = normalizedValue;
  if (select.value !== normalizedValue) {
    select.value = "";
  }
}

function renderSectorSelects() {
  renderSectorSelect("sector");
  renderSectorSelect("calendarQuickSector");
  renderSectorSelect("editHourSector", document.getElementById("editHourSector")?.value || "", { allowLegacy: true });
}

function renderSectorList() {
  const sectorList = document.getElementById("sectorList");
  if (!sectorList) return;

  if (!currentUserSectors.length) {
    sectorList.innerHTML = '<p class="empty-state">Todavía no creaste sectores. Agregá el primero para usarlo al cargar horas.</p>';
    return;
  }

  sectorList.innerHTML = currentUserSectors
    .map(
      (sector) => `
        <div class="sector-item">
          <span class="sector-name">${escapeHtml(sector.name)}</span>
          <button type="button" class="btn-delete" data-sector-id="${sector.id}">Eliminar</button>
        </div>
      `
    )
    .join("");
}

async function loadUserSectors() {
  if (!USER_ID) return;

  const { data, error } = await client
    .from("user_sectors")
    .select("id, name")
    .eq("user_id", USER_ID)
    .order("name", { ascending: true });

  if (error) {
    console.error("No se pudieron cargar sectores:", error);
    currentUserSectors = [];
    renderSectorList();
    renderSectorSelects();
    showToast("No se pudieron cargar los sectores", "error");
    return;
  }

  currentUserSectors = (data || [])
    .map((sector) => ({
      id: sector.id,
      name: normalizeSectorName(sector.name)
    }))
    .filter((sector) => sector.name);

  renderSectorList();
  renderSectorSelects();
}

function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return;

  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }

  container.innerHTML = `<div class="toast ${type}" role="status">${message}</div>`;

  toastTimeout = setTimeout(() => {
    const toast = container.querySelector(".toast");
    if (!toast) return;
    toast.classList.add("fade-out");
    setTimeout(() => {
      container.innerHTML = "";
    }, 220);
  }, 2500);
}

window.showToast = showToast;

function setButtonLoading(button, isLoading, loadingText) {
  if (!button) return;
  if (!button.dataset.defaultText) {
    button.dataset.defaultText = button.textContent.trim();
  }
  button.disabled = isLoading;
  button.classList.toggle("is-loading", isLoading);
  button.textContent = isLoading ? loadingText : button.dataset.defaultText;
}

async function apiFetch(path, options = {}) {
  const {
    method = "GET",
    body,
    query,
    headers = {},
    errorMessage = "Ocurrió un error al procesar la solicitud"
  } = options;

  const url = new URL(`${API}${path}`);
  if (query) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });
  }

  const requestOptions = {
    method,
    headers: { ...headers }
  };

  if (body !== undefined) {
    requestOptions.headers["Content-Type"] = "application/json";
    requestOptions.body = JSON.stringify(body);
  }

  let response;
  const requestUrl = url.toString();
  console.info("[control-horas] Request", method, requestUrl, query || null);
  try {
    response = await fetch(requestUrl, requestOptions);
  } catch (error) {
    console.error("[control-horas] Network error", {
      method,
      url: requestUrl,
      error
    });
    throw new Error(`No se pudo conectar con el servidor (${requestUrl})`);
  }

  let data = null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      data = await response.json();
    } catch (error) {
      data = null;
    }
  } else {
    const text = await response.text();
    data = text ? { raw: text } : null;
  }

  if (!response.ok) {
    const message = data?.error || data?.message || errorMessage;
    console.error("[control-horas] HTTP error", {
      method,
      url: requestUrl,
      status: response.status,
      data
    });
    throw new Error(message);
  }

  console.info("[control-horas] Response OK", method, requestUrl, response.status);
  return data;
}

async function refreshAfterHoursChange({ refreshDashboard = true, refreshCalendar = true } = {}) {
  if (refreshDashboard && selectedMonth) {
    await cargarDashboard();
  } else if (selectedMonth) {
    await cargarDetalle();
  }

  if (refreshCalendar) {
    await refreshCalendarFromControls();
  }
}

function seleccionarMesActual() {
  const hoy = new Date();
  seleccionarMes(hoy.getMonth() + 1, hoy.getFullYear());
}

document.querySelectorAll(".mes-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    seleccionarMes(Number(btn.dataset.month), new Date().getFullYear());
  });
});

function seleccionarMes(month, year) {
  selectedMonth = { month, year };

  document.querySelectorAll(".mes-btn").forEach((btn) => {
    btn.classList.remove("activo");
  });

  document.querySelector(`.mes-btn[data-month="${month}"]`)?.classList.add("activo");
  cargarDashboard();
}

async function cargarDashboard() {
  if (!USER_ID || !selectedMonth) return;

  try {
    const resumen = await apiFetch("/resumen", {
      query: { user_id: USER_ID },
      errorMessage: "No se pudo cargar el resumen mensual"
    });

    generarGraficoDesdeResumen(resumen || {});

    const key = `${selectedMonth.year}-${String(selectedMonth.month).padStart(2, "0")}`;
    const dataMes = resumen?.[key] || { money: 0, hours_total: 0, hours_normal: 0, hours_night: 0 };
    const monthMoney = Number(dataMes.money) || 0;
    const monthHours = Number(dataMes.hours_total) || 0;
    const monthHoursNormal = Number(dataMes.hours_normal) || 0;
    const monthHoursNight = Number(dataMes.hours_night) || 0;

    document.getElementById("totalMoney").innerText = formatMoneyCompact(monthMoney);
    document.getElementById("totalHours").innerText = formatHours(monthHours);
    document.getElementById("normalHours").innerText = `${monthHoursNormal.toFixed(1)} h normales`;
    document.getElementById("nightHours").innerText = `${monthHoursNight.toFixed(1)} h nocturnas`;
    document.getElementById("periodo").innerText = getPayPeriodLabel(selectedMonth.month, selectedMonth.year);
    updateDashboardPeriodNote();

    await cargarDetalle();
  } catch (error) {
    showToast(error.message || "No se pudo cargar el dashboard", "error");
  }
}

function generarGraficoDesdeResumen(resumen) {
  const ctx = document.getElementById("graficoMensual");
  if (!ctx) return;

  const labels = [];
  const data = [];

  Object.keys(resumen)
    .sort()
    .forEach((key) => {
      labels.push(formatMonthKey(key));
      data.push(Number(resumen[key].money) || 0);
    });

  if (graficoMensualInstance) {
    graficoMensualInstance.destroy();
  }

  graficoMensualInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Ingresos por mes",
          data,
          borderWidth: 0,
          borderRadius: 8,
          backgroundColor: "rgba(93, 151, 255, 0.85)",
          hoverBackgroundColor: "rgba(141, 182, 255, 0.95)"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: "#dbeafe",
            boxWidth: 10,
            boxHeight: 10
          }
        }
      },
      scales: {
        x: {
          ticks: { color: "#c7d2fe" },
          grid: { color: "rgba(148, 163, 184, 0.15)" }
        },
        y: {
          ticks: { color: "#c7d2fe" },
          grid: { color: "rgba(148, 163, 184, 0.15)" }
        }
      }
    }
  });
}

function buildDetailRows(registros) {
  return registros
    .map((r) => {
      const normalHours = Number(r.worked_hours_normal) || 0;
      const nightHours = Number(r.worked_hours_night) || 0;
      return `
        <tr>
          <td data-label="Fecha">
            <div class="detail-primary">${formatDateLatam(r.date)}</div>
          </td>
          <td data-label="Horario">
            <div class="detail-primary">${formatTimeLabel(r.start_time)} - ${formatTimeLabel(r.end_time)}</div>
            <div class="detail-secondary">${formatHours(normalHours)} normales · ${formatHours(nightHours)} nocturnas</div>
          </td>
          <td data-label="Sector">
            <div class="detail-primary">${r.sector || "-"}</div>
          </td>
          <td data-label="Monto">
            <div class="detail-primary">${formatMoneyCompact(r.money)}</div>
          </td>
          <td data-label="Acciones" class="actions-cell">
            <div class="table-actions">
              <button type="button" class="btn-edit" data-edit-id="${r.id}">Editar</button>
              <button type="button" class="btn-delete" data-delete-id="${r.id}">Eliminar</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

async function cargarDetalle() {
  if (!USER_ID || !selectedMonth) return;

  try {
    const data = await apiFetch("/hours-by-month", {
      query: {
        user_id: USER_ID,
        year: selectedMonth.year,
        month: selectedMonth.month
      },
      errorMessage: "No se pudo cargar el detalle de horas"
    });

    currentMonthRegistros = data?.registros || [];
    updateDetailSummary();

    const resultado = document.getElementById("resultado");
    if (!resultado) return;

    if (!currentMonthRegistros.length) {
      resultado.innerHTML = '<p class="empty-state">No hay horas cargadas para este período.</p>';
      return;
    }

    resultado.innerHTML = `
      <table class="tabla-horas">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Horario</th>
            <th>Sector</th>
            <th>Monto</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          ${buildDetailRows(currentMonthRegistros)}
        </tbody>
      </table>
    `;
  } catch (error) {
    showToast(error.message || "No se pudo cargar el detalle", "error");
  }
}

async function guardarHoras() {
  const saveButton = document.getElementById("saveHoursBtn");
  setButtonLoading(saveButton, true, "Guardando...");

  try {
    const date = document.getElementById("date").value;
    const start = document.getElementById("start").value;
    const end = document.getElementById("end").value;
    const sector = document.getElementById("sector").value;

    const saved = await saveHoursEntry({ date, startTime: start, endTime: end, sector });
    if (saved) limpiarCampos();
  } finally {
    setButtonLoading(saveButton, false);
  }
}

async function saveHoursEntry({ date, startTime, endTime, sector }) {
  if (!USER_ID) {
    showToast("Usuario no identificado", "error");
    return false;
  }

  if (!currentUserSectors.length) {
    showToast("Primero agregá al menos un sector en Perfil", "error");
    return false;
  }

  const hourlyRate = Number(currentProfile?.hourly_rate);
  const hourlyRateNight = Number(currentProfile?.hourly_rate_night);
  if (!Number.isFinite(hourlyRate) || hourlyRate <= 0 || !Number.isFinite(hourlyRateNight) || hourlyRateNight <= 0) {
    showToast("Definí valor por hora normal y nocturno en Perfil antes de cargar horas", "error");
    return false;
  }

  if (!date || !startTime || !endTime || !sector) {
    showToast("Completá fecha, horas y sector", "error");
    return false;
  }

  try {
    await apiFetch("/add-hours", {
      method: "POST",
      body: {
        user_id: USER_ID,
        date,
        start_time: startTime,
        end_time: endTime,
        sector
      },
      errorMessage: "No se pudo guardar la hora"
    });

    showToast("Hora guardada correctamente", "success");
    await refreshAfterHoursChange();
    return true;
  } catch (error) {
    showToast(error.message || "No se pudo guardar la hora", "error");
    return false;
  }
}

function limpiarCampos() {
  document.getElementById("start").value = "";
  document.getElementById("end").value = "";
  document.getElementById("sector").value = "";
}

async function borrarHora(id, button) {
  setButtonLoading(button, true, "Eliminando...");

  try {
    await apiFetch(`/delete-hour/${id}`, {
      method: "DELETE",
      body: { user_id: USER_ID },
      errorMessage: "No se pudo eliminar el registro"
    });

    showToast("Hora eliminada correctamente", "success");
    await refreshAfterHoursChange();
  } catch (error) {
    showToast(error.message || "No se pudo eliminar el registro", "error");
  } finally {
    setButtonLoading(button, false);
  }
}

function openEditModal(id) {
  const registro = currentMonthRegistros.find((item) => String(item.id) === String(id));
  const modal = document.getElementById("editHourModal");
  if (!registro || !modal) return;

  editingHourId = registro.id;
  document.getElementById("editHourDate").value = registro.date || "";
  document.getElementById("editHourStart").value = formatTimeLabel(registro.start_time);
  document.getElementById("editHourEnd").value = formatTimeLabel(registro.end_time);
  renderSectorSelect("editHourSector", registro.sector || "", { allowLegacy: true });

  openModalElement(modal);
}

function closeEditModal() {
  const modal = document.getElementById("editHourModal");
  const form = document.getElementById("editHourForm");
  if (!modal || !form) return;

  editingHourId = null;
  form.reset();
  renderSectorSelect("editHourSector");
  closeModalElement(modal);
}

function initEditModal() {
  document.getElementById("closeEditHourBtn")?.addEventListener("click", closeEditModal);
  document.getElementById("cancelEditHourBtn")?.addEventListener("click", closeEditModal);
  document.getElementById("editHourModal")?.addEventListener("click", (event) => {
    if (event.target.dataset.closeEditModal === "true") {
      closeEditModal();
    }
  });
  document.getElementById("editHourForm")?.addEventListener("submit", handleEditHourSubmit);
}

function openDetailModal() {
  openModalElement(document.getElementById("detailHoursModal"));
}

function closeDetailModal() {
  closeModalElement(document.getElementById("detailHoursModal"));
}

function initDetailModal() {
  document.getElementById("openDetailModalBtn")?.addEventListener("click", openDetailModal);
  document.getElementById("closeDetailHoursBtn")?.addEventListener("click", closeDetailModal);
  document.getElementById("detailHoursModal")?.addEventListener("click", (event) => {
    if (event.target.dataset.closeDetailModal === "true") {
      closeDetailModal();
    }
  });
}

async function handleEditHourSubmit(event) {
  event.preventDefault();

  if (!editingHourId || !USER_ID) return;

  const saveButton = document.getElementById("saveEditHourBtn");
  setButtonLoading(saveButton, true, "Actualizando...");

  try {
    await apiFetch(`/update-hour/${editingHourId}`, {
      method: "PUT",
      body: {
        user_id: USER_ID,
        date: document.getElementById("editHourDate").value,
        start_time: document.getElementById("editHourStart").value,
        end_time: document.getElementById("editHourEnd").value,
        sector: document.getElementById("editHourSector").value
      },
      errorMessage: "No se pudo actualizar la hora"
    });

    closeEditModal();
    showToast("Hora actualizada correctamente", "success");
    await refreshAfterHoursChange();
  } catch (error) {
    showToast(error.message || "No se pudo actualizar la hora", "error");
  } finally {
    setButtonLoading(saveButton, false);
  }
}

document.getElementById("resultado").addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-edit-id]");
  if (editButton) {
    openEditModal(editButton.dataset.editId);
    return;
  }

  const deleteButton = event.target.closest("[data-delete-id]");
  if (deleteButton) {
    borrarHora(deleteButton.dataset.deleteId, deleteButton);
  }
});

function initSideFeatures() {
  const menuButtons = document.querySelectorAll(".side-menu-btn");
  const panels = document.querySelectorAll(".side-view");
  const sideMenu = document.querySelector(".side-menu");
  const mobileMenuToggle = document.getElementById("mobileMenuToggle");

  function closeMobileMenu() {
    if (!sideMenu || !mobileMenuToggle) return;
    sideMenu.classList.remove("mobile-open");
    mobileMenuToggle.setAttribute("aria-expanded", "false");
    mobileMenuToggle.setAttribute("aria-label", "Abrir menú");
  }

  function toggleMobileMenu() {
    if (!sideMenu || !mobileMenuToggle) return;
    const isOpen = sideMenu.classList.toggle("mobile-open");
    mobileMenuToggle.setAttribute("aria-expanded", String(isOpen));
    mobileMenuToggle.setAttribute("aria-label", isOpen ? "Cerrar menú" : "Abrir menú");
  }

  mobileMenuToggle?.addEventListener("click", toggleMobileMenu);

  menuButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.panel;

      menuButtons.forEach((b) => b.classList.remove("active"));
      panels.forEach((p) => p.classList.remove("active"));

      btn.classList.add("active");
      document.getElementById(`panel-${target}`)?.classList.add("active");

      if (target === "calendario") {
        refreshCalendarFromControls();
      }

      if (window.innerWidth <= 760) {
        closeMobileMenu();
      }
    });
  });

  document.addEventListener("click", (event) => {
    if (window.innerWidth > 760 || !sideMenu || !mobileMenuToggle) return;
    const clickedInsideMenu = sideMenu.contains(event.target);
    const clickedToggle = mobileMenuToggle.contains(event.target);
    if (!clickedInsideMenu && !clickedToggle) closeMobileMenu();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 760) closeMobileMenu();
  });

  document.getElementById("saveProfileBtn")?.addEventListener("click", saveProfile);
  document.getElementById("addSectorBtn")?.addEventListener("click", addSector);
  document.getElementById("receiptInput")?.addEventListener("change", handleReceiptUpload);
  document.getElementById("sectorList")?.addEventListener("click", handleSectorListClick);
  document.getElementById("receiptList")?.addEventListener("click", handleReceiptListClick);
  document.getElementById("closeReceiptPreviewBtn")?.addEventListener("click", closeReceiptPreview);
  document.getElementById("receiptPreviewModal")?.addEventListener("click", handleReceiptPreviewBackdrop);
  document.getElementById("newSectorName")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addSector();
    }
  });
}

function initCalendarControls() {
  const monthSelect = document.getElementById("calendarMonthSelect");
  const yearInput = document.getElementById("calendarYearInput");

  if (!monthSelect || !yearInput) return;

  const today = new Date();
  monthSelect.value = String(today.getMonth() + 1);
  yearInput.value = String(today.getFullYear());

  document.getElementById("calendarApplyBtn")?.addEventListener("click", refreshCalendarFromControls);
  monthSelect.addEventListener("change", refreshCalendarFromControls);
  yearInput.addEventListener("change", refreshCalendarFromControls);

  document.getElementById("workCalendar")?.addEventListener("click", handleCalendarDayClick);
  document.getElementById("calendarQuickSaveBtn")?.addEventListener("click", saveCalendarHours);
  document.getElementById("calendarQuickCancelBtn")?.addEventListener("click", closeCalendarHourForm);
}

function getLegacyProfileKey() {
  return `${PROFILE_STORAGE_PREFIX}${USER_ID || "anon"}`;
}

function fillProfileForm(profile) {
  document.getElementById("profileAddress").value = profile?.address || "";
  document.getElementById("profilePhone").value = profile?.phone || "";
  document.getElementById("profileBirthDate").value = profile?.birth_date || "";
  document.getElementById("profileHourlyRate").value =
    profile?.hourly_rate !== null && profile?.hourly_rate !== undefined ? profile.hourly_rate : "";
  document.getElementById("profileHourlyRateNight").value =
    profile?.hourly_rate_night !== null && profile?.hourly_rate_night !== undefined ? profile.hourly_rate_night : "";
  document.getElementById("profileBillingCutoffDay").value = normalizeBillingCutoffDay(profile?.billing_cutoff_day);
}

async function addSector() {
  if (!USER_ID) {
    showToast("Usuario no identificado", "error");
    return;
  }

  const input = document.getElementById("newSectorName");
  const button = document.getElementById("addSectorBtn");
  const sectorName = normalizeSectorName(input?.value || "");

  if (!sectorName) {
    showToast("Ingresá un nombre de sector", "error");
    return;
  }

  if (currentUserSectors.some((sector) => sector.name.toLowerCase() === sectorName.toLowerCase())) {
    showToast("Ese sector ya existe", "error");
    return;
  }

  setButtonLoading(button, true, "Agregando...");

  try {
    const { error } = await client.from("user_sectors").insert({
      user_id: USER_ID,
      name: sectorName
    });

    if (error) throw error;

    if (input) input.value = "";
    await loadUserSectors();
    showToast("Sector agregado", "success");
  } catch (error) {
    console.error("No se pudo agregar sector:", error);
    showToast("No se pudo agregar el sector", "error");
  } finally {
    setButtonLoading(button, false);
  }
}

async function deleteSector(sectorId, button) {
  if (!USER_ID || !sectorId) return;

  setButtonLoading(button, true, "Eliminando...");

  try {
    const { error } = await client
      .from("user_sectors")
      .delete()
      .eq("id", sectorId)
      .eq("user_id", USER_ID);

    if (error) throw error;

    await loadUserSectors();
    showToast("Sector eliminado", "success");
  } catch (error) {
    console.error("No se pudo eliminar sector:", error);
    showToast("No se pudo eliminar el sector", "error");
  } finally {
    setButtonLoading(button, false);
  }
}

function handleSectorListClick(event) {
  const deleteButton = event.target.closest("[data-sector-id]");
  if (!deleteButton) return;
  deleteSector(deleteButton.dataset.sectorId, deleteButton);
}

async function saveProfile() {
  if (!USER_ID) {
    showToast("Usuario no identificado", "error");
    return;
  }

  const saveButton = document.getElementById("saveProfileBtn");
  setButtonLoading(saveButton, true, "Guardando...");

  try {
    const hourlyRateRaw = document.getElementById("profileHourlyRate")?.value || "";
    const hourlyRateNightRaw = document.getElementById("profileHourlyRateNight")?.value || "";
    const billingCutoffDayRaw = document.getElementById("profileBillingCutoffDay")?.value || "";
    const hourlyRate = Number(hourlyRateRaw);
    const hourlyRateNight = Number(hourlyRateNightRaw);
    const billingCutoffDay = Number(billingCutoffDayRaw);

    if (!hourlyRateRaw || !Number.isFinite(hourlyRate) || hourlyRate <= 0) {
      showToast("Ingresá un valor por hora normal válido", "error");
      return;
    }

    if (!hourlyRateNightRaw || !Number.isFinite(hourlyRateNight) || hourlyRateNight <= 0) {
      showToast("Ingresá un valor por hora nocturno válido", "error");
      return;
    }

    if (!billingCutoffDayRaw || !Number.isInteger(billingCutoffDay) || billingCutoffDay < 1 || billingCutoffDay > 31) {
      showToast("Ingresá un día de cierre mensual válido entre 1 y 31", "error");
      return;
    }

    const profile = {
      user_id: USER_ID,
      address: document.getElementById("profileAddress")?.value.trim() || null,
      phone: document.getElementById("profilePhone")?.value.trim() || null,
      birth_date: document.getElementById("profileBirthDate")?.value || null,
      hourly_rate: hourlyRate,
      hourly_rate_night: hourlyRateNight,
      billing_cutoff_day: billingCutoffDay
    };

    const { data, error } = await client
      .from("profiles")
      .upsert(profile, { onConflict: "user_id" })
      .select()
      .single();

    if (error) throw error;

    currentProfile = data;
    fillProfileForm(currentProfile);
    updateHourlyRateUI(
      currentProfile.hourly_rate,
      currentProfile.hourly_rate_night,
      currentProfile.billing_cutoff_day
    );
    updateDashboardPeriodNote();
    if (selectedMonth) {
      await cargarDashboard();
    }
    showToast("Perfil guardado correctamente", "success");
  } catch (error) {
    console.error("No se pudo guardar perfil:", error);
    showToast("No se pudo guardar el perfil", "error");
  } finally {
    setButtonLoading(saveButton, false);
  }
}

async function loadProfile() {
  if (!USER_ID) return;

  const { data, error } = await client
    .from("profiles")
    .select("*")
    .eq("user_id", USER_ID)
    .maybeSingle();

  if (error) {
    console.error("No se pudo cargar perfil:", error);
    showToast("No se pudo cargar el perfil", "error");
    currentProfile = null;
    fillProfileForm(null);
    updateHourlyRateUI(null, null, DEFAULT_BILLING_CUTOFF_DAY);
    updateDashboardPeriodNote();
    return;
  }

  currentProfile = data || null;

  if (!currentProfile) {
    try {
      const legacyProfile = JSON.parse(localStorage.getItem(getLegacyProfileKey()) || "null");
      if (legacyProfile) {
        currentProfile = {
          address: legacyProfile.address || "",
          phone: legacyProfile.phone || "",
          birth_date: legacyProfile.birthDate || "",
          hourly_rate: null,
          hourly_rate_night: null,
          billing_cutoff_day: DEFAULT_BILLING_CUTOFF_DAY
        };
      }
    } catch (legacyError) {
      console.error("No se pudo leer el perfil legacy:", legacyError);
    }
  }

  fillProfileForm(currentProfile);
  updateHourlyRateUI(
    currentProfile?.hourly_rate ?? null,
    currentProfile?.hourly_rate_night ?? null,
    currentProfile?.billing_cutoff_day ?? DEFAULT_BILLING_CUTOFF_DAY
  );
  updateDashboardPeriodNote();
}

function renderCalendar() {
  const container = document.getElementById("workCalendar");
  if (!container || !calendarView) return;

  const year = calendarView.year;
  const monthIndex = calendarView.month - 1;
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const weekdays = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

  let html = "";

  weekdays.forEach((dayName) => {
    html += `<div class="cal-weekday">${dayName}</div>`;
  });

  for (let i = 0; i < firstDay; i += 1) {
    html += '<div class="cal-day empty"></div>';
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const isoDate = `${year}-${String(calendarView.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const workedClass = calendarWorkedDays.has(day) ? "worked" : "";
    const selectedClass = calendarSelectedDate === isoDate ? "selected" : "";
    html += `<button type="button" class="cal-day ${workedClass} ${selectedClass}" data-date="${isoDate}" title="${formatDateLatam(isoDate)}">${day}</button>`;
  }

  container.innerHTML = html;
}

function handleCalendarDayClick(event) {
  const dayButton = event.target.closest(".cal-day[data-date]");
  if (!dayButton) return;
  openCalendarHourForm(dayButton.dataset.date);
}

function openCalendarHourForm(isoDate) {
  calendarSelectedDate = isoDate;
  renderCalendar();

  const quickForm = document.getElementById("calendarQuickForm");
  const dateIsoInput = document.getElementById("calendarQuickDateIso");
  const dateLabel = document.getElementById("calendarQuickDateLabel");
  if (!quickForm || !dateIsoInput || !dateLabel) return;

  dateIsoInput.value = isoDate;
  dateLabel.textContent = formatDateLatam(isoDate);
  document.getElementById("calendarQuickStart").value = "";
  document.getElementById("calendarQuickEnd").value = "";
  document.getElementById("calendarQuickSector").value = "";
  quickForm.classList.remove("hidden");
}

function closeCalendarHourForm() {
  const quickForm = document.getElementById("calendarQuickForm");
  if (!quickForm) return;

  quickForm.classList.add("hidden");
  calendarSelectedDate = "";
  document.getElementById("calendarQuickDateIso").value = "";
  document.getElementById("calendarQuickStart").value = "";
  document.getElementById("calendarQuickEnd").value = "";
  document.getElementById("calendarQuickSector").value = "";
  renderCalendar();
}

async function saveCalendarHours() {
  const saveButton = document.getElementById("calendarQuickSaveBtn");
  setButtonLoading(saveButton, true, "Guardando...");

  try {
    const date = document.getElementById("calendarQuickDateIso")?.value || "";
    const startTime = document.getElementById("calendarQuickStart")?.value || "";
    const endTime = document.getElementById("calendarQuickEnd")?.value || "";
    const sector = document.getElementById("calendarQuickSector")?.value || "";

    const saved = await saveHoursEntry({ date, startTime, endTime, sector });
    if (saved) closeCalendarHourForm();
  } finally {
    setButtonLoading(saveButton, false);
  }
}

async function refreshCalendarFromControls() {
  if (!USER_ID) return;

  const monthSelect = document.getElementById("calendarMonthSelect");
  const yearInput = document.getElementById("calendarYearInput");
  const month = Number(monthSelect?.value);
  const year = Number(yearInput?.value);

  if (!month || !year) return;

  calendarView = { month, year };

  try {
    const data = await apiFetch("/hours-by-calendar-month", {
      query: { user_id: USER_ID, year, month },
      errorMessage: "No se pudo cargar el calendario"
    });
    calendarWorkedDays = new Set((data?.registros || []).map((row) => Number(row.date.slice(8, 10))));
  } catch (error) {
    console.error("Error cargando calendario:", error);
    calendarWorkedDays = new Set();
    showToast(error.message || "No se pudo cargar el calendario", "error");
  }

  renderCalendar();
}

function getReceiptKey() {
  return `${RECEIPT_STORAGE_PREFIX}${USER_ID || "anon"}`;
}

function getStoredReceipts() {
  try {
    return JSON.parse(localStorage.getItem(getReceiptKey()) || "[]");
  } catch (error) {
    console.error("No se pudieron leer recibos:", error);
    return [];
  }
}

function saveStoredReceipts(receipts) {
  localStorage.setItem(getReceiptKey(), JSON.stringify(receipts));
}

function loadReceipts() {
  renderReceiptList(getStoredReceipts());
}

async function handleReceiptUpload(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  const storedReceipts = getStoredReceipts();

  for (const file of files) {
    const dataUrl = await fileToDataURL(file);
    storedReceipts.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      type: file.type,
      dataUrl
    });
  }

  try {
    saveStoredReceipts(storedReceipts);
    renderReceiptList(storedReceipts);
    showToast("Recibo cargado", "success");
  } catch (error) {
    showToast("No se pudo guardar el archivo. Probá con uno más liviano.", "error");
  }

  event.target.value = "";
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderReceiptList(receipts) {
  const list = document.getElementById("receiptList");
  if (!list) return;

  if (!receipts.length) {
    list.innerHTML = '<p class="empty-state">No hay recibos cargados.</p>';
    return;
  }

  list.innerHTML = receipts
    .map((item) => {
      const isImage = String(item.type || "").startsWith("image/");
      const preview = isImage
        ? `<img class="receipt-thumb" src="${item.dataUrl}" alt="${item.name}">`
        : '<div class="receipt-thumb receipt-thumb-pdf">PDF</div>';

      return `
        <div class="receipt-item">
          <div class="receipt-meta">
            ${preview}
            <span>${item.name}</span>
          </div>
          <div class="receipt-links">
            <button type="button" data-receipt-preview-id="${item.id}">Ver</button>
            <button type="button" data-receipt-id="${item.id}">Eliminar</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function handleReceiptListClick(event) {
  const previewId = event.target.dataset.receiptPreviewId;
  if (previewId) {
    openReceiptPreview(previewId);
    return;
  }

  const id = event.target.dataset.receiptId;
  if (!id) return;

  const filtered = getStoredReceipts().filter((item) => item.id !== id);
  saveStoredReceipts(filtered);
  renderReceiptList(filtered);
  showToast("Recibo eliminado", "success");
}

function openReceiptPreview(id) {
  const receipt = getStoredReceipts().find((item) => item.id === id);
  const modal = document.getElementById("receiptPreviewModal");
  const body = document.getElementById("receiptPreviewBody");
  const title = document.getElementById("receiptPreviewTitle");

  if (!receipt || !modal || !body || !title) return;

  title.textContent = receipt.name || "Vista previa";

  if (String(receipt.type || "").startsWith("image/")) {
    body.innerHTML = `<img class="receipt-preview-image" src="${receipt.dataUrl}" alt="${receipt.name}">`;
  } else {
    body.innerHTML = `
      <iframe class="receipt-preview-frame" src="${receipt.dataUrl}" title="${receipt.name}"></iframe>
      <a class="receipt-preview-open" href="${receipt.dataUrl}" target="_blank" rel="noopener noreferrer">Abrir en otra pestaña</a>
    `;
  }

  openModalElement(modal);
}

function closeReceiptPreview() {
  const modal = document.getElementById("receiptPreviewModal");
  const body = document.getElementById("receiptPreviewBody");
  if (!modal || !body) return;

  closeModalElement(modal);
  body.innerHTML = "";
}

function handleReceiptPreviewBackdrop(event) {
  if (event.target.dataset.closeReceiptPreview === "true") {
    closeReceiptPreview();
  }
}
