import { createMemoryStore } from './memoryStore.js';

/** Picks the store implementation from config. */
export async function createStore(config) {
  if (config.store === 'firestore') {
    const { createFirestoreStore } = await import('./firestoreStore.js');
    return createFirestoreStore({
      projectId: config.gcpProject,
      databaseId: config.firestoreDatabase,
    });
  }
  return createMemoryStore();
}

/** Collection paths, kept in one place so the data model is easy to see. */
export const paths = {
  profiles: () => 'profiles',
  members: (profileId) => `profiles/${profileId}/members`,
  changes: (profileId) => `profiles/${profileId}/changes`,
  activity: (profileId) => `profiles/${profileId}/activity`,
  medications: (profileId) => `profiles/${profileId}/medications`,
  photos: (profileId) => `profiles/${profileId}/photos`,
  doses: (profileId) => `profiles/${profileId}/doses`,
  appointments: (profileId) => `profiles/${profileId}/appointments`,
  readings: (profileId) => `profiles/${profileId}/readings`,
  aiCache: (profileId) => `profiles/${profileId}/aiCache`,
  notifications: (profileId) => `profiles/${profileId}/notifications`,
  medical: (profileId) => `profiles/${profileId}/medical`,
  medicalIdShares: () => 'medicalIdShares',
};
