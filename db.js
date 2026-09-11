const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const LOANS_FILE = path.join(DATA_DIR, 'loans.json');

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
  if (!fs.existsSync(LOANS_FILE)) fs.writeFileSync(LOANS_FILE, '[]');
}
ensure();

function readUsers() { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
function writeUsers(u) { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); }
function readLoans() { return JSON.parse(fs.readFileSync(LOANS_FILE, 'utf8')); }
function writeLoans(l) { fs.writeFileSync(LOANS_FILE, JSON.stringify(l, null, 2)); }

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

// Crea un usuario administrador por defecto la primera vez que corre el servidor.
// CAMBIA esta contraseña antes de usar la app con datos reales.
function seedAdmin() {
  const users = readUsers();
  if (!users.find(u => u.email === 'admin@aurea.com')) {
    const salt = crypto.randomBytes(16).toString('hex');
    users.push({
      id: 'admin-' + Date.now(),
      name: 'Administrador Áurea',
      email: 'admin@aurea.com',
      phone: '',
      salt,
      passwordHash: hashPassword('admin123', salt),
      role: 'admin',
      kyc: {},
      createdAt: new Date().toISOString()
    });
    writeUsers(users);
    console.log('>> Usuario admin creado: admin@aurea.com / admin123  (cámbialo antes de producción)');
  }
}
seedAdmin();

module.exports = { readUsers, writeUsers, readLoans, writeLoans, hashPassword };
