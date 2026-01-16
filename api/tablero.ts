import { supabaseA } from '../lib/supabase';
import axios from 'axios';
import { obtenerCoordenadas, calcularDistancia } from '../lib/config';

// ... (obtenerPosicionesWialon se mantiene igual, cópiala del código anterior) ...
// Para ahorrar espacio, asumo que mantienes la función obtenerPosicionesWialon aquí arriba.
async function obtenerPosicionesWialon(token: string) {
    try {
        const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
        const sid = login.data.eid;
        
        const search = await axios.get(
            `https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_items&params={"spec":{"itemsType":"avl_unit","propName":"sys_name","propValueMask":"*","sortType":"sys_name"},"force":1,"flags":1025,"from":0,"to":0}&sid=${sid}`
        );
        
        await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
        
        const mapaBuses = new Map();
        if (search.data.items) {
            search.data.items.forEach((u: any) => {
                if (u.pos) {
                    const nombre = u.nm.replace(/^0+/, '').trim();
                    mapaBuses.set(nombre, { lat: u.pos.y, lon: u.pos.x, t: u.pos.t });
                }
            });
        }
        return mapaBuses;
    } catch (e) {
        return new Map();
    }
}

export default async function handler(req: any, res: any) {
    try {
        const hoy = new Date();
        const hoyStr = hoy.toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});
        
        // 1. CONSULTA MAESTRA (Basada en tu Schema)
        // Traemos Horarios y su relación con tabla_rodamiento
        const { data: plan } = await supabaseA
            .from('operacion_diaria')
            .select(`
                vehiculo_id,
                horario_id,
                Vehículos!inner (numero_interno),
                Horarios!inner (
                    hora, 
                    origen, 
                    destino,
                    tabla_rodamiento!inner (descripcion) 
                )
            `)
            .eq('fecha', hoyStr);

        if (!plan) return res.json({ error: "Error leyendo Supabase", turnos: [] });

        // 2. WIALON
        const posiciones = await obtenerPosicionesWialon(process.env.WIALON_TOKEN || "");

        // 3. PROCESAMIENTO
        const tablero = [];
        const ahoraCol = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Bogota"}));
        const ahoraMinutos = ahoraCol.getHours() * 60 + ahoraCol.getMinutes();

        for (const turno of (plan as any[])) {
            // Extracción segura de datos anidados
            const numBus = String(turno.Vehículos?.numero_interno);
            const hora = turno.Horarios?.hora;
            const origen = turno.Horarios?.origen;
            const destino = turno.Horarios?.destino;
            
            // AQUÍ ESTÁ LA MAGIA: Acceder a la descripción a través de Horarios
            // Como usamos !inner en la consulta, el dato debe venir sí o sí
            // Pero TypeScript puede quejarse si es un array, así que verificamos
            const tablaObj = turno.Horarios?.tabla_rodamiento;
            const nombreTabla = Array.isArray(tablaObj) ? tablaObj[0]?.descripcion : tablaObj?.descripcion;
            
            const [h, m] = hora.split(':').map(Number);
            const minutosTurno = h * 60 + m;

            // Filtro de tiempo (-60 a +180 min)
            if (minutosTurno < (ahoraMinutos - 60) || minutosTurno > (ahoraMinutos + 180)) continue;

            const pos = posiciones.get(numBus);
            let estado = "SIN SEÑAL";
            let color = "gray"; 
            let distancia = -1;

            if (pos) {
                const origenCoords = obtenerCoordenadas(origen);
                if (origenCoords) {
                    distancia = Math.round(calcularDistancia(pos.lat, pos.lon, origenCoords.lat, origenCoords.lon));
                    
                    if (distancia < 1500) { 
                        estado = "EN TERMINAL";
                        const diff = minutosTurno - ahoraMinutos;
                        if (diff < 0) { estado = "RETRASADO"; color = "red"; }
                        else if (diff < 15) { estado = "LISTO"; color = "green"; }
                        else { estado = "EN ESPERA"; color = "blue"; }
                    } else {
                        if (minutosTurno < ahoraMinutos) { estado = "EN RUTA"; color = "blue"; }
                        else { 
                            const diff = minutosTurno - ahoraMinutos;
                            if (diff < 30) { estado = `LEJOS (${Math.round(distancia/1000)}km)`; color = "red"; }
                            else { estado = "LLEGANDO"; color = "yellow"; }
                        }
                    }
                }
            }

            tablero.push({
                hora: hora,
                bus: numBus,
                tabla: nombreTabla || "Sin Asignar", // Valor final
                origen: origen,
                destino: destino,
                estado_bus: estado,
                color_estado: color,
                minutos_para_salir: minutosTurno - ahoraMinutos
            });
        }

        tablero.sort((a, b) => a.hora.localeCompare(b.hora));

        res.json({ 
            actualizado: new Date().toLocaleTimeString('es-CO', {timeZone: 'America/Bogota'}), 
            turnos: tablero 
        });

    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
}