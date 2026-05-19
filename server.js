/**
 * NEXUS NOC — API Server v2.0  (Node.js + Express + MySQL + JWT)
 * ─────────────────────────────────────────────────────────────
 * Instalar:  npm install
 * Iniciar:   node server.js
 * Dev:       npm run dev
 *
 * Autenticação JWT:
 *   POST /api/auth/login   → { username, password } → { token, user }
 *   GET  /api/auth/me      → info do usuário logado
 *   POST /api/auth/logout  → invalida sessão (client descarta token)
 *
 * Controle de acesso:
 *   role=admin  → leitura + escrita (criar/editar/excluir tudo)
 *   role=user   → somente leitura  (GET de todas as rotas)
 */

'use strict';

const express    = require('express');
const cors       = require('cors');
const mysql      = require('mysql2/promise');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const { exec }   = require('child_process');
const path       = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET  = process.env.JWT_SECRET  || 'nexus-noc-secret-key-change-in-prod!';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '12h';

// ── Middlewares ───────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── DB Pool ──────────────────────────────────────────────────
const db = mysql.createPool({
  host:               process.env.DB_HOST     || 'localhost',
  port:    parseInt(  process.env.DB_PORT     || '3306'),
  user:               process.env.DB_USER     || 'noc_user',
  password:           process.env.DB_PASSWORD || 'NocPass2024!',
  database:           process.env.DB_NAME     || 'nexus_noc',
  waitForConnections: true,
  connectionLimit:    10,
  timezone:           'local',
  charset:            'utf8mb4',
});

// ── Helpers ──────────────────────────────────────────────────
const apiErr = (res, e, msg = 'Erro interno') => {
  console.error(`[ERR] ${msg}:`, e.message);
  const status = e.code === 'ER_DUP_ENTRY' ? 409 : 500;
  res.status(status).json({ error: msg, detail: e.message });
};

function fmtUptime(uptimeStart) {
  if (!uptimeStart) return '—';
  const s = Math.floor((Date.now() - new Date(uptimeStart).getTime()) / 1000);
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h < 24)   return `${h}h ${m}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h ${m}m`;
}

function icmpPing(ip) {
  return new Promise(resolve => {
    const isWin = process.platform === 'win32';
    const cmd   = isWin ? `ping -n 4 -w 2000 ${ip}` : `ping -c 4 -W 2 ${ip}`;
    exec(cmd, { timeout: 12000 }, (error, stdout) => {
      if (error && !stdout)
        return resolve({ status: 'offline', latency_ms: null, packet_loss: 100 });
      const lossM = stdout.match(/(\d+)%\s*(?:packet\s*)?loss/i);
      const loss  = lossM ? parseInt(lossM[1]) : 0;
      if (loss === 100)
        return resolve({ status: 'offline', latency_ms: null, packet_loss: 100 });
      const avgM = stdout.match(/(?:\/)([\d.]+)(?:\/)/)
                || stdout.match(/Average\s*=\s*([\d.]+)ms/i)
                || stdout.match(/time[<=]([\d.]+)\s*ms/i);
      const latency = avgM ? Math.round(parseFloat(avgM[1])) : null;
      const status  = loss > 0 || (latency && latency > 150) ? 'warn'
                    : latency && latency > 40 ? 'warn' : 'online';
      resolve({ status, latency_ms: latency, packet_loss: loss });
    });
  });
}

// ════════════════════════════════════════════════════════════
// MIDDLEWARES DE AUTENTICAÇÃO
// ════════════════════════════════════════════════════════════

/** Verifica JWT — anexa req.user. Retorna 401 se inválido. */
function authRequired(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Token não fornecido. Faça login.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido ou expirado. Faça login novamente.' });
  }
}

/** Exige role=admin. Retorna 403 se for user. */
function adminOnly(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ error: 'Acesso negado. Somente administradores podem realizar esta ação.' });
}

