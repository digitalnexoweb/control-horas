/**
 * control-horas-keep-alive
 *
 * Escribe una fila en `public.keep_alive` una vez por dia para que Supabase
 * (plan free) no pause el proyecto por inactividad.
 *
 * Historia de por que esto existe asi:
 *   1. Un GET de lectura NO resetea el contador de inactividad de Supabase.
 *      Ya se comprobo: los pings devolvian 2xx y el proyecto se pauso igual.
 *      Por eso hacemos una ESCRITURA real, que si cuenta como actividad.
 *   2. Esto vivia en .github/workflows/keep-alive.yml, pero GitHub deshabilita
 *      los workflows programados tras 60 dias de inactividad del repositorio.
 *      Paso el 31-10-2026 y el proyecto se pauso ~7 dias despues.
 *      Los Cron Triggers de Cloudflare no tienen ese comportamiento.
 */

const PING_PATH = "/rest/v1/";

/**
 * Hace la escritura real contra Supabase.
 * Devuelve un objeto con el resultado; no lanza excepciones.
 */
async function pingSupabase(env) {
  const supabaseUrl = env.SUPABASE_URL;
  const table = env.KEEP_ALIVE_TABLE || "keep_alive";
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    return {
      ok: false,
      reason: "missing_secret",
      detail:
        "Falta el secreto SUPABASE_SERVICE_ROLE_KEY. Cargalo con: npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY",
    };
  }
  if (!supabaseUrl) {
    return { ok: false, reason: "missing_url", detail: "Falta la variable SUPABASE_URL en wrangler.toml." };
  }

  const pingedAt = new Date().toISOString();
  const endpoint = `${supabaseUrl}${PING_PATH}${table}`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ pinged_at: pingedAt }),
    });
  } catch (error) {
    // Si el host no resuelve, el proyecto esta pausado (o fue borrado).
    // El keep-alive no puede despausar: eso se hace una vez a mano en
    // https://supabase.com/dashboard/project/kslcypddazdiqnvnubrx
    return {
      ok: false,
      reason: "unreachable",
      detail: `No se pudo conectar con ${supabaseUrl}. Si el DNS no resuelve, el proyecto esta PAUSADO y hay que restaurarlo a mano desde el dashboard. Error: ${error?.message ?? error}`,
    };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      reason: "http_error",
      status: response.status,
      detail: `Supabase respondio HTTP ${response.status}. Revisar que exista la tabla public.${table} (ver backend/sql/006_create_keep_alive.sql), su RLS, y que el service_role sea correcto. Body: ${body.slice(0, 500)}`,
    };
  }

  return { ok: true, status: response.status, pingedAt };
}

export default {
  /**
   * Disparado por el Cron Trigger definido en wrangler.toml.
   * Los logs se ven con: npx wrangler tail control-horas-keep-alive
   */
  async scheduled(event, env, ctx) {
    const result = await pingSupabase(env);

    if (result.ok) {
      console.log(`keep-alive OK: fila escrita (${result.pingedAt}), HTTP ${result.status}`);
      return;
    }

    console.error(`keep-alive FALLO [${result.reason}]: ${result.detail}`);
    // Lanzar marca la invocacion como fallida en las metricas del Worker,
    // para que no pase inadvertida como paso con el workflow deshabilitado.
    throw new Error(`keep-alive fallo: ${result.reason}`);
  },

  /**
   * Handler HTTP solo de diagnostico: informa la configuracion y cuando
   * corre el cron, pero NO escribe en la base. Deliberado: un endpoint
   * publico que escribe seria un vector de abuso.
   *
   * Para probar la escritura de verdad:
   *   npx wrangler dev          y luego  curl "http://localhost:8787/__scheduled"
   */
  async fetch(request, env) {
    const body = {
      worker: "control-horas-keep-alive",
      cron: "0 6 * * * (diario 06:00 UTC)",
      supabaseUrl: env.SUPABASE_URL ?? null,
      table: env.KEEP_ALIVE_TABLE || "keep_alive",
      serviceRoleKeyConfigurado: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
      nota: "Este endpoint no escribe en la base. La escritura la hace el cron.",
    };

    return new Response(JSON.stringify(body, null, 2), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  },
};
