import type { ProfilePatch, ProfileRepository } from '../domain/Profile.js';
import { AppError } from '../../../shared/errors/AppError.js';
import { getSupabase } from '../../../platform/supabase/client.js';
import { mapProfile } from '../../../platform/supabase/mappers.js';

export class SupabaseProfileRepository implements ProfileRepository {
  async getByUserId(userId: string) {
    const { data, error } = await getSupabase().from('profiles').select('*').eq('id', userId).single();
    if (error || !data) throw new AppError('Profile not found', 404, 'PROFILE_NOT_FOUND');
    return mapProfile(data);
  }

  async replace(userId: string, profile: ProfilePatch) {
    const { data, error } = await getSupabase().from('profiles').update({ ...toRow(profile), updated_at: new Date().toISOString() }).eq('id', userId).select('*').single();
    if (error || !data) throw new AppError(error?.message ?? 'Profile update failed', 400, 'PROFILE_UPDATE_FAILED');
    return mapProfile(data);
  }

  async patch(userId: string, profile: ProfilePatch) {
    return this.replace(userId, profile);
  }
}

function toRow(profile: ProfilePatch): Record<string, string | null | undefined> {
  return {
    username: profile.username,
    display_name: profile.displayName,
    avatar_url: profile.avatarUrl,
    bio: profile.bio,
  };
}
