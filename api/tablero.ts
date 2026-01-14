import { supabaseA } from '../lib/supabase';
import axios from 'axios';
import { obtenerCoordenadas, calcularDistancia } from '../lib/config';

// Función auxiliar para traer GPS en tiempo real
async function obtenerPosicionesWialon(token: string) {
    try {
        const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
        const sid = login.data.eid;
        
        // Flag 1025 = Base + Última Posición
        const search = await axios.get(
            `https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_items&params={"spec":{"itemsType":"avl_unit","propName":"sys_name","propValueMask":"*","sortType":"sys_name"},"force":1,"flags":1025,"from":0,"to":0}&sid=${sid}`
        );
        
        await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);
        
        // Mapa: "143" -> { lat: 6.0, lon: -75.0 }
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
        console.error("Error Wialon:", e);
        return new Map();
    }
}

export default async function handler(req: any, res: any) {
    try {
        const hoy = new Date();
        const hoyStr = hoy.toLocaleDateString('en-CA', {timeZone: 'America/Bogota'});
        
        // 1. Obtener Plan de Supabase (Turnos de hoy)
        const { data: plan } = await supabaseA
            .from('operacion_diaria')
            .select('vehiculo_id, horario_id')
            .eq('fecha', hoyStr);

        const { data: vehiculos } = await supabaseA.from('Vehículos').select('id, numero_interno');
        const { data: horarios } = await supabaseA.from('Horarios').select('id, hora, origen, destino').order('hora');

        if (!plan || !vehiculos || !horarios) return res.json({ error: "Error leyendo Supabase", turnos: [] });

        // 2. Obtener Posiciones GPS
        const posiciones = await obtenerPosicionesWialon(process.env.WIALON_TOKEN || "");

        // 3. Cruzar Información
        const tablero = [];
        const ahoraCol = new Date(new Date().toLocaleString("en-US", {timeZone: "America/Bogota"}));
        const ahoraMinutos = ahoraCol.getHours() * 60 + ahoraCol.getMinutes();

        for (const turno of plan) {
            const hInfo = horarios.find(h => h.id === turno.horario_id);
            const vInfo = vehiculos.find(v => v.id === turno.vehiculo_id);

            if (!hInfo || !vInfo) continue;

            const [h, m] = hInfo.hora.split(':').map(Number);
            const minutosTurno = h * 60 + m;

            // Filtro: Solo mostrar turnos relevantes (ej: desde hace 1h hasta dentro de 3h)
            if (minutosTurno < (ahoraMinutos - 60) || minutosTurno > (ahoraMinutos + 180)) continue;

            const numBus = String(vInfo.numero_interno);
            const pos = posiciones.get(numBus);
            
            let estado = "SIN SEÑAL";
            let color = "gray"; // gray, red, green, blue
            let distancia = -1;

            if (pos) {
                // Verificar si está en la terminal de ORIGEN
                const origenCoords = obtenerCoordenadas(hInfo.origen);
                
                if (origenCoords) {
                    distancia = Math.round(calcularDistancia(pos.lat, pos.lon, origenCoords.lat, origenCoords.lon));
                    
                    if (distancia < 1500) { // Tolerancia 1.5km
                        estado = "EN TERMINAL";
                        
                        // Lógica de semáforo
                        const diff = minutosTurno - ahoraMinutos;
                        if (diff < 0) { // Ya debió salir
                            estado = "RETRASADO EN SALIDA";
                            color = "red";
                        } else if (diff < 15) {
                            estado = "LISTO PARA SALIR";
                            color = "green";
                        } else {
                            estado = "EN ESPERA";
                            color = "blue";
                        }
                    } else {
                        // Está lejos de la terminal de origen
                        if (minutosTurno < ahoraMinutos) {
                            estado = "EN RUTA";
                            color = "blue";
                        } else {
                            // Faltan pocos minutos para su turno y está lejos -> ALERTA
                            const diff = minutosTurno - ahoraMinutos;
                            if (diff < 30) {
                                estado = `LEJOS (${Math.round(distancia/1000)}km)`;
                                color = "red";
                            } else {
                                estado = "LLEGANDO A TERMINAL";
                                color = "yellow"; // Naranja en UI
                            }
                        }
                    }
                }
            }

            tablero.push({
                hora: hInfo.hora,
                bus: numBus,
                origen: hInfo.origen,
                destino: hInfo.destino,
                estado_bus: estado,
                color_estado: color,
                minutos_para_salir: minutosTurno - ahoraMinutos
            });
        }

        // Ordenar por hora
        tablero.sort((a, b) => a.hora.localeCompare(b.hora));

        res.json({ 
            actualizado: new Date().toLocaleTimeString('es-CO', {timeZone: 'America/Bogota'}), 
            turnos: tablero 
        });

    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
}