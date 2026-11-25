export interface Profile {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProfilePatch {
  username?: string | null | undefined;
  displayName?: string | null | undefined;
  avatarUrl?: string | null | undefined;
  bio?: string | null | undefined;
}

export interface ProfileRepository {
  getByUserId(userId: string): Promise<Profile>;
  replace(userId: string, profile: ProfilePatch): Promise<Profile>;
  patch(userId: string, profile: ProfilePatch): Promise<Profile>;
}
