require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PAGO_POR_HORA = 325;

function calcularHorasTrabajadas(startTime, endTime) {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);

  if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) {
    return null;
  }

  let startM = sh * 60 + sm;
  let endM = eh * 60 + em;
  if (endM <= startM) endM += 1440;

  return (endM - startM) / 60;
}

/* ---------- SUPABASE ---------- */
const supabaseUrl = 'https://kslcypddazdiqnvnubrx.supabase.co';

const supabase = createClient(
  supabaseUrl,
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtzbGN5cGRkYXpkaXFudm51YnJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyNzM3OTEsImV4cCI6MjA4Njg0OTc5MX0.gjtV9KLwtCps_HwN53vUYmbd4ipwVB7WMgmFhp2Fy4I"
);

/* ---------- MIDDLEWARE ---------- */
app.use(cors());
app.use(express.json());

/* ---------- HEALTH ---------- */
app.get('/', (req, res) => {
  res.send('Backend Supabase OK');
});

/* ---------- DEBUG HOURS ---------- */
app.get('/debug-hours', async (req, res) => {
  const { data, error } = await supabase
    .from('hours')
    .select('*');

  if (error) return res.status(500).json(error);

  res.json(data);
});

/* ---------- ADD HOURS ---------- */
app.post('/add-hours', async (req, res) => {
  const { user_id, date, start_time, end_time, sector } = req.body;

  console.log("ADD HOURS USER_ID:", user_id);

  if (!user_id || !date || !start_time || !end_time || !sector) {
    return res.status(400).json({ error: 'Datos incompletos' });
  }

  const hours = calcularHorasTrabajadas(start_time, end_time);
  if (hours === null) {
    return res.status(400).json({ error: 'Formato de hora inválido' });
  }

  const money = hours * PAGO_POR_HORA;

  const { error } = await supabase
    .from('hours')
    .insert({
      user_id,
      date,
      start_time,
      end_time,
      sector,
      money
    });

  if (error) return res.status(500).json(error);

  res.json({ dinero: money });
});

/* ---------- RESUMEN (21 → 20) ---------- */
app.get('/resumen', async (req, res) => {
  const { user_id } = req.query;

  console.log("RESUMEN USER_ID:", user_id);

  if (!user_id) {
    return res.status(400).json({ error: 'user_id requerido' });
  }

  const { data, error } = await supabase
    .from('hours')
    .select('*')
    .eq('user_id', user_id);

  if (error) return res.status(500).json(error);

  if (!data || data.length === 0) {
    return res.json({});
  }

  const resumen = {};

  data.forEach(r => {
    const fecha = new Date(r.date + "T00:00:00");

    let year = fecha.getFullYear();
    let month = fecha.getMonth() + 1;

    if (fecha.getDate() >= 21) {
      month += 1;
      if (month === 13) {
        month = 1;
        year += 1;
      }
    }

    const key = `${year}-${String(month).padStart(2, '0')}`;

    const hours = calcularHorasTrabajadas(r.start_time, r.end_time) || 0;

    if (!resumen[key]) {
      resumen[key] = { money: 0, hours: 0 };
    }

    resumen[key].money += r.money;
    resumen[key].hours += hours;
  });

  res.json(resumen);
});

/* ---------- DETALLE MES (21 → 20) ---------- */
app.get('/hours-by-month', async (req, res) => {
  const { year, month, user_id } = req.query;

  console.log("HOURS-BY-MONTH USER_ID:", user_id);

  if (!year || !month || !user_id) {
    return res.status(400).json({ error: 'Parámetros incompletos' });
  }

  const y = Number(year);
  const m = Number(month);

  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;

  const start = `${prevYear}-${String(prevMonth).padStart(2, '0')}-21`;
  const end = `${y}-${String(m).padStart(2, '0')}-20`;

  const { data, error } = await supabase
    .from('hours')
    .select('*')
    .eq('user_id', user_id)
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: true });

  if (error) return res.status(500).json(error);

  const total = data.reduce((sum, h) => sum + h.money, 0);

  res.json({ total, registros: data });
});

/* ---------- CALENDARIO (MES NATURAL) ---------- */
app.get('/hours-by-calendar-month', async (req, res) => {
  const { year, month, user_id } = req.query;

  if (!year || !month || !user_id) {
    return res.status(400).json({ error: 'Parámetros incompletos' });
  }

  const y = Number(year);
  const m = Number(month);

  if (Number.isNaN(y) || Number.isNaN(m) || m < 1 || m > 12) {
    return res.status(400).json({ error: 'Mes o año inválido' });
  }

  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  const { data, error } = await supabase
    .from('hours')
    .select('*')
    .eq('user_id', user_id)
    .gte('date', start)
    .lte('date', end)
    .order('date', { ascending: true });

  if (error) return res.status(500).json(error);

  res.json({ registros: data });
});

/* ---------- DELETE ---------- */
app.delete('/delete-hour/:id', async (req, res) => {
  const { error } = await supabase
    .from('hours')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json(error);

  res.json({ ok: true });
});

/* ---------- START ---------- */
const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  console.log('Servidor Supabase corriendo');
});
