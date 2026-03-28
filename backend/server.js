require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { createClient } = require("@supabase/supabase-js");

const app = express();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminApprovalEmail = process.env.ADMIN_APPROVAL_EMAIL || "digitalnexoweb@gmail.com";
const approvalBaseUrl = String(
  process.env.APPROVAL_BASE_URL || process.env.RENDER_EXTERNAL_URL || ""
).replace(/\/$/, "");
const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpSecure = process.env.SMTP_SECURE === "true" || smtpPort === 465;
const mailFrom = process.env.MAIL_FROM;
const configuredAllowedOrigins = String(process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
let mailTransporter = null;

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

const allowedOrigins = new Set([
  "https://control-horas-backend.onrender.com",
  "http://localhost:8080",
  "http://localhost:3000",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:3000",
  ...configuredAllowedOrigins
]);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        return callback(null, true);
      }

      try {
        const parsedOrigin = new URL(origin);
        const hostname = parsedOrigin.hostname;
        const isAllowed =
          allowedOrigins.has(origin) ||
          isNetlifyHostname(hostname) ||
          isLoopbackOrigin(hostname) ||
          isPrivateOrTailnetHostname(hostname);

        if (isAllowed) {
          return callback(null, true);
        }

        console.warn("CORS bloqueado para origin:", origin);
        return callback(new Error("Origen no permitido por CORS"));
      } catch (error) {
        console.warn("Origin invalido para CORS:", origin, error);
        return callback(new Error("Origin invalido"));
      }
    }
  })
);
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} origin=${req.headers.origin || "n/a"}`);
  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

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

  const startDay =
    normalizedCutoff >= prevMonthLastDay ? 1 : normalizedCutoff + 1;
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

function validateHourPayload(payload) {
  const { user_id, date, start_time, end_time, sector } = payload || {};

  if (!isValidUuid(user_id)) {
    return { ok: false, status: 400, error: "user_id inválido" };
  }

  if (!isValidDate(date)) {
    return { ok: false, status: 400, error: "Fecha inválida" };
  }

  if (parseTimeToMinutes(start_time) === null || parseTimeToMinutes(end_time) === null) {
    return { ok: false, status: 400, error: "Formato de hora inválido" };
  }

  const sanitizedSector = sanitizeSector(sector);
  if (!sanitizedSector) {
    return { ok: false, status: 400, error: "Sector inválido" };
  }

  return {
    ok: true,
    data: {
      user_id,
      date,
      start_time,
      end_time,
      sector: sanitizedSector
    }
  };
}

function sendClientError(res, status, message) {
  return res.status(status).json({ error: message });
}

function sendServerError(res, message, error) {
  console.error(message, error);
  return res.status(500).json({ error: "Ocurrió un error interno" });
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

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function getMailTransporter() {
  if (!smtpHost || !smtpPort || !smtpUser || !smtpPass || !mailFrom) {
    return null;
  }

  if (!mailTransporter) {
    mailTransporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });
  }

  return mailTransporter;
}

function ensureApprovalEmailConfig() {
  if (!approvalBaseUrl) {
    throw new Error("Falta APPROVAL_BASE_URL en el entorno");
  }

  if (!getMailTransporter()) {
    throw new Error("Faltan variables SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS o MAIL_FROM");
  }
}

async function getAuthUserById(userId) {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) {
    if (error.status === 404 || error.code === "user_not_found") {
      return null;
    }
    throw error;
  }

  return data?.user || null;
}

async function syncUserApprovalMetadata(user, approvalStatus) {
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

async function getProfileApprovalRecord(userId) {
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

async function getEffectiveApprovalState(userId) {
  const authUser = await getAuthUserById(userId);
  const profileApproval = await getProfileApprovalRecord(userId);

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

async function assertUserApproved(userId) {
  const approvalState = await getEffectiveApprovalState(userId);

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

async function sendAdminApprovalEmail({ email, userId, approvalToken, requestedAt, phone, institution, message }) {
  ensureApprovalEmailConfig();

  const approvalUrl = `${approvalBaseUrl}/auth/approve-user?token=${encodeURIComponent(approvalToken)}`;
  const transporter = getMailTransporter();
  const safeEmail = escapeHtml(email);
  const safeUserId = escapeHtml(userId);
  const safeRequestedAt = escapeHtml(requestedAt);
  const safePhone = escapeHtml(phone || "No informado");
  const safeInstitution = escapeHtml(institution || "No informada");
  const safeMessage = escapeHtml(message || "Sin mensaje");

  await transporter.sendMail({
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
  });
}

async function getProfileForUser(userId) {
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

async function userHasSector(userId, sectorName) {
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

async function getHourRecordForUser(hourId, userId) {
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
    split.worked_hours_normal * hourlyRate +
      split.worked_hours_night * hourlyRateNight,
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

app.get("/", (req, res) => {
  res.send("Backend Supabase OK");
});

app.post("/auth/register-request", async (req, res) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password || "");
  const phone = sanitizeOptionalPhone(req.body?.phone);
  const institution = sanitizeOptionalText(req.body?.institution, 160);
  const message = sanitizeOptionalText(req.body?.message, 1000);

  if (!email || !email.includes("@")) {
    return sendClientError(res, 400, "Email inválido");
  }

  if (password.length < 6) {
    return sendClientError(res, 400, "La contraseña debe tener al menos 6 caracteres");
  }

  const requestedAt = new Date().toISOString();
  const approvalToken = crypto.randomUUID();

  let createdUser = null;

  try {
    ensureApprovalEmailConfig();

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
      return sendClientError(
        res,
        isDuplicate ? 409 : 400,
        isDuplicate ? "Ya existe una cuenta o solicitud para este email" : error.message || "No se pudo crear la solicitud"
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
    });
  } catch (error) {
    if (createdUser?.id) {
      try {
        await supabase.auth.admin.deleteUser(createdUser.id);
      } catch (rollbackError) {
        console.error("No se pudo revertir el usuario creado tras un fallo en register-request", rollbackError);
      }
    }

    const errorMessage = String(error?.message || "");
    if (
      errorMessage.includes("APPROVAL_BASE_URL") ||
      errorMessage.includes("SMTP_HOST") ||
      errorMessage.includes("SMTP_PORT") ||
      errorMessage.includes("SMTP_USER") ||
      errorMessage.includes("SMTP_PASS") ||
      errorMessage.includes("MAIL_FROM")
    ) {
      console.error("Configuracion incompleta para solicitudes de acceso", error);
      return res.status(500).json({
        error: "El servidor no tiene configurado el envio de solicitudes de acceso"
      });
    }

    return sendServerError(res, "Error procesando solicitud de aprobacion", error);
  }

  return res.json({
    ok: true,
    status: "pending",
    message: "Solicitud enviada. Un administrador debe aprobar tu acceso."
  });
});

app.get("/auth/approval-status", async (req, res) => {
  const { user_id: userId } = req.query;

  if (!isValidUuid(userId)) {
    return sendClientError(res, 400, "user_id inválido");
  }

  try {
    const approvalState = await getEffectiveApprovalState(userId);
    return res.json({
      ok: true,
      status: approvalState.status,
      approved: approvalState.approved,
      message: approvalState.approved ? "Cuenta aprobada" : getApprovalBlockedMessage(approvalState.status)
    });
  } catch (error) {
    return sendServerError(res, "Error consultando estado de aprobacion", error);
  }
});

app.get("/auth/approve-user", async (req, res) => {
  const approvalToken = String(req.query?.token || "").trim();

  if (!isValidUuid(approvalToken)) {
    return res.status(400).send("Token de aprobacion invalido");
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
    return res.status(500).send("No se pudo procesar la aprobacion");
  }

  if (!profileApproval?.user_id) {
    return res.status(404).send("La solicitud ya fue aprobada o el token no existe");
  }

  try {
    const authUser = await getAuthUserById(profileApproval.user_id);

    if (!authUser) {
      return res.status(404).send("Usuario no encontrado");
    }

    await syncUserApprovalMetadata(authUser, "approved");

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

    return res.send(`
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
    `);
  } catch (error) {
    console.error("Error aprobando usuario", error);
    return res.status(500).send("No se pudo aprobar el usuario");
  }
});

app.post("/add-hours", async (req, res) => {
  const validation = validateHourPayload(req.body);
  if (!validation.ok) {
    return sendClientError(res, validation.status, validation.error);
  }

  const { user_id, date, start_time, end_time, sector } = validation.data;

  try {
    const approvalCheck = await assertUserApproved(user_id);
    if (!approvalCheck.ok) {
      return sendClientError(res, approvalCheck.status, approvalCheck.error);
    }
  } catch (error) {
    return sendServerError(res, "Error validando aprobacion para add-hours", error);
  }

  let profile;
  try {
    profile = await getProfileForUser(user_id);
  } catch (error) {
    return sendServerError(res, "Error obteniendo perfil para add-hours", error);
  }

  if (!profile) {
    return sendClientError(res, 400, "Primero completá tu perfil");
  }

  if (!profile.hourly_rate || !profile.hourly_rate_night) {
    return sendClientError(res, 400, "Definí valor por hora normal y nocturno en Perfil");
  }

  try {
    const sectorExists = await userHasSector(user_id, sector);
    if (!sectorExists) {
      return sendClientError(res, 400, "Seleccioná un sector válido desde Perfil");
    }
  } catch (error) {
    return sendServerError(res, "Error validando sector para add-hours", error);
  }

  const financials = computeEntryFinancials({
    startTime: start_time,
    endTime: end_time,
    hourlyRate: profile.hourly_rate,
    hourlyRateNight: profile.hourly_rate_night
  });

  if (!financials) {
    return sendClientError(res, 400, "No se pudo calcular el turno ingresado");
  }

  const payload = {
    user_id,
    date,
    start_time,
    end_time,
    sector,
    worked_hours_total: financials.worked_hours_total,
    worked_hours_normal: financials.worked_hours_normal,
    worked_hours_night: financials.worked_hours_night,
    hourly_rate_snapshot: financials.hourly_rate_snapshot,
    hourly_rate_night_snapshot: financials.hourly_rate_night_snapshot,
    money: financials.money
  };

  const { error } = await supabase.from("hours").insert(payload);
  if (error) {
    return sendServerError(res, "Error insertando registro de horas", error);
  }

  return res.json({
    ok: true,
    dinero: financials.money,
    worked_hours_total: financials.worked_hours_total,
    worked_hours_normal: financials.worked_hours_normal,
    worked_hours_night: financials.worked_hours_night
  });
});

app.get("/resumen", async (req, res) => {
  const { user_id } = req.query;

  if (!isValidUuid(user_id)) {
    return sendClientError(res, 400, "user_id inválido");
  }

  try {
    const approvalCheck = await assertUserApproved(user_id);
    if (!approvalCheck.ok) {
      return sendClientError(res, approvalCheck.status, approvalCheck.error);
    }
  } catch (error) {
    return sendServerError(res, "Error validando aprobacion para resumen", error);
  }

  let profile;
  try {
    profile = await getProfileForUser(user_id);
  } catch (error) {
    return sendServerError(res, "Error obteniendo perfil para resumen", error);
  }

  const { data, error } = await supabase
    .from("hours")
    .select("date, start_time, end_time, money, worked_hours_total, worked_hours_normal, worked_hours_night, hourly_rate_snapshot, hourly_rate_night_snapshot")
    .eq("user_id", user_id);

  if (error) {
    return sendServerError(res, "Error obteniendo resumen", error);
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

  res.json(resumen);
});

app.get("/hours-by-month", async (req, res) => {
  const { year, month, user_id } = req.query;

  if (!isValidUuid(user_id)) {
    return sendClientError(res, 400, "user_id inválido");
  }

  try {
    const approvalCheck = await assertUserApproved(user_id);
    if (!approvalCheck.ok) {
      return sendClientError(res, approvalCheck.status, approvalCheck.error);
    }
  } catch (error) {
    return sendServerError(res, "Error validando aprobacion para hours-by-month", error);
  }

  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    return sendClientError(res, 400, "Mes o año inválido");
  }

  let profile;
  try {
    profile = await getProfileForUser(user_id);
  } catch (error) {
    return sendServerError(res, "Error obteniendo perfil para hours-by-month", error);
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
    return sendServerError(res, "Error obteniendo horas del mes", error);
  }

  const registros = (data || []).map(hydrateHoursRow);
  const total = roundTo(registros.reduce((sum, row) => sum + row.money, 0), 2);
  const totalHours = roundTo(registros.reduce((sum, row) => sum + row.worked_hours_total, 0), 4);
  const normalHours = roundTo(registros.reduce((sum, row) => sum + row.worked_hours_normal, 0), 4);
  const nightHours = roundTo(registros.reduce((sum, row) => sum + row.worked_hours_night, 0), 4);

  res.json({
    total,
    total_hours: totalHours,
    normal_hours: normalHours,
    night_hours: nightHours,
    billing_cutoff_day: cutoffDay,
    period_start: start,
    period_end: end,
    registros
  });
});

app.get("/hours-by-calendar-month", async (req, res) => {
  const { year, month, user_id } = req.query;

  if (!isValidUuid(user_id)) {
    return sendClientError(res, 400, "user_id inválido");
  }

  try {
    const approvalCheck = await assertUserApproved(user_id);
    if (!approvalCheck.ok) {
      return sendClientError(res, approvalCheck.status, approvalCheck.error);
    }
  } catch (error) {
    return sendServerError(res, "Error validando aprobacion para hours-by-calendar-month", error);
  }

  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    return sendClientError(res, 400, "Mes o año inválido");
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
    return sendServerError(res, "Error obteniendo calendario mensual", error);
  }

  res.json({ registros: (data || []).map(hydrateHoursRow) });
});

app.delete("/delete-hour/:id", async (req, res) => {
  const { id } = req.params;
  const { user_id } = req.body || {};

  const hourId = Number(id);
  if (!Number.isInteger(hourId) || hourId <= 0) {
    return sendClientError(res, 400, "id inválido");
  }

  if (!isValidUuid(user_id)) {
    return sendClientError(res, 400, "user_id inválido");
  }

  try {
    const approvalCheck = await assertUserApproved(user_id);
    if (!approvalCheck.ok) {
      return sendClientError(res, approvalCheck.status, approvalCheck.error);
    }
  } catch (error) {
    return sendServerError(res, "Error validando aprobacion para delete-hour", error);
  }

  const { data, error } = await supabase
    .from("hours")
    .delete()
    .eq("id", hourId)
    .eq("user_id", user_id)
    .select("id")
    .maybeSingle();

  if (error) {
    return sendServerError(res, "Error eliminando registro", error);
  }

  if (!data) {
    return sendClientError(res, 404, "Registro no encontrado");
  }

  res.json({ ok: true });
});

app.put("/update-hour/:id", async (req, res) => {
  const { id } = req.params;
  const hourId = Number(id);

  if (!Number.isInteger(hourId) || hourId <= 0) {
    return sendClientError(res, 400, "id inválido");
  }

  const validation = validateHourPayload(req.body);
  if (!validation.ok) {
    return sendClientError(res, validation.status, validation.error);
  }

  const { user_id, date, start_time, end_time, sector } = validation.data;

  try {
    const approvalCheck = await assertUserApproved(user_id);
    if (!approvalCheck.ok) {
      return sendClientError(res, approvalCheck.status, approvalCheck.error);
    }
  } catch (error) {
    return sendServerError(res, "Error validando aprobacion para update-hour", error);
  }

  let profile;
  try {
    profile = await getProfileForUser(user_id);
  } catch (error) {
    return sendServerError(res, "Error obteniendo perfil para update-hour", error);
  }

  if (!profile) {
    return sendClientError(res, 400, "Primero completá tu perfil");
  }

  if (!profile.hourly_rate || !profile.hourly_rate_night) {
    return sendClientError(res, 400, "Definí valor por hora normal y nocturno en Perfil");
  }

  try {
    const existingRecord = await getHourRecordForUser(hourId, user_id);
    if (!existingRecord) {
      return sendClientError(res, 404, "Registro no encontrado");
    }

    const sectorExists = await userHasSector(user_id, sector);
    const isKeepingExistingSector = existingRecord.sector === sector;
    if (!sectorExists && !isKeepingExistingSector) {
      return sendClientError(res, 400, "Seleccioná un sector válido desde Perfil");
    }
  } catch (error) {
    return sendServerError(res, "Error validando sector para update-hour", error);
  }

  const financials = computeEntryFinancials({
    startTime: start_time,
    endTime: end_time,
    hourlyRate: profile.hourly_rate,
    hourlyRateNight: profile.hourly_rate_night
  });

  if (!financials) {
    return sendClientError(res, 400, "No se pudo calcular el turno ingresado");
  }

  const payload = {
    date,
    start_time,
    end_time,
    sector,
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
    return sendServerError(res, "Error actualizando registro", error);
  }

  if (!data) {
    return sendClientError(res, 404, "Registro no encontrado");
  }

  const hydrated = hydrateHoursRow(data);

  return res.json({
    ok: true,
    registro: hydrated
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor Supabase corriendo en 0.0.0.0:${PORT}`);
});
