import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged,
  updateProfile,
  signInAnonymously,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDocs, 
  getDoc,
  setDoc, 
  deleteDoc, 
  writeBatch, 
  onSnapshot
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { Task, Developer, Robot, Sprint, WorkflowPhase, DocumentConfig, DevOpsConfig, User } from '../types';
import { StorageService } from './storageService';

// Initialize Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Auth
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account'
});

// Initialize Firestore with configured database ID
export const db = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

// Helper to check if current target user is a guest / local demo user
const isGuestUserId = (userId?: string): boolean => {
  if (!userId) return !auth.currentUser;
  return userId.startsWith('guest-') || !auth.currentUser;
};

// Helper to sanitize payload for Firestore (removes undefined values which cause Firestore errors)
const cleanForFirestore = (obj: any): any => {
  if (obj === undefined) return null;
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(cleanForFirestore);
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      cleaned[key] = cleanForFirestore(value);
    }
  }
  return cleaned;
};

// Authentication Helpers
export const FirebaseService = {
  // Login with Google Popup
  loginWithGoogle: async (): Promise<User> => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const fbUser = result.user;
      const user: User = {
        id: fbUser.uid,
        name: fbUser.displayName || fbUser.email?.split('@')[0] || 'Usuário',
        email: fbUser.email || '',
        avatar: fbUser.photoURL || undefined
      };
      
      // Save/update profile in Firestore
      try {
        await setDoc(doc(db, 'users', fbUser.uid), {
          id: user.id,
          name: user.name,
          email: user.email,
          avatar: user.avatar || '',
          lastLoginAt: new Date().toISOString()
        }, { merge: true });
      } catch (err) {
        console.warn('Could not sync user profile to Firestore:', err);
      }
      
      return user;
    } catch (error: any) {
      console.error('Google sign-in error:', error);
      throw error;
    }
  },

  // Login with Email & Password
  loginWithEmail: async (email: string, pass: string): Promise<User> => {
    const result = await signInWithEmailAndPassword(auth, email, pass);
    const fbUser = result.user;
    
    // Fetch profile if exists
    let name = fbUser.displayName || email.split('@')[0];
    let avatar = fbUser.photoURL || undefined;
    try {
      const userDoc = await getDoc(doc(db, 'users', fbUser.uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        if (data.name) name = data.name;
        if (data.avatar) avatar = data.avatar;
      }
    } catch (e) {
      console.warn('Error fetching user document:', e);
    }

    return {
      id: fbUser.uid,
      name,
      email: fbUser.email || email,
      avatar
    };
  },

  // Register with Email & Password
  registerWithEmail: async (email: string, pass: string, name: string): Promise<User> => {
    const result = await createUserWithEmailAndPassword(auth, email, pass);
    const fbUser = result.user;

    // Update Auth displayName
    try {
      await updateProfile(fbUser, { displayName: name });
    } catch (e) {
      console.warn('Could not update Auth displayName:', e);
    }

    const user: User = {
      id: fbUser.uid,
      name,
      email,
      avatar: undefined
    };

    // Save to Firestore
    try {
      await setDoc(doc(db, 'users', fbUser.uid), {
        id: fbUser.uid,
        name,
        email,
        createdAt: new Date().toISOString()
      });
    } catch (e) {
      console.warn('Could not save user document in Firestore:', e);
    }

    return user;
  },

  // Guest / Anonymous fallback
  loginAsGuest: async (): Promise<User> => {
    const result = await signInAnonymously(auth);
    return {
      id: result.user.uid,
      name: 'Visitante',
      email: 'convidado@nexus.app'
    };
  },

  // Sign out
  logout: async () => {
    await signOut(auth);
  },

  // Auth state listener
  onAuthChange: (callback: (user: User | null) => void) => {
    return onAuthStateChanged(auth, async (fbUser: FirebaseUser | null) => {
      if (fbUser) {
        let name = fbUser.displayName || fbUser.email?.split('@')[0] || 'Usuário';
        let avatar = fbUser.photoURL || undefined;
        try {
          const userDoc = await getDoc(doc(db, 'users', fbUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data();
            if (data.name) name = data.name;
            if (data.avatar) avatar = data.avatar;
          }
        } catch {}

        callback({
          id: fbUser.uid,
          name,
          email: fbUser.email || '',
          avatar
        });
      } else {
        callback(null);
      }
    });
  },

  // --- Real-time Firestore Sync & Persistence ---

  // Helper to resolve collection reference (user-scoped or global fallback)
  getTargetCol: (colName: string, userId?: string) => {
    const uid = userId || auth.currentUser?.uid;
    if (uid) {
      return collection(db, 'users', uid, colName);
    }
    return collection(db, colName);
  },

  getTargetDoc: (colName: string, docId: string, userId?: string) => {
    const uid = userId || auth.currentUser?.uid;
    const safeDocId = String(docId || 'doc').replace(/\//g, '_').trim();
    if (uid) {
      return doc(db, 'users', uid, colName, safeDocId);
    }
    return doc(db, colName, safeDocId);
  },

  // Migrate legacy top-level tasks to user collection if existing admin
  migrateLegacyDataIfNeeded: async (user: User) => {
    try {
      if (!user || !user.id) return;
      const userTasksCol = collection(db, 'users', user.id, 'tasks');
      const userSnap = await getDocs(userTasksCol);
      if (userSnap.empty && user.email === 'pauloo201113@gmail.com') {
        const topSnap = await getDocs(collection(db, 'tasks'));
        if (!topSnap.empty) {
          const batch = writeBatch(db);
          topSnap.forEach(d => {
            batch.set(doc(db, 'users', user.id, 'tasks', d.id), d.data());
          });
          await batch.commit();
          console.log(`[FirebaseService] Migrados ${topSnap.size} registros legados para o usuário.`);
        }
      }
    } catch (e) {
      console.warn('[FirebaseService] Migration notice:', e);
    }
  },

  // Subscribe to real-time Tasks directly from Firestore
  subscribeTasks: (onTasks: (tasks: Task[]) => void, userId?: string) => {
    if (isGuestUserId(userId)) {
      // Local guest mode operates purely in local storage; emit local tasks immediately
      setTimeout(() => {
        try {
          onTasks(StorageService.getTasks());
        } catch (e) {
          console.warn('Guest tasks emission notice:', e);
        }
      }, 0);
      return () => {};
    }
    const colRef = FirebaseService.getTargetCol('tasks', userId);
    return onSnapshot(colRef, (snapshot) => {
      const tasks: Task[] = [];
      snapshot.forEach(docSnap => {
        tasks.push(docSnap.data() as Task);
      });
      onTasks(tasks);
    }, (error) => {
      console.warn('Firestore tasks subscription notice:', error);
    });
  },

  // Save/Update a single task directly in Firestore
  saveTask: async (task: Task, userId?: string) => {
    if (isGuestUserId(userId)) return;
    try {
      const docRef = FirebaseService.getTargetDoc('tasks', task.id, userId);
      const data = cleanForFirestore({
        ...task,
        updatedAt: new Date().toISOString()
      });
      await setDoc(docRef, data, { merge: true });
    } catch (error) {
      console.warn('Error saving task to Firestore:', error);
    }
  },

  // Batch save multiple tasks directly in Firestore
  saveTasksBatch: async (tasks: Task[], userId?: string) => {
    if (isGuestUserId(userId)) return;
    try {
      const batchSize = 400;
      for (let i = 0; i < tasks.length; i += batchSize) {
        const slice = tasks.slice(i, i + batchSize);
        const batch = writeBatch(db);
        slice.forEach(t => {
          const ref = FirebaseService.getTargetDoc('tasks', t.id, userId);
          const data = cleanForFirestore({
            ...t,
            updatedAt: new Date().toISOString()
          });
          batch.set(ref, data, { merge: true });
        });
        await batch.commit();
      }
    } catch (error) {
      console.warn('Error saving tasks batch to Firestore:', error);
    }
  },

  // Delete a task directly from Firestore
  deleteTask: async (taskId: string, userId?: string) => {
    if (isGuestUserId(userId)) return;
    try {
      const docRef = FirebaseService.getTargetDoc('tasks', taskId, userId);
      await deleteDoc(docRef);
    } catch (error) {
      console.warn('Error deleting task from Firestore:', error);
    }
  },

  // Delete all tasks for user
  deleteAllTasks: async (userId?: string) => {
    if (isGuestUserId(userId)) return;
    try {
      const colRef = FirebaseService.getTargetCol('tasks', userId);
      const snap = await getDocs(colRef);
      const batch = writeBatch(db);
      snap.forEach(d => batch.delete(d.ref));
      await batch.commit();
    } catch (error) {
      console.warn('Error deleting all tasks:', error);
    }
  },

  // Fetch all tasks once directly from Firestore
  fetchTasks: async (userId?: string): Promise<Task[]> => {
    if (isGuestUserId(userId)) return [];
    try {
      const snap = await getDocs(FirebaseService.getTargetCol('tasks', userId));
      const tasks: Task[] = [];
      snap.forEach(d => tasks.push(d.data() as Task));
      return tasks;
    } catch (e) {
      console.warn('Could not fetch tasks from Firestore:', e);
      return [];
    }
  },

  // Devs sync directly with Firestore
  subscribeDevs: (onDevs: (devs: Developer[]) => void, userId?: string) => {
    if (isGuestUserId(userId)) {
      setTimeout(() => {
        try {
          onDevs(StorageService.getDevs());
        } catch (e) {
          console.warn('Guest devs emission notice:', e);
        }
      }, 0);
      return () => {};
    }
    const colRef = FirebaseService.getTargetCol('devs', userId);
    return onSnapshot(colRef, snap => {
      const devs: Developer[] = [];
      snap.forEach(d => devs.push(d.data() as Developer));
      onDevs(devs);
    }, (err) => console.warn('Devs snapshot notice:', err));
  },

  saveDevs: async (devs: Developer[], userId?: string) => {
    if (isGuestUserId(userId)) return;
    try {
      const batch = writeBatch(db);
      devs.forEach(d => {
        const ref = FirebaseService.getTargetDoc('devs', d.id, userId);
        batch.set(ref, cleanForFirestore(d), { merge: true });
      });
      await batch.commit();
    } catch (e) {
      console.warn('Error saving devs to Firestore:', e);
    }
  },

  // Robots sync directly with Firestore
  subscribeRobots: (onRobots: (robots: Robot[]) => void, userId?: string) => {
    if (isGuestUserId(userId)) {
      setTimeout(() => {
        try {
          onRobots(StorageService.getRobots());
        } catch (e) {
          console.warn('Guest robots emission notice:', e);
        }
      }, 0);
      return () => {};
    }
    const colRef = FirebaseService.getTargetCol('robots', userId);
    return onSnapshot(colRef, snap => {
      const robots: Robot[] = [];
      snap.forEach(d => robots.push(d.data() as Robot));
      onRobots(robots);
    }, (err) => console.warn('Robots snapshot notice:', err));
  },

  saveRobots: async (robots: Robot[], userId?: string) => {
    if (isGuestUserId(userId)) return;
    try {
      const batch = writeBatch(db);
      robots.forEach(r => {
        const ref = FirebaseService.getTargetDoc('robots', r.id, userId);
        batch.set(ref, cleanForFirestore(r), { merge: true });
      });
      await batch.commit();
    } catch (e) {
      console.warn('Error saving robots to Firestore:', e);
    }
  },

  // Sprints sync directly with Firestore
  subscribeSprints: (onSprints: (sprints: Sprint[]) => void, userId?: string) => {
    if (isGuestUserId(userId)) {
      setTimeout(() => {
        try {
          onSprints(StorageService.getSprints());
        } catch (e) {
          console.warn('Guest sprints emission notice:', e);
        }
      }, 0);
      return () => {};
    }
    const colRef = FirebaseService.getTargetCol('sprints', userId);
    return onSnapshot(colRef, snap => {
      const sprints: Sprint[] = [];
      snap.forEach(d => sprints.push(d.data() as Sprint));
      onSprints(sprints);
    }, (err) => console.warn('Sprints snapshot notice:', err));
  },

  saveSprints: async (sprints: Sprint[], userId?: string) => {
    if (isGuestUserId(userId)) return;
    try {
      const batch = writeBatch(db);
      sprints.forEach(s => {
        const ref = FirebaseService.getTargetDoc('sprints', s.id, userId);
        batch.set(ref, cleanForFirestore(s), { merge: true });
      });
      await batch.commit();
    } catch (e) {
      console.warn('Error saving sprints to Firestore:', e);
    }
  },

  // Workflow & Pipeline Settings directly in Firestore
  saveSetting: async (key: string, value: any, userId?: string) => {
    if (isGuestUserId(userId)) return;
    try {
      const docRef = FirebaseService.getTargetDoc('settings', key, userId);
      await setDoc(docRef, cleanForFirestore({ value, updatedAt: new Date().toISOString() }));
    } catch (e) {
      console.warn(`Error saving setting ${key}:`, e);
    }
  },

  getSetting: async <T>(key: string, fallback: T, userId?: string): Promise<T> => {
    if (isGuestUserId(userId)) return fallback;
    try {
      const docRef = FirebaseService.getTargetDoc('settings', key, userId);
      const snap = await getDoc(docRef);
      if (snap.exists() && snap.data()?.value !== undefined) {
        return snap.data().value as T;
      }
    } catch (e) {
      console.warn(`Error getting setting ${key}:`, e);
    }
    return fallback;
  },

  // Cloud Backups stored directly in Firestore
  saveCloudBackup: async (backupData: any, reason: string, userId?: string) => {
    if (isGuestUserId(userId)) return null;
    try {
      const backupId = `bkp_${Date.now()}`;
      const docRef = FirebaseService.getTargetDoc('backups', backupId, userId);
      const payload = cleanForFirestore({
        id: backupId,
        timestamp: new Date().toISOString(),
        reason,
        data: cleanForFirestore(backupData)
      });
      await setDoc(docRef, payload);
      return backupId;
    } catch (e) {
      console.warn('Could not save cloud backup to Firestore:', e);
      return null;
    }
  },

  getCloudBackupsList: async (userId?: string) => {
    try {
      const snap = await getDocs(FirebaseService.getTargetCol('backups', userId));
      const list: Array<{ id: string, timestamp: string, reason: string }> = [];
      snap.forEach(d => {
        const item = d.data();
        list.push({ id: item.id || d.id, timestamp: item.timestamp, reason: item.reason });
      });
      return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (e) {
      console.warn('Could not fetch cloud backups list:', e);
      return [];
    }
  },

  restoreCloudBackup: async (backupId: string, userId?: string) => {
    try {
      const docRef = FirebaseService.getTargetDoc('backups', backupId, userId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return snap.data()?.data || null;
      }
    } catch (e) {
      console.error('Error restoring cloud backup:', e);
    }
    return null;
  },

  // Completely wipe all user data in Firestore
  resetAllUserData: async (userId?: string) => {
    try {
      const collectionsToWipe = ['tasks', 'devs', 'robots', 'sprints', 'settings'];
      for (const colName of collectionsToWipe) {
        const colRef = FirebaseService.getTargetCol(colName, userId);
        const snap = await getDocs(colRef);
        if (!snap.empty) {
          const batch = writeBatch(db);
          snap.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      }

      // Also clean up top-level collections if admin user
      const currentUid = userId || auth.currentUser?.uid;
      if (currentUid) {
        const userDoc = await getDoc(doc(db, 'users', currentUid));
        const email = userDoc.exists() ? userDoc.data().email : '';
        if (email === 'pauloo201113@gmail.com') {
          for (const colName of ['tasks', 'devs', 'robots', 'sprints']) {
            const topSnap = await getDocs(collection(db, colName));
            if (!topSnap.empty) {
              const batch = writeBatch(db);
              topSnap.forEach(d => batch.delete(d.ref));
              await batch.commit();
            }
          }
        }
      }
      return true;
    } catch (error) {
      console.error('Error wiping all data in Firestore:', error);
      throw error;
    }
  }
};
