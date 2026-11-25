import type { Profile } from '../../features/profile/domain/Profile.js';

export function mapProfile(row: Record<string, unknown>): Profile {
  return {
    id: String(row.id),
    username: row.username as string | null,
    displayName: row.display_name as string | null,
    avatarUrl: row.avatar_url as string | null,
    bio: row.bio as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
