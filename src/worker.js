/**
 * Cloudflare Worker entry point (Native Workers API)
 *
 * No Express, no serverless-http — pure Workers routing with if/else.
 * Uses Resend HTTP API via fetch (no nodemailer).
 */
import { createClient } from "@supabase/supabase-js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API routes → Native Workers handlers
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, url, env);
    }

    // Static frontend (SPA fallback via not_found_handling)
    return env.ASSETS.fetch(request);
  }
};

// ============================================================================
// CORS & Utilities
// ============================================================================

function isLoopbackOrigin(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isPrivateIpHostname(hostname) {
  return (
    hostname.startsWith("100.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("10.") ||
    hostname.startsWith("172.16.") ||
    hostname.startsWith("172.17.") ||
    hostname.startsWith("172.18.") ||
    hostname.startsWith("172.19.") ||
    hostname.startsWith("172.2") ||
    hostname.startsWith("172.30.") ||
    hostname.startsWith("172.31.")
  );
}

function isTailnetDnsHostname(hostname) {
  return hostname.endsWith(".ts.net") || hostname.endsWith(".beta.tailscale.net");
}

function isNetlifyHostname(hostname) {
  return hostname.endsWith(".netlify.app") || hostname.endsWith(".netlify.live");
}

function isCloudflareHostname(hostname) {
  return hostname.endsWith(".pages.dev") || hostname.endsWith(".workers.dev");
}

function isSingleLabelHostname(hostname) {
  return /^[a-z0-9-]+$/i.test(hostname) && !hostname.includes(".");
}

function isPrivateOrTailnetHostname(hostname) {
  return (
    isPrivateIpHostname(hostname) ||
    isTailnetDnsHostname(hostname) ||
    isSingleLabelHostname(hostname)
  );
}

function isAllowedOrigin(origin, env) {
  if (!origin) return true;

  const allowedOrigins = new Set([
    "https://controlhorasapp.netlify.app",
    "http://localhost:8080",
    "http://localhost:3000",
    "http://127.0.0.1:8080",
    "http://127.0.0.1:3000",
    ...(env.CORS_ALLOWED_ORIGINS || "").split(",").map(o => o.trim()).filter(Boolean)
  ]);

  try {
    const parsedOrigin = new URL(origin);
    const hostname = parsedOrigin.hostname;
    return (
      allowedOrigins.has(origin) ||
      isNetlifyHostname(hostname) ||
      isCloudflareHostname(hostname) ||
      isLoopbackOrigin(hostname) ||
      isPrivateOrTailnetHostname(hostname)
    );
  } catch {
    return false;
  }
}

function corsHeaders(origin, env) {
  const allowed = isAllowedOrigin(origin, env);
  return {
    "Access-Control-Allow-Origin": allowed ? (origin || "*") : "null",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

function jsonResponse(data, status = 200, origin = null, env = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin, env)
    }
  });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

async function parseJsonBody(request) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return {};
  }
  try {
    return await request.json();
  } catch {
    return {};
  }
}

// ============================================================================
// Supabase Client
// ============================================================================

function getSupabase(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

// ============================================================================
// Email via Resend API
// ============================================================================

async function sendEmailViaResend({ from, to, subject, text, html }, env) {
  const apiKey = env.SMTP_PASS || env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("Falta SMTP_PASS o RESEND_API_KEY para Resend");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from, to: [to], subject, text, html })
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "(sin cuerpo)");
    throw new Error(`Error de Resend API ${response.status}: ${errorBody}`);
  }

  return response.json().catch(() => ({}));
}

// ============================================================================
// Business Logic (from backend/server.js)
// ============================================================================

function roundTo(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function normalizeNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isValidUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function parseTimeToMinutes(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ""));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function isNightMinute(minuteOfDay) {
  return minuteOfDay >= 22 * 60 || minuteOfDay < 6 * 60;
}

function splitShiftHours(startTime, endTime) {
  const startMinutes = parseTimeToMinutes(startTime);
  const endMinutes = parseTimeToMinutes(endTime);

  if (startMinutes === null || endMinutes === null) {
    return null;
  }

  let durationMinutes = endMinutes - startMinutes;
  if (durationMinutes <= 0) {
    durationMinutes += 24 * 60;
  }

  if (durationMinutes <= 0 || durationMinutes > 24 * 60) {
    return null;
  }

  let nightMinutes = 0;
  for (let offset = 0; offset < durationMinutes; offset += 1) {
    const minuteOfDay = (startMinutes + offset) % (24 * 60);
    if (isNightMinute(minuteOfDay)) {
      nightMinutes += 1;
    }
  }

  const normalMinutes = durationMinutes - nightMinutes;

  return {
    worked_hours_total: roundTo(durationMinutes / 60, 4),
    worked_hours_normal: roundTo(normalMinutes / 60, 4),
    worked_hours_night: roundTo(nightMinutes / 60, 4)
  };
}

function getLastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function normalizeBillingCutoffDay(value, fallback = 20) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 31) {
    return fallback;
  }
  return parsed;
}

function getEffectiveCutoffForMonth(year, month, billingCutoffDay) {
  return Math.min(normalizeBillingCutoffDay(billingCutoffDay), getLastDayOfMonth(year, month));
}

function getPayPeriodKeyForDate(dateValue, billingCutoffDay = 20) {
  const fecha = new Date(`${dateValue}T00:00:00`);

  let year = fecha.getFullYear();
  let month = fecha.getMonth() + 1;
  const effectiveCutoff = getEffectiveCutoffForMonth(year, month, billingCutoffDay);

  if (fecha.getDate() > effectiveCutoff) {
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }

  return `${year}-${String(month).padStart(2, "0")}`;
}

function getPayPeriodRange(year, month, billingCutoffDay = 20) {
  const normalizedYear = Number(year);
  const normalizedMonth = Number(month);
  const normalizedCutoff = normalizeBillingCutoffDay(billingCutoffDay);

  const prevMonth = normalizedMonth === 1 ? 12 : normalizedMonth - 1;
  const prevYear = normalizedMonth === 1 ? normalizedYear - 1 : normalizedYear;
  const prevMonthLastDay = getLastDayOfMonth(prevYear, prevMonth);
  const currentMonthLastDay = getLastDayOfMonth(normalizedYear, normalizedMonth);

  const startDay = normalizedCutoff >= prevMonthLastDay ? 1 : normalizedCutoff + 1;
  const endDay = Math.min(normalizedCutoff, currentMonthLastDay);

  const startYear = startDay === 1 ? normalizedYear : prevYear;
  const startMonth = startDay === 1 ? normalizedMonth : prevMonth;

  return {
    start: `${startYear}-${String(startMonth).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`,
    end: `${normalizedYear}-${String(normalizedMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`,
    cutoff_day: normalizedCutoff
  };
}

function sanitizeSector(value) {
  const sector = String(value || "").trim();
  if (!sector || sector.length > 120) return null;
  return sector;
}

function sanitizeOptionalText(value, maxLength = 160) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function sanitizeOptionalPhone(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^\d+\s()-]/g, "");
  if (!normalized) return null;
  return normalized.slice(0, 40);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getApprovalStatusValue(value) {
  if (value === "pending" || value === "approved" || value === "rejected") {
    return value;
  }
  return "approved";
}

function isUserApproved(status) {
  return getApprovalStatusValue(status) === "approved";
}

function getApprovalBlockedMessage(status) {
  const normalizedStatus = getApprovalStatusValue(status);
  if (normalizedStatus === "rejected") {
    return "Tu cuenta fue rechazada. Contactá al administrador.";
  }
  return "Tu cuenta está pendiente de aprobación por el administrador.";
}

async function getAuthUserById(userId, supabase) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) {
    if (error.status === 404 || error.code === "user_not_found") {
      return null;
    }
    throw error;
  }
  return data?.user || null;
}

async function syncUserApprovalMetadata(user, approvalStatus, supabase) {
  const mergedAppMetadata = {
    ...(user?.app_metadata || {}),
    admin_approval_status: getApprovalStatusValue(approvalStatus)
  };

  const { error } = await supabase.auth.admin.updateUserById(user.id, {
    app_metadata: mergedAppMetadata
  });

  if (error) {
    throw error;
  }
}

async function getProfileApprovalRecord(userId, supabase) {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, approval_status, approval_token, approval_requested_at, approved_at, approved_by_email")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (error.code === "42703") {
      return null;
    }
    throw error;
  }

  return data || null;
}

async function getEffectiveApprovalState(userId, supabase) {
  const authUser = await getAuthUserById(userId, supabase);
  const profileApproval = await getProfileApprovalRecord(userId, supabase);

  const metadataStatus = getApprovalStatusValue(authUser?.app_metadata?.admin_approval_status);
  const profileStatus = getApprovalStatusValue(profileApproval?.approval_status);
  const resolvedStatus =
    authUser?.app_metadata?.admin_approval_status !== undefined ? metadataStatus : profileApproval ? profileStatus : "approved";

  return {
    authUser,
    profileApproval,
    status: resolvedStatus,
    approved: isUserApproved(resolvedStatus)
  };
}

async function assertUserApproved(userId, supabase) {
  const approvalState = await getEffectiveApprovalState(userId, supabase);

  if (!approvalState.approved) {
    return {
      ok: false,
      status: 403,
      error: getApprovalBlockedMessage(approvalState.status)
    };
  }

  return {
    ok: true,
    approvalState
  };
}

