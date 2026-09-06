// Only an authenticated, explicit missing-user response may open registration.
export function needsRegistration(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && 'status' in error && error.status === 403
    && 'code' in error && error.code === 'registration_required';
}
