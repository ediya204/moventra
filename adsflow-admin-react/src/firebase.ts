import { getApps, initializeApp } from 'firebase/app';
import { initializeAuth, inMemoryPersistence, type Auth } from 'firebase/auth';
import config from './config/firebase.web.json';

// Firebase Web configuration is public project metadata, not an Admin credential.
// Keep this app named to avoid sharing another app's default Auth instance.
const appName = 'moventra-card-bin';
export const firebaseApp = getApps().find((app) => app.name === appName)
  ?? initializeApp(config, appName);

// Memory-only persistence; Go validates identity, membership, and operator MFA.
let auth: Auth | undefined;
export function getFirebaseAuth(): Auth {
  auth ??= initializeAuth(firebaseApp, { persistence: inMemoryPersistence });
  return auth;
}
