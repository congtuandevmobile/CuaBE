import type { Profile, ProfilePatch, ProfileRepository } from '../domain/Profile.js';

export class ProfileService {
  constructor(private readonly profiles: ProfileRepository) {}

  get(userId: string): Promise<Profile> {
    return this.profiles.getByUserId(userId);
  }

  replace(userId: string, profile: ProfilePatch): Promise<Profile> {
    return this.profiles.replace(userId, profile);
  }

  patch(userId: string, profile: ProfilePatch): Promise<Profile> {
    return this.profiles.patch(userId, profile);
  }
}
