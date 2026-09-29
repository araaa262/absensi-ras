require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Resend } = require('resend');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_FILE = path.join(__dirname, 'data', 'attendance.json');
const sessions = new Map();
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function readAttendance() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}
function writeAttendance(rows) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(rows, null, 2));
}
function adminOnly(req, res, next) {
  const password = req.headers['x-admin-password'] || req.body?.adminPassword;
  if (!process.env.ADMIN_PASSWORD || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, message: 'Password admin salah.' });
  }
  next();
}
function safeText(value, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

app.post('/api/session', adminOnly, async (req, res) => {
  const duration = Math.min(Math.max(Number(req.body.duration || 60), 1), 720);
  const token = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + duration * 60 * 1000;
  const baseUrl = (process.env.BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const attendanceUrl = `${baseUrl}/absen.html?token=${token}`;
  const qrDataUrl = await QRCode.toDataURL(attendanceUrl, { width: 520, margin: 2, errorCorrectionLevel: 'M' });
  sessions.set(token, { token, expiresAt, createdAt: Date.now(), attendanceUrl });
  res.json({ ok: true, token, expiresAt, attendanceUrl, qrDataUrl });
});

app.get('/api/session/:token', (req, res) => {
  const s = sessions.get(req.params.token);
  if (!s || Date.now() > s.expiresAt) return res.status(404).json({ ok: false, message: 'QR sudah kedaluwarsa.' });
  res.json({ ok: true, expiresAt: s.expiresAt });
});

app.post('/api/attendance', async (req, res) => {
  const token = safeText(req.body.token, 100);
  const name = safeText(req.body.name, 80);
  const kelas = safeText(req.body.kelas, 50);
  const status = safeText(req.body.status, 20) || 'Hadir';
  const note = safeText(req.body.note, 200);
  const s = sessions.get(token);
  if (!s || Date.now() > s.expiresAt) return res.status(400).json({ ok: false, message: 'QR sudah kedaluwarsa. Minta QR baru.' });
  if (!name || !kelas) return res.status(400).json({ ok: false, message: 'Nama dan kelas wajib diisi.' });

  const rows = readAttendance();
  const today = new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
  const duplicate = rows.find(r => r.token === token && r.name.toLowerCase() === name.toLowerCase());
  if (duplicate) return res.status(409).json({ ok: false, message: 'Nama tersebut sudah melakukan absensi pada sesi ini.' });

  const record = {
    id: crypto.randomUUID(), name, kelas, status, note,
    date: today,
    time: new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }),
    timestamp: new Date().toISOString(), token
  };
  rows.unshift(record);
  writeAttendance(rows);

  let emailSent = false;
  if (resend && process.env.ADMIN_EMAIL && process.env.MAIL_FROM) {
    const { error } = await resend.emails.send({
      from: process.env.MAIL_FROM,
      to: [process.env.ADMIN_EMAIL],
      subject: `Absensi baru — ${name}`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6"><h2>Absensi Baru</h2><p><b>Nama:</b> ${escapeHtml(name)}</p><p><b>Kelas:</b> ${escapeHtml(kelas)}</p><p><b>Status:</b> ${escapeHtml(status)}</p><p><b>Waktu:</b> ${escapeHtml(record.date)} ${escapeHtml(record.time)} WIB</p>${note ? `<p><b>Keterangan:</b> ${escapeHtml(note)}</p>` : ''}</div>`
    });
    emailSent = !error;
  }
  res.json({ ok: true, message: 'Absensi berhasil dicatat.', emailSent });
});

app.get('/api/attendance', adminOnly, (req, res) => {
  const rows = readAttendance();
  res.json({ ok: true, rows });
});

app.get('/api/stats', adminOnly, (req, res) => {
  const rows = readAttendance();
  const today = new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
  const todayRows = rows.filter(r => r.date === today);
  res.json({ ok: true, total: todayRows.length, hadir: todayRows.filter(r => r.status === 'Hadir').length, izin: todayRows.filter(r => r.status === 'Izin').length, sakit: todayRows.filter(r => r.status === 'Sakit').length });
});

app.get('/api/export', adminOnly, (req, res) => {
  const rows = readAttendance();
  const headers = ['Nama','Kelas','Status','Tanggal','Waktu','Keterangan'];
  const csv = [headers, ...rows.map(r => [r.name,r.kelas,r.status,r.date,r.time,r.note])]
    .map(row => row.map(v => `"${String(v ?? '').replace(/"/g,'""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="absensi-kelas.csv"');
  res.send('\ufeff' + csv);
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, () => console.log(`Absensi berjalan di http://localhost:${PORT}`));
