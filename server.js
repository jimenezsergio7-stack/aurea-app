const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readUsers, writeUsers, readLoans, writeLoans, hashPassword } = require('./db');
const { calcularCuota, generarCuotas, evaluarSolicitud, asignarTasa } = require('./engine');

const PORT = process.env.PORT || 3000;
// IMPORTANTE: cambia este secreto por una cadena larga y aleatoria antes de producción.
const SECRET = process.env.AUREA_SECRET || 'cambia-este-secreto-en-produccion';

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (expected !== sig) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()); }
  catch (e) { return null; }
}

function sendJson(res, code, obj) {
  const data = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    let chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function getAuthUser(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const users = readUsers();
  return users.find(u => u.id === payload.id) || null;
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, kyc: u.kyc };
}

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  const full = path.join(PUBLIC_DIR, filePath);
  if (!full.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('No encontrado'); }
    const ext = path.extname(full);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  try {
    // ---------- REGISTRO ----------
    if (pathname === '/api/register' && req.method === 'POST') {
      const { name, email, phone, password } = await readBody(req);
      if (!name || !email || !password) return sendJson(res, 400, { error: 'Faltan campos requeridos' });
      const users = readUsers();
      if (users.find(u => u.email === email)) return sendJson(res, 409, { error: 'Ese email ya está registrado' });
      const salt = crypto.randomBytes(16).toString('hex');
      const user = {
        id: 'u-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        name, email, phone: phone || '', salt,
        passwordHash: hashPassword(password, salt),
        role: 'client',
        kyc: { id: false, selfie: false, domicilio: false, ingresos: false },
        createdAt: new Date().toISOString()
      };
      users.push(user); writeUsers(users);
      const token = signToken({ id: user.id, role: user.role });
      return sendJson(res, 201, { token, user: publicUser(user) });
    }

    // ---------- LOGIN ----------
    if (pathname === '/api/login' && req.method === 'POST') {
      const { email, password } = await readBody(req);
      const users = readUsers();
      const user = users.find(u => u.email === email);
      if (!user) return sendJson(res, 401, { error: 'Credenciales inválidas' });
      const hash = hashPassword(password, user.salt);
      if (hash !== user.passwordHash) return sendJson(res, 401, { error: 'Credenciales inválidas' });
      const token = signToken({ id: user.id, role: user.role });
      return sendJson(res, 200, { token, user: publicUser(user) });
    }

    // ---------- INFO DE PAGO (Zelle, etc.) ----------
    if (pathname === '/api/payment-info' && req.method === 'GET') {
      return sendJson(res, 200, { zelle: process.env.AUREA_ZELLE_CONTACTO || '' });
    }

    // ---------- ACTUALIZAR KYC ----------
    if (pathname === '/api/kyc' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'No autenticado' });
      const body = await readBody(req);
      const users = readUsers();
      const idx = users.findIndex(u => u.id === user.id);
      users[idx].kyc = { ...users[idx].kyc, ...body };
      writeUsers(users);
      return sendJson(res, 200, { kyc: users[idx].kyc });
    }

    // ---------- SIMULADOR ----------
    // El cliente nunca elige la tasa: aquí solo devolvemos un rango estimado
    // (mejor caso 5%, peor caso 20%) para que se haga una idea antes de solicitar.
    if (pathname === '/api/simulate' && req.method === 'POST') {
      const { monto, plazo } = await readBody(req);
      if (!monto || !plazo) return sendJson(res, 400, { error: 'monto y plazo son requeridos' });
      const cuotaMin = calcularCuota(Number(monto), 5, Number(plazo));
      const cuotaMax = calcularCuota(Number(monto), 20, Number(plazo));
      return sendJson(res, 200, {
        cuotaMin: Math.round(cuotaMin * 100) / 100,
        cuotaMax: Math.round(cuotaMax * 100) / 100,
        totalMin: Math.round(cuotaMin * plazo * 100) / 100,
        totalMax: Math.round(cuotaMax * plazo * 100) / 100
      });
    }

    // ---------- SOLICITAR PRÉSTAMO ----------
    if (pathname === '/api/loans/apply' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'No autenticado' });
      const body = await readBody(req);
      const { monto, plazo, ingresoMensual, garantia } = body;
      if (!monto || !plazo) return sendJson(res, 400, { error: 'Faltan datos del préstamo' });

      const loans = readLoans();
      const historialPagosATiempo = loans.filter(l => l.userId === user.id && l.estado === 'pagado').length;

      // La tasa la decide el sistema según el perfil del cliente, nunca el cliente mismo.
      const tasa = asignarTasa({
        historialPagosATiempo, ingresoMensual: Number(ingresoMensual) || 0,
        monto: Number(monto), plazo: Number(plazo), garantia
      });

      const evaluacion = evaluarSolicitud({
        monto: Number(monto), plazo: Number(plazo), tasa,
        ingresoMensual: Number(ingresoMensual) || 0, garantia, historialPagosATiempo
      });

      const cuota = calcularCuota(Number(monto), tasa, Number(plazo));
      const loan = {
        id: 'l-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        userId: user.id,
        monto: Number(monto), plazo: Number(plazo), tasa,
        cuotaMensual: Math.round(cuota * 100) / 100,
        totalAPagar: Math.round(cuota * plazo * 100) / 100,
        garantia: garantia || null,
        evaluacion,
        estado: evaluacion.decision === 'aprobado_automatico' ? 'activo'
              : evaluacion.decision === 'revision_manual' ? 'revision_manual'
              : 'rechazado',
        cuotas: evaluacion.decision === 'aprobado_automatico' ? generarCuotas(Number(monto), Number(tasa), Number(plazo)) : [],
        pagos: [],
        createdAt: new Date().toISOString()
      };
      loans.push(loan); writeLoans(loans);
      return sendJson(res, 201, { loan });
    }

    // ---------- MIS PRÉSTAMOS ----------
    if (pathname === '/api/loans/mine' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'No autenticado' });
      const loans = readLoans().filter(l => l.userId === user.id);
      return sendJson(res, 200, { loans });
    }

    // ---------- REPORTAR PAGO (queda pendiente de confirmación del admin) ----------
    const payMatch = pathname.match(/^\/api\/loans\/([^/]+)\/pay$/);
    if (payMatch && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user) return sendJson(res, 401, { error: 'No autenticado' });
      const { numeroCuota, metodo } = await readBody(req);
      const loans = readLoans();
      const loan = loans.find(l => l.id === payMatch[1] && l.userId === user.id);
      if (!loan) return sendJson(res, 404, { error: 'Préstamo no encontrado' });
      const cuota = loan.cuotas.find(c => c.numero === Number(numeroCuota));
      if (!cuota) return sendJson(res, 404, { error: 'Cuota no encontrada' });
      if (cuota.estado === 'pagada') return sendJson(res, 400, { error: 'Esa cuota ya está pagada' });
      if (cuota.estado === 'reportado') return sendJson(res, 400, { error: 'Ya reportaste este pago, está esperando confirmación' });

      // El cliente reporta que pagó, pero la cuota NO se marca pagada todavía.
      // Un pago por Zelle (o cualquier método sin pasarela conectada) requiere
      // que el administrador confirme manualmente que el dinero llegó.
      cuota.estado = 'reportado';
      loan.pagos.push({
        numeroCuota: cuota.numero, monto: cuota.monto_total, metodo: metodo || 'no especificado',
        estado: 'pendiente_confirmacion', fechaReportado: new Date().toISOString()
      });
      writeLoans(loans);
      return sendJson(res, 200, { loan });
    }

    // ---------- ADMIN: PAGOS REPORTADOS PENDIENTES DE CONFIRMAR ----------
    if (pathname === '/api/admin/pagos-pendientes' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'Solo administradores' });
      const users = readUsers();
      const loans = readLoans();
      const pendientes = [];
      loans.forEach(loan => {
        loan.cuotas.forEach(cuota => {
          if (cuota.estado === 'reportado') {
            const pago = loan.pagos.find(p => p.numeroCuota === cuota.numero && p.estado === 'pendiente_confirmacion');
            pendientes.push({
              loanId: loan.id,
              numeroCuota: cuota.numero,
              clienteNombre: (users.find(u => u.id === loan.userId) || {}).name || 'Desconocido',
              monto: cuota.monto_total,
              metodo: pago ? pago.metodo : 'no especificado',
              fechaReportado: pago ? pago.fechaReportado : null
            });
          }
        });
      });
      return sendJson(res, 200, { pendientes });
    }

    // ---------- ADMIN: CONFIRMAR PAGO RECIBIDO ----------
    if (pathname === '/api/admin/pagos/confirmar' && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'Solo administradores' });
      const { loanId, numeroCuota } = await readBody(req);
      const loans = readLoans();
      const loan = loans.find(l => l.id === loanId);
      if (!loan) return sendJson(res, 404, { error: 'Préstamo no encontrado' });
      const cuota = loan.cuotas.find(c => c.numero === Number(numeroCuota));
      if (!cuota) return sendJson(res, 404, { error: 'Cuota no encontrada' });
      cuota.estado = 'pagada';
      const pago = loan.pagos.find(p => p.numeroCuota === cuota.numero && p.estado === 'pendiente_confirmacion');
      if (pago) { pago.estado = 'confirmado'; pago.fechaConfirmado = new Date().toISOString(); }
      if (loan.cuotas.every(c => c.estado === 'pagada')) loan.estado = 'pagado';
      writeLoans(loans);
      return sendJson(res, 200, { loan });
    }

    // ---------- ADMIN: COLA DE SOLICITUDES ----------
    if (pathname === '/api/admin/queue' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'Solo administradores' });
      const users = readUsers();
      const loans = readLoans().map(l => ({
        ...l,
        clienteNombre: (users.find(u => u.id === l.userId) || {}).name || 'Desconocido'
      })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return sendJson(res, 200, { loans });
    }

    // ---------- ADMIN: DECISIÓN MANUAL ----------
    const decisionMatch = pathname.match(/^\/api\/admin\/loans\/([^/]+)\/decision$/);
    if (decisionMatch && req.method === 'POST') {
      const user = getAuthUser(req);
      if (!user || user.role !== 'admin') return sendJson(res, 403, { error: 'Solo administradores' });
      const { decision } = await readBody(req); // 'aprobado' | 'rechazado'
      const loans = readLoans();
      const loan = loans.find(l => l.id === decisionMatch[1]);
      if (!loan) return sendJson(res, 404, { error: 'Préstamo no encontrado' });
      if (decision === 'aprobado') {
        loan.estado = 'activo';
        loan.cuotas = generarCuotas(loan.monto, loan.tasa, loan.plazo);
      } else {
        loan.estado = 'rechazado';
      }
      writeLoans(loans);
      return sendJson(res, 200, { loan });
    }

    // ---------- ARCHIVOS DEL FRONTEND ----------
    if (req.method === 'GET' && !pathname.startsWith('/api/')) {
      return serveStatic(req, res, pathname);
    }

    sendJson(res, 404, { error: 'Ruta no encontrada' });
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: 'Error interno del servidor', detail: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`Áurea backend corriendo en http://localhost:${PORT}`);
});