async function getProfileForUser(userId, supabase) {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, hourly_rate, hourly_rate_night, billing_cutoff_day")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const hourlyRate = normalizeNumber(data.hourly_rate, NaN);
  const hourlyRateNight = normalizeNumber(data.hourly_rate_night, NaN);
  const billingCutoffDay = normalizeBillingCutoffDay(data.billing_cutoff_day);

  if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
    return {
      ...data,
      hourly_rate: null,
      hourly_rate_night: hourlyRateNight,
      billing_cutoff_day: billingCutoffDay
    };
  }

  if (!Number.isFinite(hourlyRateNight) || hourlyRateNight <= 0) {
    return {
      ...data,
      hourly_rate: hourlyRate,
      hourly_rate_night: null,
      billing_cutoff_day: billingCutoffDay
    };
  }

  return {
    ...data,
    hourly_rate: hourlyRate,
    hourly_rate_night: hourlyRateNight,
    billing_cutoff_day: billingCutoffDay
  };
}

async function userHasSector(userId, sectorName, supabase) {
  const { data, error } = await supabase
    .from("user_sectors")
    .select("id")
    .eq("user_id", userId)
    .eq("name", sectorName)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return Boolean(data);
}

async function getHourRecordForUser(hourId, userId, supabase) {
  const { data, error } = await supabase
    .from("hours")
    .select("id, sector")
    .eq("id", hourId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data || null;
}

function computeEntryFinancials({ startTime, endTime, hourlyRate, hourlyRateNight }) {
  const split = splitShiftHours(startTime, endTime);
  if (!split) {
    return null;
  }

  const money = roundTo(
    split.worked_hours_normal * hourlyRate + split.worked_hours_night * hourlyRateNight,
    2
  );

  return {
    ...split,
    hourly_rate_snapshot: roundTo(hourlyRate, 2),
    hourly_rate_night_snapshot: roundTo(hourlyRateNight, 2),
    money
  };
}

function hydrateHoursRow(row) {
  const workedHoursTotal = normalizeOptionalNumber(row.worked_hours_total);
  const workedHoursNormal = normalizeOptionalNumber(row.worked_hours_normal);
  const workedHoursNight = normalizeOptionalNumber(row.worked_hours_night);
  const money = normalizeNumber(row.money, 0);
  const hourlyRateSnapshot = normalizeOptionalNumber(row.hourly_rate_snapshot);
  const hourlyRateNightSnapshot = normalizeOptionalNumber(row.hourly_rate_night_snapshot);

  if (
    workedHoursTotal !== null &&
    workedHoursNormal !== null &&
    workedHoursNight !== null
  ) {
    return {
      ...row,
      worked_hours_total: workedHoursTotal,
      worked_hours_normal: workedHoursNormal,
      worked_hours_night: workedHoursNight,
      hourly_rate_snapshot: hourlyRateSnapshot,
      hourly_rate_night_snapshot: hourlyRateNightSnapshot,
      money
    };
  }

  const split = splitShiftHours(String(row.start_time || "").slice(0, 5), String(row.end_time || "").slice(0, 5));
  const fallbackTotal = split?.worked_hours_total || 0;
  const fallbackNormal = split?.worked_hours_normal || fallbackTotal;
  const fallbackNight = split?.worked_hours_night || 0;
  const fallbackRate = fallbackTotal > 0 ? roundTo(money / fallbackTotal, 2) : null;

  return {
    ...row,
    worked_hours_total: fallbackTotal,
    worked_hours_normal: fallbackNormal,
    worked_hours_night: fallbackNight,
    hourly_rate_snapshot: fallbackRate,
    hourly_rate_night_snapshot: fallbackRate,
    money
  };
}

async function sendAdminApprovalEmail({ email, userId, approvalToken, requestedAt, phone, institution, message }, env) {
  const approvalBaseUrl = env.APPROVAL_BASE_URL;
  const adminApprovalEmail = env.ADMIN_APPROVAL_EMAIL || "digitalnexoweb@gmail.com";
  const mailFrom = env.MAIL_FROM;

  if (!approvalBaseUrl) {
    throw new Error("Falta APPROVAL_BASE_URL en el entorno");
  }

  if (!mailFrom) {
    throw new Error("Falta MAIL_FROM en el entorno");
  }

  const approvalUrl = `${approvalBaseUrl}/api/auth/approve-user?token=${encodeURIComponent(approvalToken)}`;
  const safeEmail = escapeHtml(email);
  const safeUserId = escapeHtml(userId);
  const safeRequestedAt = escapeHtml(requestedAt);
  const safePhone = escapeHtml(phone || "No informado");
  const safeInstitution = escapeHtml(institution || "No informada");
  const safeMessage = escapeHtml(message || "Sin mensaje");

  await sendEmailViaResend({
    from: mailFrom,
    to: adminApprovalEmail,
    subject: `Nuevo usuario pendiente de aprobacion: ${email}`,
    text: [
      "Se registro un nuevo usuario en Control de Horas.",
      `Email: ${email}`,
      `User ID: ${userId}`,
      `Fecha: ${requestedAt}`,
      `Telefono: ${phone || "No informado"}`,
      `Institucion: ${institution || "No informada"}`,
      `Mensaje: ${message || "Sin mensaje"}`,
      `Aprobar: ${approvalUrl}`
    ].join("\n"),
    html: `
      <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
        <h2 style="margin-bottom: 12px;">Nuevo usuario pendiente de aprobacion</h2>
        <p>Se registro un nuevo usuario en Control de Horas.</p>
        <p><strong>Email:</strong> ${safeEmail}</p>
        <p><strong>User ID:</strong> ${safeUserId}</p>
        <p><strong>Fecha:</strong> ${safeRequestedAt}</p>
        <p><strong>Telefono:</strong> ${safePhone}</p>
        <p><strong>Institucion:</strong> ${safeInstitution}</p>
        <p><strong>Mensaje:</strong><br>${safeMessage.replace(/\n/g, "<br>")}</p>
        <p style="margin-top: 24px;">
          <a href="${approvalUrl}" style="display: inline-block; background: #0f766e; color: #ffffff; text-decoration: none; padding: 12px 18px; border-radius: 8px;">
            Aprobar usuario
          </a>
        </p>
      </div>
    `
  }, env);
}

// ============================================================================
// API Router
// ============================================================================

async function handleApi(request, url, env) {
  const origin = request.headers.get("origin");
  const supabase = getSupabase(env);

  // OPTIONS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(origin, env)
    });
  }

  const pathname = url.pathname;

  // GET /api/health
  if (pathname === "/api/health" && request.method === "GET") {
    console.log(`[${new Date().toISOString()}] GET /api/health origin=${origin || "n/a"}`);
    return jsonResponse({ ok: true }, 200, origin, env);
  }

  // GET /api/ (root)
  if (pathname === "/api/" && request.method === "GET") {
    console.log(`[${new Date().toISOString()}] GET /api/ origin=${origin || "n/a"}`);
    return jsonResponse({ message: "Backend Supabase OK" }, 200, origin, env);
  }

  // POST /api/auth/register-request
  if (pathname === "/api/auth/register-request" && request.method === "POST") {
    console.log(`[${new Date().toISOString()}] POST /api/auth/register-request origin=${origin || "n/a"}`);
    return handleRegisterRequest(request, supabase, env, origin);
  }

  // GET /api/auth/approval-status
  if (pathname === "/api/auth/approval-status" && request.method === "GET") {
    console.log(`[${new Date().toISOString()}] GET /api/auth/approval-status origin=${origin || "n/a"}`);
    return handleApprovalStatus(url, supabase, env, origin);
  }

  // GET /api/auth/approve-user
  if (pathname === "/api/auth/approve-user" && request.method === "GET") {
    console.log(`[${new Date().toISOString()}] GET /api/auth/approve-user origin=${origin || "n/a"}`);
    return handleApproveUser(url, supabase, env);
  }

  // POST /api/add-hours
  if (pathname === "/api/add-hours" && request.method === "POST") {
    console.log(`[${new Date().toISOString()}] POST /api/add-hours origin=${origin || "n/a"}`);
    return handleAddHours(request, supabase, env, origin);
  }

  // GET /api/resumen
  if (pathname === "/api/resumen" && request.method === "GET") {
    console.log(`[${new Date().toISOString()}] GET /api/resumen origin=${origin || "n/a"}`);
    return handleResumen(url, supabase, env, origin);
  }

  // GET /api/hours-by-month
  if (pathname === "/api/hours-by-month" && request.method === "GET") {
    console.log(`[${new Date().toISOString()}] GET /api/hours-by-month origin=${origin || "n/a"}`);
    return handleHoursByMonth(url, supabase, env, origin);
  }

  // GET /api/hours-by-calendar-month
  if (pathname === "/api/hours-by-calendar-month" && request.method === "GET") {
    console.log(`[${new Date().toISOString()}] GET /api/hours-by-calendar-month origin=${origin || "n/a"}`);
    return handleHoursByCalendarMonth(url, supabase, env, origin);
  }

  // DELETE /api/delete-hour/:id
  if (pathname.startsWith("/api/delete-hour/") && request.method === "DELETE") {
    console.log(`[${new Date().toISOString()}] DELETE ${pathname} origin=${origin || "n/a"}`);
    return handleDeleteHour(request, pathname, supabase, env, origin);
  }

  // PUT /api/update-hour/:id
  if (pathname.startsWith("/api/update-hour/") && request.method === "PUT") {
    console.log(`[${new Date().toISOString()}] PUT ${pathname} origin=${origin || "n/a"}`);
    return handleUpdateHour(request, pathname, supabase, env, origin);
  }

  return jsonResponse({ error: "Ruta no encontrada" }, 404, origin, env);
}

