import { getApps, initializeApp } from 'firebase/app';
import { initializeAuth, browserSessionPersistence, type Auth } from 'firebase/auth';
import { isAdminSite } from './auth/site';
import config from './config/firebase.web.json';

// Firebase Web configuration is public project metadata, not an Admin credential.
// Keep this app named to avoid sharing another app's default Auth instance.
const appName = isAdminSite ? 'moventra-admin' : 'moventra-client';
export const firebaseApp = getApps().find((app) => app.name === appName)
  ?? initializeApp(config, appName);

// Both sites retain identity across reloads within the current tab.
// Restored identity still requires Go admission, resource permissions, and MFA.
let auth: Auth | undefined;
export function getFirebaseAuth(): Auth {
  auth ??= initializeAuth(firebaseApp, {
    persistence: browserSessionPersistence,
  });
  return auth;
}
