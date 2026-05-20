import { getSupabase } from '../lib/supabase';

const BUCKET = 'images';

export async function uploadSiteImage(file: File, folder: string): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase не настроен');

  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