// ════════════════════════════════════════════════════════════
// AUTH ROUTES
// ════════════════════════════════════════════════════════════

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'username e password são obrigatórios' });
  try {
    const [rows] = await db.query(
      'SELECT * FROM users WHERE username=? AND active=1', [username]
    );
    if (!rows.length)
      return res.status(401).json({ error: 'Usuário não encontrado ou inativo' });

    const user = rows[0];
    const ok   = await bcrypt.compare(password, user.password_hash);
    if (!ok)
      return res.status(401).json({ error: 'Senha incorreta' });

    // Atualizar last_login
    await db.query('UPDATE users SET last_login=NOW() WHERE id=?', [user.id]);

    const payload = { id: user.id, username: user.username, role: user.role, full_name: user.full_name };
    const token   = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });

    console.log(`[LOGIN] ${user.username} (${user.role}) — ${new Date().toLocaleString()}`);
    res.json({ token, user: payload });
  } catch (e) { apiErr(res, e, 'Erro no login'); }
});

// GET /api/auth/me
app.get('/api/auth/me', authRequired, (req, res) => {
  res.json(req.user);
});

// POST /api/auth/logout  (client descarta token — log no servidor)
app.post('/api/auth/logout', authRequired, (req, res) => {
  console.log(`[LOGOUT] ${req.user.username} — ${new Date().toLocaleString()}`);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════
// USER MANAGEMENT (admin only)
// ════════════════════════════════════════════════════════════

// GET /api/users
app.get('/api/users', authRequired, adminOnly, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, username, full_name, role, active, last_login, created_at FROM users ORDER BY id'
    );
    res.json(rows);
  } catch (e) { apiErr(res, e, 'Erro ao listar usuários'); }
});

// POST /api/users
app.post('/api/users', authRequired, adminOnly, async (req, res) => {
  const { username, password, full_name, role } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'username e password são obrigatórios' });
  if (!['admin','user'].includes(role))
    return res.status(400).json({ error: 'role deve ser "admin" ou "user"' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const [r]  = await db.query(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)',
      [username, hash, full_name || null, role]
    );
    const [rows] = await db.query(
      'SELECT id, username, full_name, role, active, created_at FROM users WHERE id=?', [r.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Nome de usuário já existe' });
    apiErr(res, e, 'Erro ao criar usuário');
  }
});

// PUT /api/users/:id
app.put('/api/users/:id', authRequired, adminOnly, async (req, res) => {
  const { full_name, role, active, password } = req.body;
  try {
    // Impede que o admin remova a si mesmo
    if (parseInt(req.params.id) === req.user.id && active === false)
      return res.status(400).json({ error: 'Você não pode desativar sua própria conta' });

    let query = 'UPDATE users SET full_name=?, role=?, active=? WHERE id=?';
    let params = [full_name || null, role, active !== false ? 1 : 0, req.params.id];

    if (password && password.trim()) {
      const hash = await bcrypt.hash(password, 10);
      query  = 'UPDATE users SET full_name=?, role=?, active=?, password_hash=? WHERE id=?';
      params = [full_name || null, role, active !== false ? 1 : 0, hash, req.params.id];
    }
    await db.query(query, params);
    const [rows] = await db.query(
      'SELECT id, username, full_name, role, active, last_login, created_at FROM users WHERE id=?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' });
    res.json(rows[0]);
  } catch (e) { apiErr(res, e, 'Erro ao atualizar usuário'); }
});

