// index.ts
import { config } from 'dotenv';
config();

// CAMBIO AQUÍ: Usamos require para importar el handler de forma segura
// '.default' es necesario porque audit-batch exporta con 'export default'
const auditBatch = require('./api/audit-batch');
const handler = auditBatch.default;

const INTERVALO_MINUTOS = 15;
const INTERVALO_MS = INTERVALO_MINUTOS * 60 * 1000;

console.log(`🚀 Iniciando Sistema Auditor Autónomo...`);
console.log(`⏱️ Frecuencia: Cada ${INTERVALO_MINUTOS} minutos.`);

async function ejecutarCiclo() {
    const ahora = new Date();
    console.log(`\n==================================================`);
    console.log(`🔄 Iniciando ciclo: ${ahora.toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`);
    
    // Simulamos respuesta
    const res = {
        status: (code: number) => ({
            json: (data: any) => mostrarResultado(data)
        }),
        json: (data: any) => mostrarResultado(data)
    };

    try {
        await handler({}, res);
    } catch (error) {
        console.error("🔥 Error crítico:", error);
    }
}

function mostrarResultado(data: any) {
    if (data.resumen) {
        console.log("📊 Resumen:", JSON.stringify(data.resumen, null, 2));
    } else {
        console.log("✅ Resultado:", JSON.stringify(data, null, 2).substring(0, 200) + "...");
    }
}

// Arrancar
ejecutarCiclo();
setInterval(ejecutarCiclo, INTERVALO_MS);