// ============================================================================
// Route Handlers
// ============================================================================

async function handleRegisterRequest(request, supabase, env, origin) {
  const body = await parseJsonBody(request);
  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const phone = sanitizeOptionalPhone(body?.phone);
  const institution = sanitizeOptionalText(body?.institution, 160);
  const message = sanitizeOptionalText(body?.message, 1000);

  if (!email || !email.includes("@")) {
    return jsonResponse({ error: "Email inválido" }, 400, origin, env);
  }

  if (password.length < 6) {
    return jsonResponse({ error: "La contraseña debe tener al menos 6 caracteres" }, 400, origin, env);
  }

  const requestedAt = new Date().toISOString();
  const approvalToken = crypto.randomUUID();

  let createdUser = null;

  try {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: {
        admin_approval_status: "pending"
      },
      user_metadata: {
        access_requested_at: requestedAt,
        phone,
        institution,
        access_message: message
      }
    });

    if (error) {
      const isDuplicate = /already|registered|exists|taken/i.test(String(error.message || ""));
      return jsonResponse(
        { error: isDuplicate ? "Ya existe una cuenta o solicitud para este email" : error.message || "No se pudo crear la solicitud" },
        isDuplicate ? 409 : 400,
        origin,
        env
      );
    }

    createdUser = data?.user || null;
    if (!createdUser?.id) {
      throw new Error("Supabase no devolvió el usuario creado");
    }

    const { error: profileError } = await supabase.from("profiles").upsert(
      {
        user_id: createdUser.id,
        approval_status: "pending",
        approval_requested_at: requestedAt,
        approved_at: null,
        approved_by_email: null,
        approval_token: approvalToken
      },
      { onConflict: "user_id" }
    );

    if (profileError) {
      throw profileError;
    }

    await sendAdminApprovalEmail({
      email,
      userId: createdUser.id,
      approvalToken,
      requestedAt,
      phone,
      institution,
      message
    }, env);
  } catch (error) {
    if (createdUser?.id) {
      try {
        await supabase.auth.admin.deleteUser(createdUser.id);
      } catch (rollbackError) {
        console.error("No se pudo revertir el usuario creado", rollbackError);
      }
    }

    const errorMessage = String(error?.message || "");
    if (
      errorMessage.includes("APPROVAL_BASE_URL") ||
      errorMessage.includes("SMTP_PASS") ||
      errorMessage.includes("MAIL_FROM")
    ) {
      console.error("Configuracion incompleta para solicitudes de acceso", error);
      return jsonResponse(
        { error: "El servidor no tiene configurado el envio de solicitudes de acceso" },
        500,
        origin,
        env
      );
    }

    console.error("Error procesando solicitud de aprobacion", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  return jsonResponse({
    ok: true,
    status: "pending",
    message: "Solicitud enviada. Un administrador debe aprobar tu acceso."
  }, 200, origin, env);
}

async function handleApprovalStatus(url, supabase, env, origin) {
  const userId = url.searchParams.get("user_id");

  if (!isValidUuid(userId)) {
    return jsonResponse({ error: "user_id inválido" }, 400, origin, env);
  }

  try {
    const approvalState = await getEffectiveApprovalState(userId, supabase);
    return jsonResponse({
      ok: true,
      status: approvalState.status,
      approved: approvalState.approved,
      message: approvalState.approved ? "Cuenta aprobada" : getApprovalBlockedMessage(approvalState.status)
    }, 200, origin, env);
  } catch (error) {
    console.error("Error consultando estado de aprobacion", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }
}

async function handleApproveUser(url, supabase, env) {
  const approvalToken = String(url.searchParams.get("token") || "").trim();

  if (!isValidUuid(approvalToken)) {
    return htmlResponse("Token de aprobacion invalido", 400);
  }

  let profileApproval;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("user_id, approval_status, approval_token")
      .eq("approval_token", approvalToken)
      .maybeSingle();

    if (error) {
      throw error;
    }

    profileApproval = data;
  } catch (error) {
    console.error("Error buscando token de aprobacion", error);
    return htmlResponse("No se pudo procesar la aprobacion", 500);
  }

  if (!profileApproval?.user_id) {
    return htmlResponse("La solicitud ya fue aprobada o el token no existe", 404);
  }

  try {
    const authUser = await getAuthUserById(profileApproval.user_id, supabase);

    if (!authUser) {
      return htmlResponse("Usuario no encontrado", 404);
    }

    await syncUserApprovalMetadata(authUser, "approved", supabase);

    const adminApprovalEmail = env.ADMIN_APPROVAL_EMAIL || "digitalnexoweb@gmail.com";

    const { error } = await supabase
      .from("profiles")
      .update({
        approval_status: "approved",
        approved_at: new Date().toISOString(),
        approved_by_email: adminApprovalEmail,
        approval_token: null
      })
      .eq("user_id", profileApproval.user_id);

    if (error) {
      throw error;
    }

    return htmlResponse(`
      <html lang="es">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Usuario aprobado</title>
        </head>
        <body style="font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; padding: 32px;">
          <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 16px; padding: 24px; box-shadow: 0 12px 32px rgba(15, 23, 42, 0.12);">
            <h1 style="margin-top: 0;">Usuario aprobado</h1>
            <p>La cuenta <strong>${escapeHtml(authUser.email)}</strong> ya quedó habilitada.</p>
            <p>La persona puede ingresar con el email y la contraseña que definió al pedir acceso.</p>
          </div>
        </body>
      </html>
    `, 200);
  } catch (error) {
    console.error("Error aprobando usuario", error);
    return htmlResponse("No se pudo aprobar el usuario", 500);
  }
}

async function handleAddHours(request, supabase, env, origin) {
  const body = await parseJsonBody(request);
  const { user_id, date, start_time, end_time, sector } = body;

  if (!isValidUuid(user_id)) {
    return jsonResponse({ error: "user_id inválido" }, 400, origin, env);
  }

  if (!isValidDate(date)) {
    return jsonResponse({ error: "Fecha inválida" }, 400, origin, env);
  }

  if (parseTimeToMinutes(start_time) === null || parseTimeToMinutes(end_time) === null) {
    return jsonResponse({ error: "Formato de hora inválido" }, 400, origin, env);
  }

  const sanitizedSector = sanitizeSector(sector);
  if (!sanitizedSector) {
    return jsonResponse({ error: "Sector inválido" }, 400, origin, env);
  }

  try {
    const approvalCheck = await assertUserApproved(user_id, supabase);
    if (!approvalCheck.ok) {
      return jsonResponse({ error: approvalCheck.error }, approvalCheck.status, origin, env);
    }
  } catch (error) {
    console.error("Error validando aprobacion para add-hours", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  let profile;
  try {
    profile = await getProfileForUser(user_id, supabase);
  } catch (error) {
    console.error("Error obteniendo perfil para add-hours", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  if (!profile) {
    return jsonResponse({ error: "Primero completá tu perfil" }, 400, origin, env);
  }

  if (!profile.hourly_rate || !profile.hourly_rate_night) {
    return jsonResponse({ error: "Definí valor por hora normal y nocturno en Perfil" }, 400, origin, env);
  }

  try {
    const sectorExists = await userHasSector(user_id, sanitizedSector, supabase);
    if (!sectorExists) {
      return jsonResponse({ error: "Seleccioná un sector válido desde Perfil" }, 400, origin, env);
    }
  } catch (error) {
    console.error("Error validando sector para add-hours", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  const financials = computeEntryFinancials({
    startTime: start_time,
    endTime: end_time,
    hourlyRate: profile.hourly_rate,
    hourlyRateNight: profile.hourly_rate_night
  });

  if (!financials) {
    return jsonResponse({ error: "No se pudo calcular el turno ingresado" }, 400, origin, env);
  }

  const payload = {
    user_id,
    date,
    start_time,
    end_time,
    sector: sanitizedSector,
    worked_hours_total: financials.worked_hours_total,
    worked_hours_normal: financials.worked_hours_normal,
    worked_hours_night: financials.worked_hours_night,
    hourly_rate_snapshot: financials.hourly_rate_snapshot,
    hourly_rate_night_snapshot: financials.hourly_rate_night_snapshot,
    money: financials.money
  };

  const { error } = await supabase.from("hours").insert(payload);
  if (error) {
    console.error("Error insertando registro de horas", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  return jsonResponse({
    ok: true,
    dinero: financials.money,
    worked_hours_total: financials.worked_hours_total,
    worked_hours_normal: financials.worked_hours_normal,
    worked_hours_night: financials.worked_hours_night
  }, 200, origin, env);
}

async function handleResumen(url, supabase, env, origin) {
  const user_id = url.searchParams.get("user_id");

  if (!isValidUuid(user_id)) {
    return jsonResponse({ error: "user_id inválido" }, 400, origin, env);
  }

  try {
    const approvalCheck = await assertUserApproved(user_id, supabase);
    if (!approvalCheck.ok) {
      return jsonResponse({ error: approvalCheck.error }, approvalCheck.status, origin, env);
    }
  } catch (error) {
    console.error("Error validando aprobacion para resumen", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  let profile;
  try {
    profile = await getProfileForUser(user_id, supabase);
  } catch (error) {
    console.error("Error obteniendo perfil para resumen", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  const { data, error } = await supabase
    .from("hours")
    .select("date, start_time, end_time, money, worked_hours_total, worked_hours_normal, worked_hours_night, hourly_rate_snapshot, hourly_rate_night_snapshot")
    .eq("user_id", user_id);

  if (error) {
    console.error("Error obteniendo resumen", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  const resumen = {};
  const billingCutoffDay = normalizeBillingCutoffDay(profile?.billing_cutoff_day);

  (data || []).forEach((row) => {
    const hydrated = hydrateHoursRow(row);
    const key = getPayPeriodKeyForDate(row.date, billingCutoffDay);
    const recalculatedMoney =
      profile?.hourly_rate && profile?.hourly_rate_night
        ? roundTo(
            hydrated.worked_hours_normal * profile.hourly_rate +
              hydrated.worked_hours_night * profile.hourly_rate_night,
            2
          )
        : hydrated.money;

    if (!resumen[key]) {
      resumen[key] = {
        money: 0,
        hours_total: 0,
        hours_normal: 0,
        hours_night: 0,
        hourly_rate_snapshot: hydrated.hourly_rate_snapshot,
        hourly_rate_night_snapshot: hydrated.hourly_rate_night_snapshot
      };
    }

    resumen[key].money = roundTo(resumen[key].money + recalculatedMoney, 2);
    resumen[key].hours_total = roundTo(resumen[key].hours_total + hydrated.worked_hours_total, 4);
    resumen[key].hours_normal = roundTo(resumen[key].hours_normal + hydrated.worked_hours_normal, 4);
    resumen[key].hours_night = roundTo(resumen[key].hours_night + hydrated.worked_hours_night, 4);

    if (resumen[key].hourly_rate_snapshot !== hydrated.hourly_rate_snapshot) {
      resumen[key].hourly_rate_snapshot = null;
    }

    if (resumen[key].hourly_rate_night_snapshot !== hydrated.hourly_rate_night_snapshot) {
      resumen[key].hourly_rate_night_snapshot = null;
    }
  });

  return jsonResponse(resumen, 200, origin, env);
}

async function handleHoursByMonth(url, supabase, env, origin) {
  const year = url.searchParams.get("year");
  const month = url.searchParams.get("month");
  const user_id = url.searchParams.get("user_id");

  if (!isValidUuid(user_id)) {
    return jsonResponse({ error: "user_id inválido" }, 400, origin, env);
  }

  try {
    const approvalCheck = await assertUserApproved(user_id, supabase);
    if (!approvalCheck.ok) {
      return jsonResponse({ error: approvalCheck.error }, approvalCheck.status, origin, env);
    }
  } catch (error) {
    console.error("Error validando aprobacion para hours-by-month", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    return jsonResponse({ error: "Mes o año inválido" }, 400, origin, env);
  }

  let profile;
  try {
    profile = await getProfileForUser(user_id, supabase);
  } catch (error) {
    console.error("Error obteniendo perfil para hours-by-month", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  const { start, end, cutoff_day: cutoffDay } = getPayPeriodRange(
    y,
    m,
    profile?.billing_cutoff_day
  );

  const { data, error } = await supabase
    .from("hours")
    .select("*")
    .eq("user_id", user_id)
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true });

  if (error) {
    console.error("Error obteniendo horas del mes", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  const registros = (data || []).map(hydrateHoursRow);
  const total = roundTo(registros.reduce((sum, row) => sum + row.money, 0), 2);
  const totalHours = roundTo(registros.reduce((sum, row) => sum + row.worked_hours_total, 0), 4);
  const normalHours = roundTo(registros.reduce((sum, row) => sum + row.worked_hours_normal, 0), 4);
  const nightHours = roundTo(registros.reduce((sum, row) => sum + row.worked_hours_night, 0), 4);

  return jsonResponse({
    total,
    total_hours: totalHours,
    normal_hours: normalHours,
    night_hours: nightHours,
    billing_cutoff_day: cutoffDay,
    period_start: start,
    period_end: end,
    registros
  }, 200, origin, env);
}

async function handleHoursByCalendarMonth(url, supabase, env, origin) {
  const year = url.searchParams.get("year");
  const month = url.searchParams.get("month");
  const user_id = url.searchParams.get("user_id");

  if (!isValidUuid(user_id)) {
    return jsonResponse({ error: "user_id inválido" }, 400, origin, env);
  }

  try {
    const approvalCheck = await assertUserApproved(user_id, supabase);
    if (!approvalCheck.ok) {
      return jsonResponse({ error: approvalCheck.error }, approvalCheck.status, origin, env);
    }
  } catch (error) {
    console.error("Error validando aprobacion para hours-by-calendar-month", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    return jsonResponse({ error: "Mes o año inválido" }, 400, origin, env);
  }

  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const { data, error } = await supabase
    .from("hours")
    .select("id, date, start_time, end_time, sector, money, worked_hours_total, worked_hours_normal, worked_hours_night")
    .eq("user_id", user_id)
    .gte("date", start)
    .lte("date", end)
    .order("date", { ascending: true });

  if (error) {
    console.error("Error obteniendo calendario mensual", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  return jsonResponse({ registros: (data || []).map(hydrateHoursRow) }, 200, origin, env);
}

async function handleDeleteHour(request, pathname, supabase, env, origin) {
  const id = pathname.split("/").pop();
  const body = await parseJsonBody(request);
  const { user_id } = body;

  const hourId = Number(id);
  if (!Number.isInteger(hourId) || hourId <= 0) {
    return jsonResponse({ error: "id inválido" }, 400, origin, env);
  }

  if (!isValidUuid(user_id)) {
    return jsonResponse({ error: "user_id inválido" }, 400, origin, env);
  }

  try {
    const approvalCheck = await assertUserApproved(user_id, supabase);
    if (!approvalCheck.ok) {
      return jsonResponse({ error: approvalCheck.error }, approvalCheck.status, origin, env);
    }
  } catch (error) {
    console.error("Error validando aprobacion para delete-hour", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  const { data, error } = await supabase
    .from("hours")
    .delete()
    .eq("id", hourId)
    .eq("user_id", user_id)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("Error eliminando registro", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  if (!data) {
    return jsonResponse({ error: "Registro no encontrado" }, 404, origin, env);
  }

  return jsonResponse({ ok: true }, 200, origin, env);
}

async function handleUpdateHour(request, pathname, supabase, env, origin) {
  const id = pathname.split("/").pop();
  const body = await parseJsonBody(request);
  const { user_id, date, start_time, end_time, sector } = body;

  const hourId = Number(id);
  if (!Number.isInteger(hourId) || hourId <= 0) {
    return jsonResponse({ error: "id inválido" }, 400, origin, env);
  }

  if (!isValidUuid(user_id)) {
    return jsonResponse({ error: "user_id inválido" }, 400, origin, env);
  }

  if (!isValidDate(date)) {
    return jsonResponse({ error: "Fecha inválida" }, 400, origin, env);
  }

  if (parseTimeToMinutes(start_time) === null || parseTimeToMinutes(end_time) === null) {
    return jsonResponse({ error: "Formato de hora inválido" }, 400, origin, env);
  }

  const sanitizedSector = sanitizeSector(sector);
  if (!sanitizedSector) {
    return jsonResponse({ error: "Sector inválido" }, 400, origin, env);
  }

  try {
    const approvalCheck = await assertUserApproved(user_id, supabase);
    if (!approvalCheck.ok) {
      return jsonResponse({ error: approvalCheck.error }, approvalCheck.status, origin, env);
    }
  } catch (error) {
    console.error("Error validando aprobacion para update-hour", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  let profile;
  try {
    profile = await getProfileForUser(user_id, supabase);
  } catch (error) {
    console.error("Error obteniendo perfil para update-hour", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  if (!profile) {
    return jsonResponse({ error: "Primero completá tu perfil" }, 400, origin, env);
  }

  if (!profile.hourly_rate || !profile.hourly_rate_night) {
    return jsonResponse({ error: "Definí valor por hora normal y nocturno en Perfil" }, 400, origin, env);
  }

  try {
    const existingRecord = await getHourRecordForUser(hourId, user_id, supabase);
    if (!existingRecord) {
      return jsonResponse({ error: "Registro no encontrado" }, 404, origin, env);
    }

    const sectorExists = await userHasSector(user_id, sanitizedSector, supabase);
    const isKeepingExistingSector = existingRecord.sector === sanitizedSector;
    if (!sectorExists && !isKeepingExistingSector) {
      return jsonResponse({ error: "Seleccioná un sector válido desde Perfil" }, 400, origin, env);
    }
  } catch (error) {
    console.error("Error validando sector para update-hour", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  const financials = computeEntryFinancials({
    startTime: start_time,
    endTime: end_time,
    hourlyRate: profile.hourly_rate,
    hourlyRateNight: profile.hourly_rate_night
  });

  if (!financials) {
    return jsonResponse({ error: "No se pudo calcular el turno ingresado" }, 400, origin, env);
  }

  const payload = {
    date,
    start_time,
    end_time,
    sector: sanitizedSector,
    worked_hours_total: financials.worked_hours_total,
    worked_hours_normal: financials.worked_hours_normal,
    worked_hours_night: financials.worked_hours_night,
    hourly_rate_snapshot: financials.hourly_rate_snapshot,
    hourly_rate_night_snapshot: financials.hourly_rate_night_snapshot,
    money: financials.money
  };

  const { data, error } = await supabase
    .from("hours")
    .update(payload)
    .eq("id", hourId)
    .eq("user_id", user_id)
    .select("*")
    .maybeSingle();

  if (error) {
    console.error("Error actualizando registro", error);
    return jsonResponse({ error: "Ocurrió un error interno" }, 500, origin, env);
  }

  if (!data) {
    return jsonResponse({ error: "Registro no encontrado" }, 404, origin, env);
  }

  const hydrated = hydrateHoursRow(data);

  return jsonResponse({
    ok: true,
    registro: hydrated
  }, 200, origin, env);
}