// DELETE /api/users/:id
app.delete('/api/users/:id', authRequired, adminOnly, async (req, res) => {
  if (parseInt(req.params.id) === req.user.id)
    return res.status(400).json({ error: 'Você não pode excluir sua própria conta' });
  try {
    await db.query('DELETE FROM users WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { apiErr(res, e, 'Erro ao excluir usuário'); }
});

// ════════════════════════════════════════════════════════════
// DEVICES  (leitura: qualquer auth | escrita: admin only)
// ════════════════════════════════════════════════════════════

app.get('/api/devices', authRequired, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT d.*, IF(s.id IS NOT NULL,1,0) AS has_snmp,
        s.community, s.port AS snmp_port, s.poll_interval, s.ros_version
      FROM devices d LEFT JOIN snmp_configs s ON s.device_id = d.id
      ORDER BY d.created_at ASC
    `);
    res.json(rows.map(d => ({ ...d, uptime: fmtUptime(d.uptime_start) })));
  } catch (e) { apiErr(res, e, 'Erro ao listar dispositivos'); }
});

app.get('/api/devices/:id', authRequired, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT d.*, IF(s.id IS NOT NULL,1,0) AS has_snmp
       FROM devices d LEFT JOIN snmp_configs s ON s.device_id=d.id WHERE d.id=?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json({ ...rows[0], uptime: fmtUptime(rows[0].uptime_start) });
  } catch (e) { apiErr(res, e, 'Erro ao buscar dispositivo'); }
});

app.post('/api/devices', authRequired, adminOnly, async (req, res) => {
  const { name, ip, type, vendor, location, contact, description, vlans } = req.body;
  if (!name || !ip || !type)
    return res.status(400).json({ error: 'name, ip e type são obrigatórios' });
  try {
    const [r] = await db.query(
      `INSERT INTO devices (name,ip,type,vendor,location,contact,description,vlans)
       VALUES (?,?,?,?,?,?,?,?)`,
      [name, ip, type, vendor||'Outro', location||null, contact||null, description||null, vlans||0]
    );
    const [rows] = await db.query('SELECT * FROM devices WHERE id=?', [r.insertId]);
    res.status(201).json({ ...rows[0], uptime: '—', has_snmp: 0 });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Já existe um dispositivo com este IP' });
    apiErr(res, e, 'Erro ao criar dispositivo');
  }
});

app.put('/api/devices/:id', authRequired, adminOnly, async (req, res) => {
  const { name, ip, type, vendor, location, contact, description, vlans } = req.body;
  try {
    await db.query(
      `UPDATE devices SET name=?,ip=?,type=?,vendor=?,location=?,contact=?,description=?,vlans=? WHERE id=?`,
      [name, ip, type, vendor||'Outro', location||null, contact||null, description||null, vlans||0, req.params.id]
    );
    const [rows] = await db.query('SELECT * FROM devices WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Não encontrado' });
    res.json({ ...rows[0], uptime: fmtUptime(rows[0].uptime_start) });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY')
      return res.status(409).json({ error: 'Já existe um dispositivo com este IP' });
    apiErr(res, e, 'Erro ao atualizar dispositivo');
  }
});

app.delete('/api/devices/:id', authRequired, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM devices WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { apiErr(res, e, 'Erro ao remover dispositivo'); }
});

app.post('/api/devices/:id/ping', authRequired, adminOnly, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM devices WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Dispositivo não encontrado' });
    const ping = await icmpPing(rows[0].ip);
    await db.query('CALL sp_save_ping(?,?,?,?)',
      [rows[0].id, ping.status, ping.latency_ms, ping.packet_loss]);
    const [updated] = await db.query('SELECT * FROM devices WHERE id=?', [rows[0].id]);
    const dev = updated[0];
    res.json({ ...ping, device: { ...dev, uptime: fmtUptime(dev.uptime_start) } });
  } catch (e) { apiErr(res, e, 'Erro ao executar ping'); }
});

app.get('/api/devices/:id/ping-history', authRequired, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 1000);
    const [rows] = await db.query(
      'SELECT * FROM ping_results WHERE device_id=? ORDER BY probed_at DESC LIMIT ?',
      [req.params.id, limit]
    );
    res.json(rows);
  } catch (e) { apiErr(res, e, 'Erro ao buscar histórico'); }
});

// ════════════════════════════════════════════════════════════
// SNMP  (leitura: qualquer auth | escrita: admin only)
// ════════════════════════════════════════════════════════════

app.get('/api/snmp', authRequired, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT s.*, d.name AS device_name, d.ip AS device_ip
      FROM snmp_configs s JOIN devices d ON d.id = s.device_id ORDER BY s.created_at ASC
    `);
    res.json(rows);
  } catch (e) { apiErr(res, e, 'Erro ao listar SNMP configs'); }
});

