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
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  writeBatch,
  serverTimestamp,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export { firebaseConfig };

const isPlaceholderOrEmpty = (val?: string | null): boolean => {
  const trimmed = String(val || '').trim();
  return !trimmed || trimmed.toLowerCase().includes('secret value');
};

const missingKeys = (['apiKey', 'authDomain', 'projectId', 'appId'] as const).filter((key) =>
  isPlaceholderOrEmpty(firebaseConfig[key])
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

const rawDbId = String(firebaseConfig.firestoreDatabaseId || '').trim();
const useDefaultDatabase =
  !rawDbId || rawDbId === '(default)' || rawDbId.toLowerCase().includes('secret value');

// Initialize Firestore directly from firebase-applet-config.json; use default DB if empty or "(default)"
export const db = useDefaultDatabase ? getFirestore(app) : getFirestore(app, rawDbId);

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
    const rawCode =
      typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : '';
    const rawMessage =
      typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : String(error);

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
        // Fall through
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

  const message =
    typeof error === 'string' && error.trim() ? error : 'Erro desconhecido no Firebase.';
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

export async function testFirestoreConnection(): Promise<{
  ok: boolean;
  quotaExceeded?: boolean;
  upgradeUrl?: string;
}> {
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
      const dbSegment = useDefaultDatabase ? '(default)' : rawDbId;
      return {
        ok: false,
        quotaExceeded: true,
        upgradeUrl: `https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/${dbSegment}/data?openUpgradeDialog=true`,
      };
    }
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
    await setPersistence(auth, browserLocalPersistence);
  } catch {
    // Non-fatal in restricted browsers
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
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  runTransaction,
  writeBatch,
  serverTimestamp,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
};
export type { FirebaseUser };
