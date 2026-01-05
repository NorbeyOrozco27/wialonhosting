// api/debug-deep.ts
import axios from 'axios';

export default async function handler(req: any, res: any) {
  const token = process.env.WIALON_TOKEN;
  if (!token) return res.status(500).json({ error: "Falta token" });

  try {
    // 1. LOGIN
    const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
    const sid = login.data.eid;

    // 2. INSPECCIONAR EL GRUPO DE UNIDADES
    // Verificamos si el grupo existe y cuántas unidades tiene dentro
    const groupCheck = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_item&params={"id":28865342,"flags":1}&sid=${sid}`
    );
    
    // Si el grupo tiene la propiedad 'u', es un array con los IDs de las unidades
    const unidadesEnGrupo = groupCheck.data.item ? (groupCheck.data.item.u || []) : [];

    // 3. EJECUTAR REPORTE
    // Usamos fecha fija actual o la del servidor
    const now = Math.floor(Date.now() / 1000);
    const from = now - (48 * 3600); // Últimas 48 horas

    const reportParams = {
      reportResourceId: 28775158,
      reportTemplateId: 7, 
      reportObjectId: 28865342, // Grupo Transunidos
      reportObjectSecId: 0,
      interval: { from: from, to: now, flags: 0 },
      remoteExec: 1
    };

    const execRes = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=report/exec_report&params=${JSON.stringify(reportParams)}&sid=${sid}`
    );

    // 4. ESPERAR (POLLING)
    let status = 0;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const sRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/get_report_status&params={}&sid=${sid}`);
      status = parseInt(sRes.data.status);
      if (status === 4) break;
    }

    // 5. OBTENER RESULTADO REAL (TABLAS Y FILAS)
    const applyRes = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=report/apply_report_result&params={}&sid=${sid}`);
    
    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    // 6. ANALIZAR TABLAS
    // CORRECCIÓN AQUÍ: Definimos explícitamente el tipo como any[]
    const tablasEncontradas: any[] = []; 
    
    if (applyRes.data && applyRes.data.tables) {
        applyRes.data.tables.forEach((t: any, index: number) => {
            tablasEncontradas.push({
                INDICE_CORRECTO: index,
                NOMBRE: t.label || t.l,
                TIPO: t.name || t.n,
                FILAS: t.rows,  // Si esto es 0, la tabla está vacía
                COLUMNAS: t.header || t.h
            });
        });
    }

    res.status(200).json({
      grupo_inspeccion: {
        id: 28865342,
        nombre: groupCheck.data.item ? groupCheck.data.item.nm : "NO ENCONTRADO",
        cantidad_unidades: unidadesEnGrupo.length, // IMPORTANTE: ¿Es mayor a 0?
        ids_unidades_muestra: unidadesEnGrupo.slice(0, 5)
      },
      reporte_resultado: {
        filas_totales_reporte: applyRes.data.rows,
        TABLAS: tablasEncontradas // <--- AQUÍ ESTÁ LA RESPUESTA
      }
    });

  } catch (e: any) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
}