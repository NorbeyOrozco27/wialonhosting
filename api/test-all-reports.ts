// api/test-all-reports.ts
// Este archivo es solo para verificar que el servidor Vercel responde
export default function handler(req: any, res: any) {
  res.status(200).json({ 
    status: "ok",
    message: "El servidor de auditoría está activo. Usa /api/audit-batch para procesar."
  });
}