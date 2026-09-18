
Engine · JS
function round2(n) { return Math.round(n * 100) / 100; }
 
// Sistema francés (cuota fija)
function calcularCuota(monto, tasaPct, plazo) {
  const i = tasaPct / 100;
  if (i === 0) return monto / plazo;
  const cuota = (monto * (i * Math.pow(1 + i, plazo))) / (Math.pow(1 + i, plazo) - 1);
  return cuota;
}
 
function generarCuotas(monto, tasaPct, plazo, fechaInicio) {
  const i = tasaPct / 100;
  const cuotaFija = calcularCuota(monto, tasaPct, plazo);
  let saldo = monto;
  const cuotas = [];
  const start = fechaInicio ? new Date(fechaInicio) : new Date();
  for (let k = 1; k <= plazo; k++) {
    const interes = saldo * i;
    const capital = cuotaFija - interes;
    saldo = Math.max(0, saldo - capital);
    const fecha = new Date(start);
    fecha.setMonth(fecha.getMonth() + k);
    cuotas.push({
      numero: k,
      fecha_vencimiento: fecha.toISOString().slice(0, 10),
      monto_capital: round2(capital),
      monto_interes: round2(interes),
      monto_total: round2(cuotaFija),
      estado: 'pendiente',
      dias_mora: 0
    });
  }
  return cuotas;
}
 
// Asigna la tasa automáticamente según el perfil del cliente. El cliente
// nunca elige su tasa: la decide el sistema, no la persona.
//  - 5%  → clientes recurrentes con historial de pago a tiempo en la plataforma
//  - 10% → clientes nuevos con buena capacidad de pago o garantía sólida
//  - 20% → el resto (perfil de mayor riesgo)
function asignarTasa({ historialPagosATiempo = 0, ingresoMensual = 0, monto, plazo, garantia }) {
  if (historialPagosATiempo > 0) return 5;
 
  // Ratio estimado usando una tasa de referencia neutral, solo para clasificar el riesgo
  // (la tasa real ya asignada se usa después para calcular la cuota definitiva).
  const cuotaRef = calcularCuota(monto, 10, plazo);
  const ratioRef = ingresoMensual > 0 ? cuotaRef / ingresoMensual : 1;
 
  let ltv = null;
  if (garantia && garantia.valorTasado > 0) ltv = monto / garantia.valorTasado;
 
  if (ratioRef <= 0.35 || (ltv !== null && ltv <= 0.5)) return 10;
 
  return 20;
}
 
// Motor de aprobación automática.
// Pesa poco el buró externo a propósito: el público objetivo suele tener
// historial crediticio débil. Pesa más el comportamiento dentro de la
// propia plataforma, el ingreso verificado y la garantía.
function evaluarSolicitud({ monto, plazo, tasa, ingresoMensual, garantia, historialPagosATiempo = 0 }) {
  const cuota = calcularCuota(monto, tasa, plazo);
  const ratio = ingresoMensual > 0 ? cuota / ingresoMensual : 0.5;
  const razones = [];
 
  if (ratio > 0.60) {
    return { decision: 'rechazado', score: 0, ratio: round2(ratio), razones: ['ratio_endeudamiento_excede_60'] };
  }
 
  let score = 500;
  if (ratio <= 0.30) { score += 200; razones.push('ratio_endeudamiento_optimo'); }
  else if (ratio <= 0.45) { score += 100; razones.push('ratio_endeudamiento_aceptable'); }
  else { razones.push('ratio_endeudamiento_alto'); }
 
  score += Math.min(150, historialPagosATiempo * 30);
  if (historialPagosATiempo > 0) razones.push('historial_positivo_en_plataforma');
 
  let ltv = null;
  if (garantia && garantia.valorTasado > 0) {
    ltv = monto / garantia.valorTasado;
    if (ltv <= 0.5) { score += 150; razones.push('garantia_ltv_conservador'); }
    else if (ltv <= 0.7) { score += 80; razones.push('garantia_presente'); }
  }
 
  let decision;
  if (score >= 750) decision = 'aprobado_automatico';
  else if (score >= 550) decision = 'aprobado_automatico';
  else if (score >= 350) decision = 'revision_manual';
  else decision = 'rechazado';
 
  // Una garantía fuerte puede subir un caso de revisión manual a aprobado.
  if (decision === 'revision_manual' && garantia && ltv !== null && ltv <= 0.5 && garantia.valorTasado >= monto * 1.5) {
    decision = 'aprobado_automatico';
    razones.push('garantia_fuerte_sube_a_aprobado');
  }
 
  // Regla dura: vehículos/inmuebles siempre pasan por revisión manual,
  // sin importar el score (complejidad legal de ejecución).
  if (decision === 'aprobado_automatico' && garantia && ['vehiculo', 'inmueble'].includes(garantia.tipo)) {
    decision = 'revision_manual';
    razones.push('garantia_vehicular_requiere_revision_manual');
  }
 
  return { decision, score, ratio: round2(ratio), ltv: ltv !== null ? round2(ltv) : null, razones };
}
 
module.exports = { calcularCuota, generarCuotas, evaluarSolicitud, asignarTasa, round2 };
 

