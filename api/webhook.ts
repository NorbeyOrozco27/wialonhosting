// api/webhook.ts
import { supabaseA } from '../lib/supabase.js';
import { db } from '../lib/firebase.js';
import { auditarEvento } from '../lib/util.js';

export default async function handler(req: any, res: any) {
    if (req.method !== 'POST') return res.status(405).send('Solo POST');

    // Wialon nos enviará: unit_name (0149), geofence_name (T. ABEJORRAL), event_time
    const { unit_name, geofence_name, event_time } = req.body;

    try {
        // 1. CONSULTA MUNDO A: ¿Qué está haciendo este bus ahora?
        const { data: turno, error } = await supabaseA
            .from('historial_rodamiento_real')
            .select('*')
            .eq('numero_interno', unit_name)
            .order('fecha_rodamiento', { ascending: false })
            .order('hora_turno', { ascending: false })
            .limit(1)
            .single();

        if (!turno) return res.status(200).json({ msg: "Bus sin turno activo" });

        // 2. AUDITORÍA
        const resultado = auditarEvento(turno, geofence_name, event_time);
        if (!resultado) return res.status(200).json({ msg: "Geocerca no auditable" });

        // 3. GUARDAR EN MUNDO B (Firebase)
        // Creamos un ID de viaje único (Bus + Fecha + HoraProg)
        const viajeId = `${unit_name}_${turno.fecha_rodamiento}_${turno.hora_turno.replace(':', '')}`;

        await db.collection('auditoria_viajes').doc(viajeId).collection('checkpoints').add({
            ...resultado,
            hora_gps: event_time,
            creado_el: new Date()
        });

        return res.status(200).json({ success: true, viajeId });

    } catch (e: any) {
        return res.status(500).json({ error: e.message });
    }
}