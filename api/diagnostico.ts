// api/diagnostico.ts
import axios from 'axios';

export default async function handler(req: any, res: any) {
  const token = process.env.WIALON_TOKEN;
  if (!token) return res.json({ error: "Falta token" });

  try {
    const login = await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=token/login&params={"token":"${token}"}`);
    const sid = login.data.eid;

    // BUSCAR GRUPOS DE UNIDADES (avl_unit_group)
    const search = await axios.get(
      `https://hst-api.wialon.com/wialon/ajax.html?svc=core/search_items&params={"spec":{"itemsType":"avl_unit_group","propName":"sys_name","propValueMask":"*","sortType":"sys_name"},"force":1,"flags":1,"from":0,"to":0}&sid=${sid}`
    );

    await axios.get(`https://hst-api.wialon.com/wialon/ajax.html?svc=core/logout&params={}&sid=${sid}`);

    const grupos = search.data.items || [];
    
    res.status(200).json({
      mensaje: "Estos son tus grupos de unidades. Copia el ID del grupo que contiene toda tu flota.",
      grupos_encontrados: grupos.map((g: any) => ({
        ID_PARA_COPIAR: g.id,
        NOMBRE_GRUPO: g.nm,
        clase: g.cls
      }))
    });

  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}