app.post('/api/snmp', authRequired, adminOnly, async (req, res) => {
  const { device_id, community, port, trap_community, trap_target_ip,
          poll_interval, ros_version, snmp_enabled, traps_enabled, acl_enabled } = req.body;
  if (!device_id || !community)
    return res.status(400).json({ error: 'device_id e community são obrigatórios' });
  try {
    await db.query(`
      INSERT INTO snmp_configs
        (device_id,community,port,trap_community,trap_target_ip,
         poll_interval,ros_version,snmp_enabled,traps_enabled,acl_enabled)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE
        community=VALUES(community), port=VALUES(port),
        trap_community=VALUES(trap_community), trap_target_ip=VALUES(trap_target_ip),
        poll_interval=VALUES(poll_interval), ros_version=VALUES(ros_version),
        snmp_enabled=VALUES(snmp_enabled), traps_enabled=VALUES(traps_enabled),
        acl_enabled=VALUES(acl_enabled)
    `, [device_id, community, port||161, trap_community||null, trap_target_ip||null,
        poll_interval||60, ros_version||7, snmp_enabled!==false?1:0,
        traps_enabled?1:0, acl_enabled!==false?1:0]);
    const [rows] = await db.query('SELECT * FROM snmp_configs WHERE device_id=?', [device_id]);
    res.status(201).json(rows[0]);
  } catch (e) { apiErr(res, e, 'Erro ao salvar SNMP config'); }
});

app.delete('/api/snmp/:deviceId', authRequired, adminOnly, async (req, res) => {
  try {
    await db.query('DELETE FROM snmp_configs WHERE device_id=?', [req.params.deviceId]);
    res.json({ ok: true });
  } catch (e) { apiErr(res, e, 'Erro ao remover SNMP config'); }
});

app.post('/api/snmp/:deviceId/poll', authRequired, async (req, res) => {
  const { oids } = req.body;
  if (!Array.isArray(oids) || !oids.length)
    return res.status(400).json({ error: 'oids[] é obrigatório' });
  try {
    const values = oids.map(o => [req.params.deviceId, o.name, o.oid, String(o.value), o.unit||null]);
    await db.query('INSERT INTO snmp_polls (device_id,oid_name,oid,value_text,unit) VALUES ?', [values]);
    res.json({ saved: oids.length });
  } catch (e) { apiErr(res, e, 'Erro ao salvar coleta SNMP'); }
});

app.get('/api/snmp/:deviceId/polls', authRequired, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT * FROM snmp_polls WHERE device_id=?
        AND polled_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)
      ORDER BY polled_at DESC
    `, [req.params.deviceId]);
    res.json(rows);
  } catch (e) { apiErr(res, e, 'Erro ao buscar coletas SNMP'); }
});

// ════════════════════════════════════════════════════════════
// ALERTS  (leitura: qualquer auth | ack/clear: admin only)
// ════════════════════════════════════════════════════════════

app.get('/api/alerts', authRequired, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT a.*, d.name AS device_name, d.ip AS device_ip
      FROM alerts a LEFT JOIN devices d ON d.id = a.device_id
      ORDER BY a.created_at DESC LIMIT 200
    `);
    res.json(rows);
  } catch (e) { apiErr(res, e, 'Erro ao buscar alertas'); }
});

