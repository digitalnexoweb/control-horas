const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://kslcypddazdiqnvnubrx.supabase.co";
const supabaseKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzbGN5cGRkYXpkaXFudm51YnJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzM3OTEsImV4cCI6MjA4Njg0OTc5MX0.gjtV9KLwtCps_HwN53vUYmbd4ipwVB7WMgmFhp2Fy4I";
const PAGO_POR_HORA = 325;
const PAGE_SIZE = 500;

const supabase = createClient(supabaseUrl, supabaseKey);

function calcularHorasTrabajadas(startTime, endTime) {
  const [sh, sm] = String(startTime || "").split(":").map(Number);
  const [eh, em] = String(endTime || "").split(":").map(Number);

  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) {
    return null;
  }

  let startM = sh * 60 + sm;
  let endM = eh * 60 + em;
  if (endM <= startM) endM += 1440;

  return (endM - startM) / 60;
}

async function main() {
  let from = 0;
  let updated = 0;
  let skipped = 0;
  let page = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("hours")
      .select("id,start_time,end_time,money")
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Error leyendo horas (${from}-${to}): ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    for (const row of data) {
      const hours = calcularHorasTrabajadas(row.start_time, row.end_time);
      if (hours === null) {
        skipped += 1;
        continue;
      }

      const money = Number((hours * PAGO_POR_HORA).toFixed(2));
      if (Number(row.money) === money) {
        continue;
      }

      const { error: updateError } = await supabase
        .from("hours")
        .update({ money })
        .eq("id", row.id);

      if (updateError) {
        throw new Error(`Error actualizando id=${row.id}: ${updateError.message}`);
      }

      updated += 1;
    }

    page += 1;
    from += PAGE_SIZE;
    console.log(`Pagina ${page} procesada (${data.length} filas)`);
  }

  console.log("Recálculo completado");
  console.log(`Tarifa aplicada: ${PAGO_POR_HORA}`);
  console.log(`Registros actualizados: ${updated}`);
  console.log(`Registros omitidos por formato inválido: ${skipped}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
