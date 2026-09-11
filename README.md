# Áurea — App de préstamos (MVP funcional)

Backend + frontend reales, conectados. Sin dependencias externas de npm —
corre con Node.js puro, lo que significa que puedes desplegarlo en
prácticamente cualquier proveedor sin instalar nada.

## Qué SÍ hace esta versión

- Registro / login real con contraseñas cifradas (scrypt)
- Simulador de préstamo con cálculo real de amortización (sistema francés)
- Solicitud de préstamo con motor de aprobación automática real (mismas
  reglas que definimos: KYC, ratio de endeudamiento, score interno,
  garantía, reglas duras para vehículos)
- Base de datos real (archivos JSON en `/data`, persistente entre reinicios)
- Panel de cliente con historial de cuotas y pago de cuotas
- Panel de administrador con cola de solicitudes y aprobación/rechazo manual
- Selector de idioma ES/EN
- Selector de método de pago (Zelle, Tarjeta/ACH, Transferencia, PayPal)

## Qué NO hace todavía (y por qué)

- **No cobra ni desembolsa dinero real.** Los métodos de pago se registran
  como texto (ej. "Zelle"), pero no hay conexión real a Stripe, PayPal o un
  banco. Conectar el cobro real requiere que abras cuentas de negocio con
  esos proveedores — son credenciales tuyas, no algo que yo pueda generar.
- **No verifica documentos de verdad.** El KYC es un interruptor manual.
  Verificación real de identidad requiere una cuenta con Onfido, Jumio o
  similar (indicado en el brief técnico).
- **No está publicada en ningún dominio.** Corre localmente hasta que la
  despliegues (ver abajo).
- **No cumple ningún requisito legal/licencia.** Eso sigue pendiente de
  confirmar con un abogado, como se mencionó desde el inicio.

## Cómo correrla en tu computadora

Requiere tener Node.js instalado (versión 18 o superior). No requiere `npm install`.

```
node server.js
```

Abre `http://localhost:3000` en el navegador. La primera vez se crea un
usuario administrador: `admin@aurea.com` / `admin123` — cámbialo antes de
usar la app con datos reales (ver más abajo).

## Cómo conseguir un link público real (para enviarle a un cliente)

Necesitas desplegar este código en un servidor con internet. Como no usa
dependencias externas, cualquiera de estas opciones funciona en minutos:

**Opción rápida — Render.com (gratis para empezar)**
1. Sube esta carpeta a un repositorio de GitHub
2. En Render.com → "New Web Service" → conecta el repositorio
3. Comando de arranque: `node server.js`
4. Render te da una URL pública (ej. `https://aurea-tuapp.onrender.com`) —
   esa es la que le compartes al cliente

**Opción alterna — Railway.app** funciona igual de simple.

**Opción con más control — un VPS (DigitalOcean, AWS Lightsail, etc.)**
1. Instala Node.js en el servidor
2. Copia esta carpeta
3. Corre `node server.js` (idealmente con un gestor de procesos como `pm2`
   para que se reinicie solo si falla)
4. Apunta tu dominio al servidor

## Antes de usarla con datos y dinero reales

- [ ] Cambia `AUREA_SECRET` (variable de entorno) por un valor largo y aleatorio
- [ ] Cambia la contraseña del usuario admin por defecto
- [ ] Conecta un proveedor real de pagos (Stripe/PayPal Business)
- [ ] Conecta un proveedor real de verificación de identidad
- [ ] Usa HTTPS (Render/Railway lo dan automático; un VPS necesita configurarlo)
- [ ] Resuelve los pendientes legales del brief técnico (licencia, tope de
      tasa de usura, marco legal para garantías)
- [ ] Considera migrar de archivos JSON a una base de datos real
      (PostgreSQL) antes de tener muchos usuarios simultáneos — el diseño
      de datos ya sigue ese modelo, así que la migración es directa

## Estructura del proyecto

```
aurea-app/
  server.js       → servidor HTTP y todas las rutas de la API
  db.js           → acceso a datos (usuarios y préstamos)
  engine.js       → motor de amortización + motor de aprobación
  public/
    index.html    → frontend completo (ES/EN), conectado a la API
  data/           → se crea automáticamente al arrancar (users.json, loans.json)
```
