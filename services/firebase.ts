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
  sendEmailVerification,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
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
  onSnapshot,
  arrayUnion,
  arrayRemove,
  deleteField,
  updateDoc,
  query,
  where
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { 
  Task, 
  Developer, 
  Robot, 
  Sprint, 
  WorkflowPhase, 
  DocumentConfig, 
  DevOpsConfig, 
  User, 
  UserRole,
  UserStatus,
  UserPermissions,
  WorkspaceMember,
  AccountRecoveryRequest,
  AccessRequest,
  NEXUS_OWNER_UID,
  sanitizeMemberPermissions
} from '../types';
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
        avatar: fbUser.photoURL || undefined,
        emailVerified: fbUser.emailVerified
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
      avatar,
      emailVerified: fbUser.emailVerified
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
      avatar: undefined,
      emailVerified: fbUser.emailVerified
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
      email: 'convidado@nexus.app',
      emailVerified: false
    };
  },

  // Sign out
  logout: async () => {
    await signOut(auth);
  },

  // Get current Firebase ID Token for authenticated API calls
  getIdToken: async (forceRefresh: boolean = false): Promise<string | null> => {
    if (!auth.currentUser) return null;
    return await auth.currentUser.getIdToken(forceRefresh);
  },

  // Reload current Firebase Auth user (refreshes emailVerified and token state)
  reloadCurrentUser: async (): Promise<User | null> => {
    const fbUser = auth.currentUser;
    if (!fbUser) return null;
    await fbUser.reload();
    await fbUser.getIdToken(true);
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
    return {
      id: fbUser.uid,
      name,
      email: fbUser.email || '',
      avatar,
      emailVerified: fbUser.emailVerified
    };
  },

  // Send Firebase email verification to current email/password user
  sendVerificationEmail: async (): Promise<void> => {
    const fbUser = auth.currentUser;
    if (!fbUser) {
      throw new Error('Usuário não autenticado para envio de verificação.');
    }
    if (fbUser.emailVerified) return;
    await sendEmailVerification(fbUser);
  },

  // Mandatory first-access password change flow (reauthenticate -> updatePassword -> server confirmation)
  changeFirstAccessPassword: async (
    currentTempPassword: string,
    newPassword: string
  ): Promise<{ member: WorkspaceMember }> => {
    const fbUser = auth.currentUser;
    if (!fbUser || !fbUser.email) {
      throw new Error('Sessão expirada. Faça login novamente com seu e-mail e senha temporária.');
    }

    const credential = EmailAuthProvider.credential(fbUser.email, currentTempPassword);
    await reauthenticateWithCredential(fbUser, credential);
    await updatePassword(fbUser, newPassword);

    // Re-authenticate with the new password so auth_time >= tokensValidAfterTime
    // and checkRevoked=true on the server accepts the fresh ID token immediately.
    const refreshedCred = await signInWithEmailAndPassword(auth, fbUser.email, newPassword);
    const freshIdToken = await refreshedCred.user.getIdToken(true);
    const res = await fetch('/api/auth/complete-first-password-change', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${freshIdToken}`
      }
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      throw new Error(
        data?.message ||
          'A nova senha foi salva no Auth, mas houve falha ao confirmar a liberação no servidor. Tente novamente ou contate o administrador.'
      );
    }

    return { member: data.member as WorkspaceMember };
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
          avatar,
          emailVerified: fbUser.emailVerified
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
      if (!user || !user.id || isGuestUserId(user.id) || user.id !== NEXUS_OWNER_UID) return;
      const userTasksCol = collection(db, 'users', user.id, 'tasks');
      const userSnap = await getDocs(userTasksCol);
      if (userSnap.empty && user.id === NEXUS_OWNER_UID) {
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

  // Subscribe to real-time Tasks directly from Firestore (ADM/Owner full workspace scan)
  subscribeTasks: (
    onTasks: (tasks: Task[]) => void,
    userId?: string,
    onError?: (error: any) => void
  ) => {
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
      if (onError) onError(error);
    });
  },

  // Scoped real-time Tasks subscription for approved Collaborators (matches Firestore ABAC rules)
  subscribeAuthorizedTasks: (
    ownerUid: string,
    collaboratorUid: string,
    onTasks: (tasks: Task[]) => void,
    onError?: (error: any) => void
  ) => {
    if (isGuestUserId(ownerUid) || !collaboratorUid) {
      onTasks([]);
      return () => {};
    }

    const colRef = collection(db, 'users', ownerUid, 'tasks');
    const qAssigned = query(colRef, where('assignedUid', '==', collaboratorUid));
    const qAllowed = query(colRef, where('allowedUids', 'array-contains', collaboratorUid));

    const assignedMap = new Map<string, Task>();
    const allowedMap = new Map<string, Task>();
    let assignedReady = false;
    let allowedReady = false;

    const emitMerged = () => {
      if (!assignedReady && !allowedReady) return;
      const merged = new Map<string, Task>();
      assignedMap.forEach((t, id) => merged.set(id, t));
      allowedMap.forEach((t, id) => merged.set(id, t));
      onTasks(Array.from(merged.values()));
    };

    const unsub1 = onSnapshot(
      qAssigned,
      (snap) => {
        assignedMap.clear();
        snap.forEach((d) => {
          const data = d.data() as Task;
          assignedMap.set(data.id || d.id, data);
        });
        assignedReady = true;
        emitMerged();
      },
      (err) => {
        console.warn('Firestore scoped assignedUid tasks subscription error:', err);
        if (onError) onError(err);
      }
    );

    const unsub2 = onSnapshot(
      qAllowed,
      (snap) => {
        allowedMap.clear();
        snap.forEach((d) => {
          const data = d.data() as Task;
          allowedMap.set(data.id || d.id, data);
        });
        allowedReady = true;
        emitMerged();
      },
      (err) => {
        console.warn('Firestore scoped allowedUids tasks subscription error:', err);
        if (onError) onError(err);
      }
    );

    return () => {
      unsub1();
      unsub2();
    };
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
  saveTasksBatch: async (tasks: Task[], userId?: string, reconcileDeletes: boolean = false) => {
    if (isGuestUserId(userId)) return;
    try {
      const colRef = FirebaseService.getTargetCol('tasks', userId);
      
      // If reconciliation is requested, remove docs from Firestore that are not in tasks array
      if (reconcileDeletes) {
        try {
          const existingSnap = await getDocs(colRef);
          const activeIds = new Set(tasks.map(t => String(t.id || '').trim().toLowerCase()));
          const deleteBatch = writeBatch(db);
          let deletedCount = 0;
          existingSnap.forEach(docSnap => {
            const data = docSnap.data() as any;
            const matchesId = activeIds.has(docSnap.id.toLowerCase()) || 
              (data.id && activeIds.has(String(data.id).trim().toLowerCase()));
            if (!matchesId) {
              deleteBatch.delete(docSnap.ref);
              deletedCount++;
            }
          });
          if (deletedCount > 0) {
            await deleteBatch.commit();
          }
        } catch (e) {
          console.warn('Reconciliation delete error in saveTasksBatch:', e);
        }
      }

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

  // Record deleted task ID to persistent Firestore deleted registry
  recordDeletedTaskId: async (taskId: string, userId?: string) => {
    if (isGuestUserId(userId) || !taskId) return;
    try {
      const cleanId = String(taskId).trim();
      const docRef = FirebaseService.getTargetDoc('settings', 'deleted_tasks', userId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        await updateDoc(docRef, {
          ids: arrayUnion(cleanId),
          updatedAt: new Date().toISOString()
        });
      } else {
        await setDoc(docRef, {
          ids: [cleanId],
          updatedAt: new Date().toISOString()
        });
      }
    } catch (e) {
      console.warn('Error recording deletedTaskId in Firestore:', e);
    }
  },

  // Fetch list of deleted task IDs from Firestore
  getDeletedTaskIds: async (userId?: string): Promise<string[]> => {
    if (isGuestUserId(userId)) return [];
    try {
      const docRef = FirebaseService.getTargetDoc('settings', 'deleted_tasks', userId);
      const snap = await getDoc(docRef);
      if (snap.exists() && Array.isArray(snap.data()?.ids)) {
        return snap.data().ids as string[];
      }
    } catch (e) {
      console.warn('Error fetching deleted task IDs:', e);
    }
    return [];
  },

  // Delete a task directly and completely from Firestore (both user-scoped and global collections)
  deleteTask: async (taskId: string, userId?: string) => {
    if (isGuestUserId(userId) || !taskId) return;
    const cleanId = String(taskId).trim();
    const cleanLower = cleanId.toLowerCase();
    const safeDocId = cleanId.replace(/\//g, '_');
    const uid = userId || auth.currentUser?.uid || StorageService.getCurrentUserId();

    try {
      // 1. Delete from user-scoped collection if uid is available
      if (uid) {
        await deleteDoc(doc(db, 'users', uid, 'tasks', safeDocId)).catch(() => {});
        // Also check if document was stored under a lowercase/original variant
        if (safeDocId !== cleanId) {
          await deleteDoc(doc(db, 'users', uid, 'tasks', cleanId)).catch(() => {});
        }
        
        // Scan collection to ensure no docs with data.id == taskId remain
        try {
          const userTasksCol = collection(db, 'users', uid, 'tasks');
          const snap = await getDocs(userTasksCol);
          const batch = writeBatch(db);
          let found = 0;
          snap.forEach(d => {
            const data = d.data() as any;
            if (d.id.toLowerCase() === cleanLower || String(data.id || '').trim().toLowerCase() === cleanLower) {
              batch.delete(d.ref);
              found++;
            }
          });
          if (found > 0) {
            await batch.commit();
          }
        } catch (scanErr) {
          console.warn('Scan delete in user tasks notice:', scanErr);
        }
      }

      // 2. Delete from top-level /tasks/ collection to prevent legacy migration re-importing it
      await deleteDoc(doc(db, 'tasks', safeDocId)).catch(() => {});
      if (safeDocId !== cleanId) {
        await deleteDoc(doc(db, 'tasks', cleanId)).catch(() => {});
      }
      try {
        const topSnap = await getDocs(collection(db, 'tasks'));
        const topBatch = writeBatch(db);
        let topFound = 0;
        topSnap.forEach(d => {
          const data = d.data() as any;
          if (d.id.toLowerCase() === cleanLower || String(data.id || '').trim().toLowerCase() === cleanLower) {
            topBatch.delete(d.ref);
            topFound++;
          }
        });
        if (topFound > 0) {
          await topBatch.commit();
        }
      } catch (topErr) {
        console.warn('Scan delete in top tasks notice:', topErr);
      }

      // 3. Record in Firestore deleted registry
      await FirebaseService.recordDeletedTaskId(cleanId, uid || undefined);
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
      snap.forEach(d => {
        const data = d.data() as any;
        if (data && (data.name || data.id)) {
          devs.push({
            id: String(data.id || d.id),
            name: String(data.name || d.id).trim(),
            email: data.email ? String(data.email).trim() : undefined,
            linkedUid: data.linkedUid ? String(data.linkedUid).trim() : undefined,
            linkedMemberId: data.linkedMemberId ? String(data.linkedMemberId).trim() : undefined
          });
        }
      });
      onDevs(devs);
    }, (err) => console.warn('Devs snapshot notice:', err));
  },

  deleteDev: async (devId: string, userId?: string) => {
    if (isGuestUserId(userId)) return;
    try {
      const colRef = FirebaseService.getTargetCol('devs', userId);
      const snap = await getDocs(colRef);
      const batch = writeBatch(db);
      let foundMatches = 0;
      const targetClean = String(devId || '').trim().toLowerCase();

      snap.forEach(d => {
        const data = d.data() as any;
        const matchesId = d.id === devId || String(data.id || '').trim().toLowerCase() === targetClean;
        const matchesName = data.name && String(data.name).trim().toLowerCase() === targetClean;
        if (matchesId || matchesName) {
          batch.delete(d.ref);
          foundMatches++;
        }
      });

      if (foundMatches > 0) {
        await batch.commit();
      } else {
        const docRef = FirebaseService.getTargetDoc('devs', devId, userId);
        await deleteDoc(docRef);
      }
    } catch (error) {
      console.warn('Error deleting dev from Firestore:', error);
    }
  },

  saveDevs: async (devs: Developer[], userId?: string) => {
    if (isGuestUserId(userId)) return;
    try {
      const colRef = FirebaseService.getTargetCol('devs', userId);
      const existingSnap = await getDocs(colRef);
      const newDevIds = new Set(devs.map(d => String(d.id || '').trim().toLowerCase()));
      const newDevNames = new Set(devs.map(d => String(d.name || '').trim().toLowerCase()));

      const batch = writeBatch(db);
      // Reconcile: delete documents removed from the devs list
      existingSnap.forEach(docSnap => {
        const data = docSnap.data() as any;
        const matchesId = newDevIds.has(docSnap.id.toLowerCase()) || (data.id && newDevIds.has(String(data.id).trim().toLowerCase()));
        const matchesName = data.name && newDevNames.has(String(data.name).trim().toLowerCase());
        if (!matchesId && !matchesName) {
          batch.delete(docSnap.ref);
        }
      });
      devs.forEach((d, idx) => {
        const safeId = String(d.id || `dev-${Date.now()}-${idx}`).replace(/\//g, '_').trim();
        const ref = FirebaseService.getTargetDoc('devs', safeId, userId);
        batch.set(ref, cleanForFirestore({
          id: safeId,
          name: d.name.trim(),
          email: d.email,
          linkedUid: d.linkedUid,
          linkedMemberId: d.linkedMemberId
        }), { merge: true });
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

  deleteRobot: async (robotId: string, userId?: string) => {
    if (isGuestUserId(userId)) return;
    try {
      const docRef = FirebaseService.getTargetDoc('robots', robotId, userId);
      await deleteDoc(docRef);
    } catch (error) {
      console.warn('Error deleting robot from Firestore:', error);
    }
  },

  saveRobots: async (robots: Robot[], userId?: string) => {
    if (isGuestUserId(userId)) return;
    try {
      const colRef = FirebaseService.getTargetCol('robots', userId);
      const existingSnap = await getDocs(colRef);
      const newRobotIds = new Set(robots.map(r => r.id));

      const batch = writeBatch(db);
      existingSnap.forEach(docSnap => {
        if (!newRobotIds.has(docSnap.id)) {
          batch.delete(docSnap.ref);
        }
      });
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

  deleteSprint: async (sprintId: string, userId?: string) => {
    if (isGuestUserId(userId)) return;
    try {
      const docRef = FirebaseService.getTargetDoc('sprints', sprintId, userId);
      await deleteDoc(docRef);
    } catch (error) {
      console.warn('Error deleting sprint from Firestore:', error);
    }
  },

  saveSprints: async (sprints: Sprint[], userId?: string) => {
    if (isGuestUserId(userId)) return;
    try {
      const colRef = FirebaseService.getTargetCol('sprints', userId);
      const existingSnap = await getDocs(colRef);
      const newSprintIds = new Set(sprints.map(s => s.id));

      const batch = writeBatch(db);
      existingSnap.forEach(docSnap => {
        if (!newSprintIds.has(docSnap.id)) {
          batch.delete(docSnap.ref);
        }
      });
      sprints.forEach(s => {
        const ref = FirebaseService.getTargetDoc('sprints', s.id, userId);
        batch.set(ref, cleanForFirestore(s), { merge: true });
      });
      await batch.commit();
    } catch (e) {
      console.warn('Error saving sprints to Firestore:', e);
    }
  },

  // Atomic batch update for mass sprint modification (patches exclusively sprintId & history)
  updateTasksSprintBatch: async (
    workspaceOwnerUid: string,
    taskPatches: Array<{
      id: string;
      sprintId: string | null;
      historyEntry: any;
    }>,
    targetSprintPatch?: {
      id: string;
      tasks: any[];
    } | null
  ): Promise<void> => {
    if (isGuestUserId(workspaceOwnerUid)) return;
    const nowIso = new Date().toISOString();
    const batch = writeBatch(db);

    taskPatches.forEach(patch => {
      const taskRef = FirebaseService.getTargetDoc('tasks', patch.id, workspaceOwnerUid);
      const payload: Record<string, any> = {
        sprintId: patch.sprintId,
        updatedAt: nowIso
      };
      if (patch.historyEntry) {
        payload.history = arrayUnion(cleanForFirestore(patch.historyEntry));
      }
      batch.set(taskRef, cleanForFirestore(payload), { merge: true });
    });

    if (targetSprintPatch && targetSprintPatch.id) {
      const sprintRef = FirebaseService.getTargetDoc('sprints', targetSprintPatch.id, workspaceOwnerUid);
      batch.set(sprintRef, cleanForFirestore({
        tasks: targetSprintPatch.tasks,
        updatedAt: nowIso
      }), { merge: true });
    }

    await batch.commit();
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
      if (snap.exists()) {
        const data = snap.data();
        if (data?.value !== undefined) {
          return data.value as T;
        }
        return data as unknown as T;
      }
    } catch (e) {
      console.warn(`Error getting setting ${key}:`, e);
    }
    return fallback;
  },

  getSettingWithMeta: async <T>(key: string, userId?: string): Promise<{ value: T; updatedAt?: string } | null> => {
    if (isGuestUserId(userId)) return null;
    try {
      const docRef = FirebaseService.getTargetDoc('settings', key, userId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        if (data?.value !== undefined) {
          return { value: data.value as T, updatedAt: data.updatedAt };
        }
        return { value: data as unknown as T, updatedAt: data?.updatedAt };
      }
    } catch (e) {
      console.warn(`Error getting setting with meta ${key}:`, e);
    }
    return null;
  },

  // Dedicated Azure DevOps Cloud Configuration Persistence
  saveDevOpsConfig: async (config: DevOpsConfig, userId?: string): Promise<boolean> => {
    const uid = userId || auth.currentUser?.uid;
    if (!uid || isGuestUserId(uid)) return false;
    try {
      const cleanConfig = {
        organization: String(config.organization || '').trim(),
        project: String(config.project || '').trim(),
        pat: String(config.pat || '').trim(),
        isActive: Boolean(config.isActive),
        defaultIterationPath: String(config.defaultIterationPath || '').trim()
      };
      const payload = {
        value: cleanConfig,
        ...cleanConfig,
        updatedAt: new Date().toISOString()
      };

      // 1. Save in user settings subcollection
      const userSettingsDocRef = doc(db, 'users', uid, 'settings', 'devops');
      await setDoc(userSettingsDocRef, cleanForFirestore(payload));

      // 2. Also save in user root document for redundancy
      try {
        const userDocRef = doc(db, 'users', uid);
        await setDoc(userDocRef, cleanForFirestore({ devopsConfig: cleanConfig, devops: cleanConfig }), { merge: true });
      } catch (e) {
        console.warn('Could not merge devops into user doc:', e);
      }

      // 3. For owner account, ensure synced under NEXUS_OWNER_UID workspace path
      if (uid === NEXUS_OWNER_UID || auth.currentUser?.uid === NEXUS_OWNER_UID) {
        try {
          const ownerDocRef = doc(db, 'users', NEXUS_OWNER_UID, 'settings', 'devops');
          await setDoc(ownerDocRef, cleanForFirestore(payload));
          const ownerRootRef = doc(db, 'users', NEXUS_OWNER_UID);
          await setDoc(ownerRootRef, cleanForFirestore({ devopsConfig: cleanConfig, devops: cleanConfig }), { merge: true });
        } catch {}
      }

      // 4. Attempt to save to global settings document (if rules permit)
      try {
        const globalDocRef = doc(db, 'settings', 'devops');
        await setDoc(globalDocRef, cleanForFirestore(payload), { merge: true });
      } catch {
        // Ignored if permissions are strictly user-scoped
      }

      return true;
    } catch (e) {
      console.warn('Error saving devops config to Firestore:', e);
      return false;
    }
  },

  getDevOpsConfig: async (userId?: string): Promise<DevOpsConfig | null> => {
    const uid = userId || auth.currentUser?.uid;
    if (!uid || isGuestUserId(uid)) return null;

    const parseDevOps = (raw: any): DevOpsConfig | null => {
      if (!raw || typeof raw !== 'object') return null;
      const target = raw.value && typeof raw.value === 'object' ? raw.value : raw;
      const org = String(target.organization || raw.organization || '').trim();
      const proj = String(target.project || raw.project || '').trim();
      const pat = String(target.pat || raw.pat || '').trim();
      const path = String(target.defaultIterationPath || raw.defaultIterationPath || '').trim();
      const active = target.isActive !== undefined ? Boolean(target.isActive) : (raw.isActive !== undefined ? Boolean(raw.isActive) : false);
      if (org || pat || proj) {
        return {
          organization: org,
          project: proj,
          pat,
          isActive: active,
          defaultIterationPath: path
        };
      }
      return null;
    };

    // 1. Try canonical NEXUS_OWNER_UID workspace path first
    try {
      const ownerRef = doc(db, 'users', NEXUS_OWNER_UID, 'settings', 'devops');
      const snap = await getDoc(ownerRef);
      if (snap.exists()) {
        const parsed = parseDevOps(snap.data());
        if (parsed) return parsed;
      }
    } catch {}

    // 2. Try user settings subcollection
    try {
      const userSettingsDocRef = doc(db, 'users', uid, 'settings', 'devops');
      const snap = await getDoc(userSettingsDocRef);
      if (snap.exists()) {
        const parsed = parseDevOps(snap.data());
        if (parsed) return parsed;
      }
    } catch (e) {
      console.warn('Could not read user devops setting:', e);
    }

    // 3. Try user profile doc
    try {
      const userDocRef = doc(db, 'users', uid);
      const snap = await getDoc(userDocRef);
      if (snap.exists()) {
        const data = snap.data();
        const parsed = parseDevOps(data?.devopsConfig || data?.devops);
        if (parsed) return parsed;
      }
    } catch (e) {
      console.warn('Could not read user profile devops:', e);
    }

    // 4. Try global settings doc
    try {
      const globalDocRef = doc(db, 'settings', 'devops');
      const snap = await getDoc(globalDocRef);
      if (snap.exists()) {
        const parsed = parseDevOps(snap.data());
        if (parsed) return parsed;
      }
    } catch (e) {
      console.warn('Could not read global devops setting:', e);
    }

    return null;
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

  // --- Workspace Members Management (Firestore Real-time & CRUD) ---
  subscribeMembers: (
    ownerUid: string,
    onMembers: (members: WorkspaceMember[]) => void,
    onError?: (error: any) => void
  ) => {
    if (isGuestUserId(ownerUid)) {
      setTimeout(() => {
        try {
          onMembers(StorageService.getMembers());
        } catch {}
      }, 0);
      return () => {};
    }
    const colRef = collection(db, 'users', ownerUid, 'members');
    return onSnapshot(colRef, (snapshot) => {
      const list: WorkspaceMember[] = [];
      snapshot.forEach(docSnap => {
        list.push({ id: docSnap.id, ...(docSnap.data() as WorkspaceMember) });
      });
      onMembers(list);
    }, (error) => {
      console.warn('Firestore members subscription notice:', error);
      if (onError) onError(error);
    });
  },

  fetchMyMemberRecord: async (ownerUid: string, uid: string): Promise<WorkspaceMember | null> => {
    if (isGuestUserId(ownerUid) || !uid) return null;
    const docRef = doc(db, 'users', ownerUid, 'members', uid);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as WorkspaceMember) };
  },

  subscribeMyMemberRecord: (
    ownerUid: string,
    uid: string,
    onMember: (member: WorkspaceMember | null) => void,
    onError?: (error: any) => void
  ) => {
    if (isGuestUserId(ownerUid) || !uid) {
      onMember(null);
      return () => {};
    }
    const docRef = doc(db, 'users', ownerUid, 'members', uid);
    return onSnapshot(
      docRef,
      (snap) => {
        if (!snap.exists()) {
          onMember(null);
        } else {
          onMember({ id: snap.id, ...(snap.data() as WorkspaceMember) });
        }
      },
      (err) => {
        console.warn('Firestore my member record subscription notice:', err);
        if (onError) onError(err);
      }
    );
  },

  saveMember: async (ownerUid: string, member: WorkspaceMember): Promise<WorkspaceMember> => {
    if (isGuestUserId(ownerUid) || !member) return member;
    // Canonical doc ID is strictly member.uid when UID is known (required by firestore.rules)
    const canonicalId = String(member.uid || member.id || member.email)
      .replace(/[/\\?%*:|"<>]/g, '_')
      .trim();
    const legacyId = member.id ? String(member.id).replace(/[/\\?%*:|"<>]/g, '_').trim() : canonicalId;

    const canonicalMember: WorkspaceMember = {
      ...member,
      id: canonicalId,
      workspaceOwnerUid: ownerUid
    };

    const docRef = doc(db, 'users', ownerUid, 'members', canonicalId);
    const data = cleanForFirestore({
      ...canonicalMember,
      updatedAt: new Date().toISOString()
    });
    await setDoc(docRef, data, { merge: true });

    // Clean up legacy mem_... doc if migrated to UID key
    if (member.uid && legacyId && legacyId !== canonicalId) {
      await deleteDoc(doc(db, 'users', ownerUid, 'members', legacyId)).catch(() => {});
    }

    return canonicalMember;
  },

  syncMemberTaskAuthorization: async (
    ownerUid: string,
    targetUid: string,
    assignedTaskIds: string[],
    previousTaskIds: string[] = []
  ): Promise<{ addedCount: number; removedCount: number; missingTaskIds: string[] }> => {
    if (isGuestUserId(ownerUid) || !targetUid) {
      return { addedCount: 0, removedCount: 0, missingTaskIds: [] };
    }
    const cleanTarget = targetUid.trim();
    const desired = Array.from(new Set((assignedTaskIds || []).map(x => String(x || '').trim()).filter(Boolean)));
    const removed = Array.from(
      new Set(
        (previousTaskIds || [])
          .map(x => String(x || '').trim())
          .filter(id => id && !desired.includes(id))
      )
    );

    const ops: Array<{ ref: any; payload: Record<string, any> }> = [];
    const missingTaskIds: string[] = [];
    const nowIso = new Date().toISOString();
    let addedCount = 0;
    let removedCount = 0;

    for (const taskId of desired) {
      const safeTaskId = taskId.replace(/\//g, '_').trim();
      if (!safeTaskId) continue;
      const ref = doc(db, 'users', ownerUid, 'tasks', safeTaskId);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        missingTaskIds.push(taskId);
        continue;
      }
      const data = snap.data() || {};
      const payload: Record<string, any> = {
        allowedUids: arrayUnion(cleanTarget),
        updatedAt: nowIso
      };
      if (!data.assignedUid) {
        payload.assignedUid = cleanTarget;
      }
      ops.push({ ref, payload });
      addedCount++;
    }

    for (const taskId of removed) {
      const safeTaskId = taskId.replace(/\//g, '_').trim();
      if (!safeTaskId) continue;
      const ref = doc(db, 'users', ownerUid, 'tasks', safeTaskId);
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const data = snap.data() || {};
      const payload: Record<string, any> = {
        allowedUids: arrayRemove(cleanTarget),
        updatedAt: nowIso
      };
      if (data.assignedUid === cleanTarget) {
        payload.assignedUid = deleteField();
      }
      ops.push({ ref, payload });
      removedCount++;
    }

    const chunkSize = 400;
    for (let i = 0; i < ops.length; i += chunkSize) {
      const batch = writeBatch(db);
      ops.slice(i, i + chunkSize).forEach(op => batch.set(op.ref, op.payload, { merge: true }));
      await batch.commit();
    }

    return { addedCount, removedCount, missingTaskIds };
  },

  deleteMember: async (ownerUid: string, memberId: string): Promise<void> => {
    if (isGuestUserId(ownerUid) || !memberId) return;
    const safeId = String(memberId).replace(/[/\\?%*:|"<>]/g, '_').trim();
    const docRef = doc(db, 'users', ownerUid, 'members', safeId);
    await deleteDoc(docRef);
  },

  fetchMember: async (ownerUid: string, identifier: string): Promise<WorkspaceMember | null> => {
    if (isGuestUserId(ownerUid) || !identifier) return null;
    const safeId = String(identifier).replace(/[/\\?%*:|"<>]/g, '_').trim();
    const docRef = doc(db, 'users', ownerUid, 'members', safeId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return { id: snap.id, ...(snap.data() as WorkspaceMember) };
    }
    return null;
  },

  // Approve and synchronize an already-authenticated member directly via Firestore (no Admin SDK key required)
  approveMemberDirectlyViaFirestore: async (params: {
    ownerUid?: string;
    targetUid: string;
    email: string;
    name: string;
    role?: UserRole;
    status?: UserStatus;
    permissions?: Partial<UserPermissions>;
    assignedTaskIds?: string[];
    linkedDevId?: string;
    linkedDevName?: string;
    previousMemberId?: string;
    existingMember?: WorkspaceMember | null;
    originatingAccessRequestUid?: string | null;
    invitedBy?: string;
  }): Promise<{
    member: WorkspaceMember;
    addedTasksCount: number;
    removedTasksCount: number;
    missingTaskIds: string[];
    linkedDevUpdated: boolean;
    accessRequestResolved: boolean;
  }> => {
    const ownerUid = params.ownerUid || NEXUS_OWNER_UID;
    if (isGuestUserId(ownerUid) || !auth.currentUser) {
      throw new Error('Sessão Firebase inválida para aprovar colaborador.');
    }

    const callerUid = auth.currentUser.uid;
    const isRootOwner = callerUid === NEXUS_OWNER_UID && ownerUid === NEXUS_OWNER_UID;

    if (!isRootOwner) {
      const callerMember = await FirebaseService.fetchMember(ownerUid, callerUid);
      const isActiveAdm =
        Boolean(callerMember) &&
        callerMember?.status === 'active' &&
        callerMember?.role === 'ADM' &&
        callerMember?.mustChangePassword !== true;
      if (!isActiveAdm) {
        const err: any = new Error('Apenas o proprietário ou administradores ativos podem aprovar acessos.');
        err.code = 'FORBIDDEN_NOT_ADMIN';
        throw err;
      }
    }

    const targetUid = String(params.targetUid || '').trim();
    if (!targetUid || targetUid.startsWith('guest-')) {
      throw new Error('UID do usuário autenticado é obrigatório para aprovação direta.');
    }

    const cleanEmail = String(params.email || '').trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 160) {
      throw new Error('E-mail corporativo inválido.');
    }

    const cleanName = String(params.name || cleanEmail.split('@')[0] || '').trim().slice(0, 120);
    if (!cleanName) {
      throw new Error('Nome do colaborador é obrigatório.');
    }

    const targetRole: UserRole = params.role === 'ADM' ? 'ADM' : 'Colaborador';
    if (targetRole === 'ADM' && !isRootOwner) {
      const err: any = new Error('Apenas o proprietário raiz pode promover usuários ao perfil ADM.');
      err.code = 'FORBIDDEN_OWNER_ONLY_ADM';
      throw err;
    }

    if (targetUid === NEXUS_OWNER_UID && !isRootOwner) {
      const err: any = new Error('Não é permitido alterar o registro do proprietário raiz.');
      err.code = 'FORBIDDEN_OWNER_PROTECTED';
      throw err;
    }

    const existingFromUid = await FirebaseService.fetchMember(ownerUid, targetUid);
    const existingFromPrev =
      params.previousMemberId && params.previousMemberId !== targetUid
        ? await FirebaseService.fetchMember(ownerUid, params.previousMemberId)
        : null;
    const prior = existingFromUid || existingFromPrev || params.existingMember || null;

    if (!isRootOwner && prior?.role === 'ADM') {
      const err: any = new Error('Apenas o proprietário raiz pode alterar um administrador existente.');
      err.code = 'FORBIDDEN_OWNER_ONLY_ADM';
      throw err;
    }

    const sanitizedPermissions = sanitizeMemberPermissions(targetRole, params.permissions);
    const sanitizedAssignedTaskIds =
      targetRole === 'ADM'
        ? []
        : Array.from(new Set((params.assignedTaskIds || []).map(x => String(x || '').trim()).filter(Boolean)));
    const targetStatus: UserStatus =
      params.status === 'inactive' || params.status === 'pending' ? params.status : 'active';

    const previousTaskIds = Array.from(
      new Set([
        ...(existingFromUid?.assignedTaskIds || []),
        ...(existingFromPrev?.assignedTaskIds || []),
        ...(params.existingMember?.assignedTaskIds || [])
      ].map(x => String(x || '').trim()).filter(Boolean))
    );

    const nowIso = new Date().toISOString();
    const memberPayload: WorkspaceMember = {
      id: targetUid,
      uid: targetUid,
      email: cleanEmail,
      name: cleanName,
      role: targetRole,
      status: targetStatus,
      permissions: sanitizedPermissions,
      assignedTaskIds: sanitizedAssignedTaskIds,
      workspaceOwnerUid: ownerUid,
      linkedDevId: params.linkedDevId ?? prior?.linkedDevId,
      linkedDevName: params.linkedDevName ?? prior?.linkedDevName,
      mustChangePassword: Boolean(prior?.mustChangePassword),
      invitedAt: prior?.invitedAt || nowIso,
      activatedAt: targetStatus === 'active' ? (prior?.activatedAt || nowIso) : prior?.activatedAt,
      invitedBy: prior?.invitedBy || params.invitedBy || auth.currentUser.email || callerUid
    };

    const savedMember = await FirebaseService.saveMember(ownerUid, memberPayload);

    if (params.previousMemberId && params.previousMemberId !== targetUid) {
      await FirebaseService.deleteMember(ownerUid, params.previousMemberId).catch(() => {});
    }

    let taskSyncResult: { addedCount: number; removedCount: number; missingTaskIds: string[] };
    try {
      taskSyncResult = await FirebaseService.syncMemberTaskAuthorization(
        ownerUid,
        targetUid,
        sanitizedAssignedTaskIds,
        previousTaskIds
      );
    } catch (syncErr: any) {
      syncErr.partialFailure = true;
      syncErr.member = savedMember;
      throw syncErr;
    }

    let linkedDevUpdated = false;
    if (memberPayload.linkedDevId) {
      const safeDevId = String(memberPayload.linkedDevId).replace(/\//g, '_').trim();
      if (safeDevId) {
        try {
          const devRef = doc(db, 'users', ownerUid, 'devs', safeDevId);
          const devSnap = await getDoc(devRef);
          if (devSnap.exists()) {
            await setDoc(
              devRef,
              cleanForFirestore({
                linkedUid: targetUid,
                linkedMemberId: targetUid
              }),
              { merge: true }
            );
            linkedDevUpdated = true;
          }
        } catch (devErr) {
          console.warn('Notice updating linkedDev metadata during direct approval:', devErr);
        }
      }
    }

    let accessRequestResolved = false;
    const reqUidToResolve = (params.originatingAccessRequestUid || targetUid).trim();
    if (reqUidToResolve) {
      try {
        const reqRef = doc(db, 'users', ownerUid, 'accessRequests', reqUidToResolve);
        const reqSnap = await getDoc(reqRef);
        if (reqSnap.exists() && reqSnap.data()?.status !== 'resolved') {
          await FirebaseService.updateAccessRequestStatus(ownerUid, reqUidToResolve, 'resolved', callerUid);
          accessRequestResolved = true;
        }
      } catch (reqErr: any) {
        reqErr.partialFailure = true;
        reqErr.member = savedMember;
        throw reqErr;
      }
    }

    return {
      member: savedMember,
      addedTasksCount: taskSyncResult.addedCount,
      removedTasksCount: taskSyncResult.removedCount,
      missingTaskIds: taskSyncResult.missingTaskIds,
      linkedDevUpdated,
      accessRequestResolved
    };
  },

  // --- Authenticated Dev Access Requests Queue (Strict UID-bound & Verified Email) ---
  subscribeAccessRequests: (
    ownerUid: string,
    callback: (requests: AccessRequest[]) => void,
    onError?: (error: any) => void
  ) => {
    if (isGuestUserId(ownerUid)) {
      callback([]);
      return () => {};
    }
    const colRef = collection(db, 'users', ownerUid, 'accessRequests');
    return onSnapshot(
      colRef,
      (snapshot) => {
        const list = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as AccessRequest) }));
        list.sort((a, b) => new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime());
        callback(list);
      },
      (err) => {
        console.warn('[Firebase] subscribeAccessRequests error:', err);
        if (onError) onError(err);
      }
    );
  },

  fetchMyAccessRequest: async (ownerUid: string, uid: string): Promise<AccessRequest | null> => {
    if (isGuestUserId(ownerUid) || !uid) return null;
    const docRef = doc(db, 'users', ownerUid, 'accessRequests', uid);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return { id: snap.id, ...(snap.data() as AccessRequest) };
  },

  saveAccessRequest: async (
    ownerUid: string,
    req: AccessRequest
  ): Promise<{ status: 'created' | 'already-exists'; request: AccessRequest }> => {
    if (isGuestUserId(ownerUid)) {
      throw new Error('Sessão não autenticada no Firebase.');
    }
    const current = auth.currentUser;
    if (!current || current.uid !== req.uid) {
      throw new Error('UID da solicitação não coincide com a conta autenticada.');
    }
    // Reload auth user and force-refresh ID token so Firestore Security Rules observe email_verified == true
    await current.reload();
    if (!current.emailVerified) {
      throw new Error('Verifique seu e-mail antes de enviar a solicitação de acesso.');
    }
    await current.getIdToken(true);

    const docRef = doc(db, 'users', ownerUid, 'accessRequests', current.uid);
    const existingSnap = await getDoc(docRef);
    if (existingSnap.exists()) {
      // Request already persisted for this UID - return idempotently without violating !exists() create rule
      return {
        status: 'already-exists',
        request: { id: existingSnap.id, ...(existingSnap.data() as AccessRequest) }
      };
    }

    const requestRecord: AccessRequest = {
      id: current.uid,
      uid: current.uid,
      email: (current.email || req.email).trim().toLowerCase(),
      name: req.name ? req.name.trim().slice(0, 120) : undefined,
      department: req.department ? req.department.trim().slice(0, 160) : undefined,
      devNameHint: req.devNameHint ? req.devNameHint.trim().slice(0, 120) : undefined,
      status: 'pending',
      requestedAt: req.requestedAt || new Date().toISOString()
    };

    const payload = cleanForFirestore(requestRecord);
    await setDoc(docRef, payload);
    return { status: 'created', request: requestRecord };
  },

  updateAccessRequestStatus: async (
    ownerUid: string,
    requestUid: string,
    status: 'resolved' | 'rejected',
    resolvedByUid?: string
  ): Promise<void> => {
    if (isGuestUserId(ownerUid) || !requestUid) return;
    const docRef = doc(db, 'users', ownerUid, 'accessRequests', requestUid);
    await setDoc(
      docRef,
      cleanForFirestore({
        status,
        resolvedAt: new Date().toISOString(),
        resolvedByUid,
        updatedAt: new Date().toISOString()
      }),
      { merge: true }
    );
  },

  // --- Account Recovery Requests (Admin/Owner managed queue in Firestore) ---
  subscribeRecoveryRequests: (
    ownerUid: string,
    callback: (requests: AccountRecoveryRequest[]) => void,
    onError?: (error: any) => void
  ) => {
    if (isGuestUserId(ownerUid)) {
      callback([]);
      return () => {};
    }
    const colRef = collection(db, 'users', ownerUid, 'recoveryRequests');
    return onSnapshot(colRef, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AccountRecoveryRequest));
      list.sort((a, b) => new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime());
      callback(list);
    }, (err) => {
      console.warn('[Firebase] subscribeRecoveryRequests notice:', err);
      if (onError) onError(err);
    });
  },

  saveRecoveryRequest: async (ownerUid: string, req: AccountRecoveryRequest) => {
    if (isGuestUserId(ownerUid) || !req || !req.id) return;
    const safeId = String(req.id).replace(/[/\\?%*:|"<>]/g, '_').trim();
    const docRef = doc(db, 'users', ownerUid, 'recoveryRequests', safeId);
    await setDoc(docRef, cleanForFirestore(req), { merge: true });
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
      if (currentUid === NEXUS_OWNER_UID) {
        for (const colName of ['tasks', 'devs', 'robots', 'sprints']) {
          const topSnap = await getDocs(collection(db, colName));
          if (!topSnap.empty) {
            const batch = writeBatch(db);
            topSnap.forEach(d => batch.delete(d.ref));
            await batch.commit();
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
