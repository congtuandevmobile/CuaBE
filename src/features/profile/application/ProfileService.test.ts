import { describe, expect, it } from 'vitest';
import { ProfileService } from './ProfileService.js';
import type { Profile, ProfilePatch, ProfileRepository } from '../domain/Profile.js';

const profile: Profile = {
  id: 'user-1', username: null, displayName: 'Tuan', avatarUrl: null, bio: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};

function fakeRepository(): ProfileRepository & { lastPatch?: ProfilePatch } {
  return {
    async getByUserId() { return profile; },
    async replace(_userId, patch) { this.lastPatch = patch; return profile; },
    async patch(_userId, patch) { this.lastPatch = patch; return profile; },
  };
}

describe('ProfileService', () => {
  it('delegates partial updates to the repository', async () => {
    const repository = fakeRepository();
    const service = new ProfileService(repository);
    await service.patch('user-1', { displayName: 'Cua' });
    expect(repository.lastPatch).toEqual({ displayName: 'Cua' });
  });
});
