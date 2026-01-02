// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

// Esto lee las variables que pusiste en el panel de Vercel
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
    console.error("❌ ERROR: Faltan las variables de Supabase en el entorno.");
}

export const supabaseA = createClient(supabaseUrl, supabaseKey);