app.patch('/api/alerts/:id/ack', authRequired, adminOnly, async (req, res) => {
  try {
    await db.query('UPDATE alerts SET acknowledged=1 WHERE id=?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { apiErr(res, e); }
});

app.delete('/api/alerts/all', authRequired, adminOnly, async (req, res) => {
  try {
    await db.query('UPDATE alerts SET acknowledged=1');
    res.json({ ok: true });
  } catch (e) { apiErr(res, e); }
});

// ════════════════════════════════════════════════════════════
// DASHBOARD + HEALTH
// ════════════════════════════════════════════════════════════

app.get('/api/dashboard', authRequired, async (req, res) => {
  try {
    const [[kpis]]       = await db.query('SELECT * FROM v_dashboard_kpis');
    const [[alertCount]] = await db.query('SELECT COUNT(*) AS open_alerts FROM alerts WHERE acknowledged=0');
    res.json({ ...kpis, ...alertCount });
  } catch (e) { apiErr(res, e); }
});

app.get('/api/health', async (req, res) => {
  try {
    const [[r]] = await db.query('SELECT NOW() AS ts');
    res.json({ status: 'ok', db: 'connected', server_time: r.ts });
  } catch (e) {
    res.status(503).json({ status: 'error', db: 'disconnected', detail: e.message });
  }
});

// ════════════════════════════════════════════════════════════
// SPEED TEST  —  mede download / upload / latência reais
// ════════════════════════════════════════════════════════════

const https = require('https');
const http  = require('http');

/**
 * Baixa uma URL e retorna { bytes, ms }
 * Usa conexão direta (sem axios) para precisão máxima no tempo.
 */
function fetchBytes(url, maxMs = 10000) {
  return new Promise((resolve, reject) => {
    const mod    = url.startsWith('https') ? https : http;
    const start  = Date.now();
    let   bytes  = 0;
    const req = mod.get(url, { timeout: maxMs }, res => {
      res.on('data', chunk => { bytes += chunk.length; });
      res.on('end',  ()    => resolve({ bytes, ms: Date.now() - start }));
      res.on('error', reject);
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); resolve({ bytes, ms: Date.now() - start }); });
  });
}

/**
 * Envia `sizeBytes` bytes via POST e retorna { ms }
 */
function uploadBytes(url, sizeBytes, maxMs = 10000) {
  return new Promise((resolve, reject) => {
    const mod    = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const data   = Buffer.alloc(sizeBytes, 'X');
    const start  = Date.now();
    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + (parsed.search || ''),
      method:   'POST',
      headers:  { 'Content-Type': 'application/octet-stream', 'Content-Length': sizeBytes },
      timeout:  maxMs,
    };
    const req = mod.request(options, res => {
      res.resume(); // drena resposta
      res.on('end', () => resolve({ ms: Date.now() - start }));
    });
    req.on('error',   reject);
    req.on('timeout', () => { req.destroy(); resolve({ ms: Date.now() - start }); });
    req.write(data);
    req.end();
  });
}

/** Mede latência fazendo HEAD em uma URL e descartando o corpo */
function measureLatency(url) {
  return new Promise(resolve => {
    const mod    = url.startsWith('https') ? https : http;
    const parsed = new URL(url);
    const times  = [];
    let   done   = 0;
    const probe  = () => {
      const start = Date.now();
      const req = mod.request(
        { hostname: parsed.hostname, path: '/', method: 'HEAD', timeout: 3000 },
        res => { res.resume(); times.push(Date.now() - start); if (++done === 4) finish(); }
      );
      req.on('error', () => { if (++done === 4) finish(); });
      req.on('timeout', () => { req.destroy(); if (++done === 4) finish(); });
      req.end();
    };
    const finish = () => {
      if (!times.length) return resolve({ avg: null, jitter: null });
      const avg    = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
      const jitter = times.length > 1
        ? parseFloat((Math.max(...times) - Math.min(...times)).toFixed(1))
        : 0;
      resolve({ avg, jitter });
    };
    for (let i = 0; i < 4; i++) setTimeout(probe, i * 200);
  });
}

