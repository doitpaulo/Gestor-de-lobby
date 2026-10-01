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

  // Subscribe to real-time Tasks
  subscribeTasks: (onTasks: (tasks: Task[]) => void) => {
    const colRef = collection(db, 'tasks');
    return onSnapshot(colRef, (snapshot) => {
      const tasks: Task[] = [];
      snapshot.forEach(docSnap => {
        tasks.push(docSnap.data() as Task);
      });
      onTasks(tasks);
    }, (error) => {
      console.warn('Firestore tasks subscription error:', error);
    });
  },

  // Save/Update a single task
  saveTask: async (task: Task) => {
    try {
      await setDoc(doc(db, 'tasks', task.id), {
        ...task,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (error) {
      console.error('Error saving task to Firestore:', error);
      throw error;
    }
  },

  // Batch save multiple tasks (e.g. from Excel upload or merge)
  saveTasksBatch: async (tasks: Task[]) => {
    try {
      // Firestore batches support up to 500 writes
      const batchSize = 400;
      for (let i = 0; i < tasks.length; i += batchSize) {
        const slice = tasks.slice(i, i + batchSize);
        const batch = writeBatch(db);
        slice.forEach(t => {
          const ref = doc(db, 'tasks', t.id);
          batch.set(ref, {
            ...t,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        });
        await batch.commit();
      }
    } catch (error) {
      console.error('Error saving tasks batch to Firestore:', error);
    }
  },

  // Delete a task
  deleteTask: async (taskId: string) => {
    try {
      await deleteDoc(doc(db, 'tasks', taskId));
    } catch (error) {
      console.error('Error deleting task from Firestore:', error);
      throw error;
    }
  },

  // Fetch all tasks once
  fetchTasks: async (): Promise<Task[]> => {
    try {
      const snap = await getDocs(collection(db, 'tasks'));
      const tasks: Task[] = [];
      snap.forEach(d => tasks.push(d.data() as Task));
      return tasks;
    } catch (e) {
      console.warn('Could not fetch tasks from Firestore:', e);
      return [];
    }
  },

  // Devs sync
  subscribeDevs: (onDevs: (devs: Developer[]) => void) => {
    return onSnapshot(collection(db, 'devs'), snap => {
      const devs: Developer[] = [];
      snap.forEach(d => devs.push(d.data() as Developer));
      if (devs.length > 0) onDevs(devs);
    }, (err) => console.warn('Devs snapshot error:', err));
  },

  saveDevs: async (devs: Developer[]) => {
    try {
      const batch = writeBatch(db);
      devs.forEach(d => {
        batch.set(doc(db, 'devs', d.id), d, { merge: true });
      });
      await batch.commit();
    } catch (e) {
      console.warn('Error saving devs to Firestore:', e);
    }
  },

  // Robots sync
  subscribeRobots: (onRobots: (robots: Robot[]) => void) => {
    return onSnapshot(collection(db, 'robots'), snap => {
      const robots: Robot[] = [];
      snap.forEach(d => robots.push(d.data() as Robot));
      onRobots(robots);
    }, (err) => console.warn('Robots snapshot error:', err));
  },

  saveRobots: async (robots: Robot[]) => {
    try {
      const batch = writeBatch(db);
      robots.forEach(r => {
        batch.set(doc(db, 'robots', r.id), r, { merge: true });
      });
      await batch.commit();
    } catch (e) {
      console.warn('Error saving robots to Firestore:', e);
    }
  },

  // Sprints sync
  subscribeSprints: (onSprints: (sprints: Sprint[]) => void) => {
    return onSnapshot(collection(db, 'sprints'), snap => {
      const sprints: Sprint[] = [];
      snap.forEach(d => sprints.push(d.data() as Sprint));
      onSprints(sprints);
    }, (err) => console.warn('Sprints snapshot error:', err));
  },

  saveSprints: async (sprints: Sprint[]) => {
    try {
      const batch = writeBatch(db);
      sprints.forEach(s => {
        batch.set(doc(db, 'sprints', s.id), s, { merge: true });
      });
      await batch.commit();
    } catch (e) {
      console.warn('Error saving sprints to Firestore:', e);
    }
  },

  // Workflow & Pipeline Settings
  saveSetting: async (key: string, value: any) => {
    try {
      await setDoc(doc(db, 'settings', key), { value, updatedAt: new Date().toISOString() });
    } catch (e) {
      console.warn(`Error saving setting ${key}:`, e);
    }
  },

  getSetting: async <T>(key: string, fallback: T): Promise<T> => {
    try {
      const snap = await getDoc(doc(db, 'settings', key));
      if (snap.exists() && snap.data()?.value !== undefined) {
        return snap.data().value as T;
      }
    } catch (e) {
      console.warn(`Error getting setting ${key}:`, e);
    }
    return fallback;
  },

  // Cloud Backups stored directly in Firestore
  saveCloudBackup: async (backupData: any, reason: string) => {
    try {
      const backupId = `bkp_${Date.now()}`;
      await setDoc(doc(db, 'backups', backupId), {
        id: backupId,
        timestamp: new Date().toISOString(),
        reason,
        data: backupData
      });
      return backupId;
    } catch (e) {
      console.warn('Could not save cloud backup to Firestore:', e);
      return null;
    }
  },

  getCloudBackupsList: async () => {
    try {
      const snap = await getDocs(collection(db, 'backups'));
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

  restoreCloudBackup: async (backupId: string) => {
    try {
      const snap = await getDoc(doc(db, 'backups', backupId));
      if (snap.exists()) {
        return snap.data()?.data || null;
      }
    } catch (e) {
      console.error('Error restoring cloud backup:', e);
    }
    return null;
  }
};
