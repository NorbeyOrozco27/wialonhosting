import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://tu-proyecto.supabase.co';
const supabaseKey = 'TU_SERVICE_ROLE_KEY';

export const supabaseA = createClient(supabaseUrl, supabaseKey);