// CDN endpoints públicos para teste (sem auth, sem custo)
const TEST_SERVERS = [
  {
    name: 'Cloudflare CDN',
    host: 'speed.cloudflare.com',
    download: 'https://speed.cloudflare.com/__down?bytes=10000000',  // 10 MB
    upload:   'https://speed.cloudflare.com/__up',
    latency:  'https://speed.cloudflare.com',
  },
  {
    name: 'Cloudflare CDN (5MB)',
    host: 'speed.cloudflare.com',
    download: 'https://speed.cloudflare.com/__down?bytes=5000000',   // 5 MB fallback
    upload:   'https://speed.cloudflare.com/__up',
    latency:  'https://speed.cloudflare.com',
  },
];

let _speedTestRunning = false;

async function runSpeedTest() {
  if (_speedTestRunning) return null;
  _speedTestRunning = true;
  const server = TEST_SERVERS[0];
  const result = { server_host: server.name, status: 'ok',
                   download_mbps: null, upload_mbps: null,
                   latency_ms: null, jitter_ms: null, error_msg: null };
  try {
    // 1. Latência (4 probes HEAD)
    const lat = await measureLatency(server.latency);
    result.latency_ms = lat.avg;
    result.jitter_ms  = lat.jitter;

    // 2. Download — busca 10 MB, mede throughput
    const dl = await fetchBytes(server.download, 15000);
    if (dl.bytes > 0 && dl.ms > 100) {
      result.download_mbps = parseFloat(((dl.bytes * 8) / (dl.ms / 1000) / 1_000_000).toFixed(2));
    }

    // 3. Upload — envia 5 MB
    const ul = await uploadBytes(server.upload, 5_000_000, 15000);
    if (ul.ms > 100) {
      result.upload_mbps = parseFloat(((5_000_000 * 8) / (ul.ms / 1000) / 1_000_000).toFixed(2));
    }
  } catch (e) {
    result.status    = 'error';
    result.error_msg = e.message.slice(0, 255);
    console.error('[SPEEDTEST] Erro:', e.message);
  } finally {
    _speedTestRunning = false;
  }
  return result;
}

// POST /api/speedtest  — executa o teste e persiste
app.post('/api/speedtest', authRequired, async (req, res) => {
  if (_speedTestRunning)
    return res.status(409).json({ error: 'Teste já em andamento. Aguarde.' });
  try {
    res.json({ status: 'running', message: 'Teste iniciado. Consulte GET /api/speedtest/last em ~15s.' });
    const result = await runSpeedTest();
    if (result) {
      await db.query(
        `INSERT INTO speed_tests (download_mbps,upload_mbps,latency_ms,jitter_ms,server_host,status,error_msg)
         VALUES (?,?,?,?,?,?,?)`,
        [result.download_mbps, result.upload_mbps, result.latency_ms,
         result.jitter_ms, result.server_host, result.status, result.error_msg]
      );
    }
  } catch (e) { console.error('[SPEEDTEST] DB error:', e.message); }
});

// GET /api/speedtest/last  — último resultado
app.get('/api/speedtest/last', authRequired, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM speed_tests ORDER BY tested_at DESC LIMIT 1'
    );
    if (_speedTestRunning) return res.json({ running: true, last: rows[0] || null });
    res.json({ running: false, last: rows[0] || null });
  } catch (e) { apiErr(res, e, 'Erro ao buscar último teste'); }
});

// GET /api/speedtest/history  — histórico
app.get('/api/speedtest/history', authRequired, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const [rows] = await db.query(
      'SELECT * FROM speed_tests ORDER BY tested_at DESC LIMIT ?', [limit]
    );
    res.json(rows);
  } catch (e) { apiErr(res, e, 'Erro ao buscar histórico'); }
});


app.listen(PORT, () => {
  console.log('');
  console.log('  ╔════════════════════════════════════════════╗');
  console.log(`  ║   NEXUS NOC v2 API → http://localhost:${PORT}  ║`);
  console.log('  ║   Auth: JWT  |  Roles: admin / user        ║');
  console.log('  ╚════════════════════════════════════════════╝');
  console.log('');
  console.log('  Usuários padrão:');
  console.log('    admin  / Admin@2024!  (acesso total)');
  console.log('    viewer / User@2024!   (somente leitura)');
  console.log('');
});
