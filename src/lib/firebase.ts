import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  browserLocalPersistence,
  setPersistence,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export { firebaseConfig };

const missingKeys = (['apiKey', 'authDomain', 'projectId', 'appId'] as const).filter(
  (key) => !String(firebaseConfig[key] || '').trim()
);

export const firebaseConfigError: { code: string; message: string; formatted: string } | null =
  missingKeys.length > 0
    ? {
        code: 'firebase/missing-config',
        message: `Configuração Firebase incompleta (${missingKeys.join(', ')}) em firebase-applet-config.json.`,
        formatted: `firebase/missing-config: Configuração Firebase incompleta (${missingKeys.join(', ')}) em firebase-applet-config.json.`,
      }
    : null;

export const app: FirebaseApp =
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

// CRITICAL: Use the provisioned database ID directly from firebase-applet-config.json
export const db = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export interface ParsedFirebaseError {
  code: string;
  message: string;
  formatted: string;
}

export function formatFirebaseError(error: unknown): ParsedFirebaseError {
  if (error && typeof error === 'object') {
    const rawCode = typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : '';
    const rawMessage = typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : String(error);

    // Unwrap structured JSON thrown by handleFirestoreError if present
    if (!rawCode && rawMessage.startsWith('{') && rawMessage.includes('"operationType"')) {
      try {
        const parsed = JSON.parse(rawMessage) as Partial<FirestoreErrorInfo>;
        const innerMsg = parsed.error || rawMessage;
        const innerCode = innerMsg.toLowerCase().includes('permission')
          ? 'firestore/permission-denied'
          : `firestore/${parsed.operationType || 'error'}`;
        return {
          code: innerCode,
          message: innerMsg,
          formatted: `${innerCode}: ${innerMsg}`,
        };
      } catch {
        // Fall through to standard formatting
      }
    }

    const code = rawCode || 'firebase/unknown-error';
    const message = rawMessage || 'Erro desconhecido ao comunicar com o Firebase.';
    return {
      code,
      message,
      formatted: rawCode ? `${rawCode}: ${message}` : message,
    };
  }

  const message = typeof error === 'string' && error.trim() ? error : 'Erro desconhecido no Firebase.';
  return {
    code: 'firebase/unknown-error',
    message,
    formatted: message,
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<{ ok: boolean; quotaExceeded?: boolean; upgradeUrl?: string }> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { ok: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('the client is offline')) {
      console.error('Please check your Firebase configuration: client is offline.');
      return { ok: false };
    }
    if (msg.includes('Quota exceeded')) {
      return {
        ok: false,
        quotaExceeded: true,
        upgradeUrl: `https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/${firebaseConfig.firestoreDatabaseId || '(default)'}/data?openUpgradeDialog=true`,
      };
    }
    // Missing or insufficient permissions confirms active connectivity to Firestore server rules
    return { ok: true };
  }
}

export async function signInWithGooglePopup(): Promise<FirebaseUser> {
  if (firebaseConfigError) {
    const err = new Error(firebaseConfigError.message) as Error & { code?: string };
    err.code = firebaseConfigError.code;
    throw err;
  }

  try {
    // Prefer localStorage/IndexedDB persistence to prevent cross-domain cookie issues on Vercel
    await setPersistence(auth, browserLocalPersistence);
  } catch {
    // Non-fatal if browser restricts persistence mode
  }

  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export async function signOutFirebase(): Promise<void> {
  await firebaseSignOut(auth);
}

export {
  onAuthStateChanged,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
};
export type { FirebaseUser };
