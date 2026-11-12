import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getFirestore, type Firestore } from 'firebase/firestore';

const config = {
  apiKey: import.meta.env?.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env?.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

export const firebaseApp: FirebaseApp | null = config.apiKey && config.projectId && config.appId
  ? (getApps().length ? getApp() : initializeApp(config))
  : null;

export const firestore: Firestore | null = firebaseApp ? getFirestore(firebaseApp) : null;
