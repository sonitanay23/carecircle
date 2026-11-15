/**
 * Role-based permissions. The elder owns the profile; family and caretakers can
 * view everything and propose changes, which the elder approves (unless the
 * elder has turned approval off).
 */
export const ROLES = Object.freeze(['elder', 'family', 'caretaker']);
export const INVITABLE_ROLES = Object.freeze(['family', 'caretaker']);

const MATRIX = {
  'profile:read': ['elder', 'family', 'caretaker'],
  'profile:update': ['elder'],
  'members:read': ['elder', 'family', 'caretaker'],
  'members:manage': ['elder'],
  'changes:read': ['elder', 'family', 'caretaker'],
  'changes:propose': ['elder', 'family', 'caretaker'],
  'changes:review': ['elder'],
  'activity:read': ['elder', 'family', 'caretaker'],
  'medicalId:read': ['elder', 'family', 'caretaker'],
  'medicalId:share': ['elder'],
  // Day-to-day care records: anyone in the circle can log a dose, a reading or a refill.
  'care:read': ['elder', 'family', 'caretaker'],
  'care:record': ['elder', 'family', 'caretaker'],
};

export function can(role, permission) {
  return MATRIX[permission]?.includes(role) ?? false;
}
