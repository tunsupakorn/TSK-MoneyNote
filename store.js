// Data layer: works locally (localStorage) and switches to Firebase Firestore for multi-device sync.
import { firebaseConfig as FILE_CONFIG } from './firebase-config.js';

const FB_VERSION = '11.0.2';

export const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

export const DEFAULT_CATEGORIES = [
  { id: 'food', name: 'อาหาร', emoji: '🍜', type: 'expense' },
  { id: 'drink', name: 'เครื่องดื่ม/กาแฟ', emoji: '🧋', type: 'expense' },
  { id: 'transport', name: 'เดินทาง', emoji: '🚕', type: 'expense' },
  { id: 'shopping', name: 'ช้อปปิ้ง', emoji: '🛍️', type: 'expense' },
  { id: 'bills', name: 'บิล/ค่าน้ำไฟ', emoji: '💡', type: 'expense' },
  { id: 'home', name: 'ที่พัก', emoji: '🏠', type: 'expense' },
  { id: 'health', name: 'สุขภาพ', emoji: '💊', type: 'expense' },
  { id: 'fun', name: 'บันเทิง', emoji: '🎬', type: 'expense' },
  { id: 'family', name: 'ครอบครัว', emoji: '👨‍👩‍👧', type: 'expense' },
  { id: 'edu', name: 'การศึกษา', emoji: '📚', type: 'expense' },
  { id: 'household', name: 'ของใช้', emoji: '🧴', type: 'expense' },
  { id: 'fee', name: 'ค่าธรรมเนียม/ดอกเบี้ย', emoji: '🧾', type: 'expense' },
  { id: 'exp_other', name: 'อื่นๆ', emoji: '📦', type: 'expense' },
  { id: 'salary', name: 'เงินเดือน', emoji: '💼', type: 'income' },
  { id: 'sales', name: 'ขายของ', emoji: '🏪', type: 'income' },
  { id: 'bonus', name: 'โบนัส', emoji: '🎁', type: 'income' },
  { id: 'invest', name: 'ลงทุน/ดอกเบี้ย', emoji: '📈', type: 'income' },
  { id: 'refund', name: 'เงินคืน/Cashback', emoji: '🔁', type: 'income' },
  { id: 'inc_other', name: 'อื่นๆ', emoji: '💰', type: 'income' },
];

const defaultSettings = () => ({ categories: DEFAULT_CATEGORIES, budget: 0 });

export const state = {
  mode: 'local',            // 'local' | 'cloud'
  cloudConfigured: false,
  syncStatus: 'local',      // local | signed-out | pending | synced | error
  syncError: '',
  user: null,
  tx: [],
  settings: defaultSettings(),
  localPendingCount: 0,     // local items that can be uploaded after sign-in
};

export const prefs = Object.assign({ theme: 'auto', geminiKey: '', geminiModel: 'gemini-2.5-flash', onboarded: false }, LS.get('jj_prefs', {}));
export function savePrefs(patch) { Object.assign(prefs, patch); LS.set('jj_prefs', prefs); }

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach(fn => fn(state)); }

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let fb = null;                 // { auth, db, A (auth module), F (firestore module) }
let unsubs = [];

export function getFirebaseConfig() { return LS.get('jj_fbconfig', null) || FILE_CONFIG; }
export function setFirebaseConfig(cfg) { cfg ? LS.set('jj_fbconfig', cfg) : LS.del('jj_fbconfig'); }

function loadLocal() {
  state.tx = LS.get('jj_tx', []);
  state.settings = { ...defaultSettings(), ...LS.get('jj_settings', {}) };
}

export async function initStore() {
  loadLocal();
  emit();
  const cfg = getFirebaseConfig();
  if (!cfg) return;
  state.cloudConfigured = true;
  state.syncStatus = 'signed-out';
  emit();
  try { await initFirebase(cfg); }
  catch (e) { console.error(e); state.syncStatus = 'error'; state.syncError = e.message || String(e); emit(); }
}

async function initFirebase(cfg) {
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;
  const [appM, A, F] = await Promise.all([
    import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`), import(`${base}/firebase-firestore.js`)]);
  const app = appM.initializeApp(cfg);
  const auth = A.getAuth(app);
  let db;
  try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
  catch { db = F.getFirestore(app); }
  fb = { auth, db, A, F };
  A.onAuthStateChanged(auth, user => user ? attachUser(user) : detachUser());
}

function attachUser(user) {
  const { db, F } = fb;
  unsubs.forEach(u => u()); unsubs = [];
  state.mode = 'cloud';
  state.user = { uid: user.uid, email: user.email, name: user.displayName };
  state.syncStatus = 'pending';
  state.localPendingCount = LS.get('jj_tx', []).length;
  emit();
  unsubs.push(F.onSnapshot(F.collection(db, 'users', user.uid, 'tx'), { includeMetadataChanges: true }, snap => {
    state.tx = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.syncStatus = snap.metadata.hasPendingWrites || snap.metadata.fromCache ? 'pending' : 'synced';
    emit();
  }, err => { state.syncStatus = 'error'; state.syncError = err.message; emit(); }));
  unsubs.push(F.onSnapshot(F.doc(db, 'users', user.uid), snap => {
    const s = snap.exists() ? snap.data().settings : null;
    state.settings = { ...defaultSettings(), ...(s || {}) };
    emit();
  }, err => console.warn(err)));
}

function detachUser() {
  unsubs.forEach(u => u()); unsubs = [];
  state.mode = 'local';
  state.user = null;
  state.syncStatus = state.cloudConfigured ? 'signed-out' : 'local';
  loadLocal();
  emit();
}

const clean = o => JSON.parse(JSON.stringify(o)); // drop undefined for Firestore
const userPath = (...p) => [fb.db, 'users', state.user.uid, ...p];

function writeLocal() { LS.set('jj_tx', state.tx); emit(); }

export function saveTx(tx) {
  tx = { ...tx, id: tx.id || newId(), updatedAt: Date.now() };
  tx.createdAt ||= tx.updatedAt;
  if (state.mode === 'cloud') {
    fb.F.setDoc(fb.F.doc(...userPath('tx', tx.id)), clean(tx)).catch(syncFail);
  } else {
    const i = state.tx.findIndex(t => t.id === tx.id);
    if (i >= 0) state.tx[i] = tx; else state.tx.push(tx);
    writeLocal();
  }
  return tx;
}

export async function saveMany(list) {
  const items = list.map(t => ({ ...t, id: t.id || newId(), createdAt: t.createdAt || Date.now(), updatedAt: Date.now() }));
  if (state.mode === 'cloud') {
    const { F, db } = fb;
    for (let i = 0; i < items.length; i += 400) {
      const b = F.writeBatch(db);
      items.slice(i, i + 400).forEach(t => b.set(F.doc(...userPath('tx', t.id)), clean(t)));
      b.commit().catch(syncFail);
    }
  } else {
    const byId = new Map(state.tx.map(t => [t.id, t]));
    items.forEach(t => byId.set(t.id, t));
    state.tx = [...byId.values()];
    writeLocal();
  }
  return items.length;
}

export function deleteTx(id) {
  if (state.mode === 'cloud') fb.F.deleteDoc(fb.F.doc(...userPath('tx', id))).catch(syncFail);
  else { state.tx = state.tx.filter(t => t.id !== id); writeLocal(); }
}

export function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  if (state.mode === 'cloud') fb.F.setDoc(fb.F.doc(...userPath()), { settings: clean(state.settings) }, { merge: true }).catch(syncFail);
  else LS.set('jj_settings', state.settings);
  emit();
}

function syncFail(e) { console.error(e); state.syncStatus = 'error'; state.syncError = e.message; emit(); }

// Upload transactions saved on this device before signing in.
export async function uploadLocalToCloud() {
  const local = LS.get('jj_tx', []);
  const n = await saveMany(local);
  LS.del('jj_tx');
  state.localPendingCount = 0;
  emit();
  return n;
}
export function discardLocalPending() { LS.del('jj_tx'); state.localPendingCount = 0; emit(); }

// ---- auth ----
const authMsg = e => ({
  'auth/invalid-email': 'อีเมลไม่ถูกต้อง',
  'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  'auth/wrong-password': 'รหัสผ่านไม่ถูกต้อง',
  'auth/user-not-found': 'ไม่พบบัญชีนี้ ลองกด "สมัครใหม่"',
  'auth/email-already-in-use': 'อีเมลนี้มีบัญชีแล้ว ลองกด "เข้าสู่ระบบ"',
  'auth/weak-password': 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัว',
  'auth/popup-blocked': 'เบราว์เซอร์บล็อกหน้าต่างล็อกอิน ลองใช้อีเมลแทน',
  'auth/popup-closed-by-user': 'ปิดหน้าต่างล็อกอินก่อนเสร็จ',
  'auth/unauthorized-domain': 'โดเมนนี้ยังไม่ได้เพิ่มใน Firebase > Authentication > Settings > Authorized domains',
  'auth/operation-not-allowed': 'ยังไม่ได้เปิดวิธีล็อกอินนี้ใน Firebase Console',
  'auth/network-request-failed': 'เชื่อมต่ออินเทอร์เน็ตไม่ได้',
}[e.code] || e.message);

function needFb() { if (!fb) throw new Error('ยังไม่ได้ตั้งค่า Firebase'); }
export async function signIn(email, pw) { needFb(); try { await fb.A.signInWithEmailAndPassword(fb.auth, email, pw); } catch (e) { throw new Error(authMsg(e)); } }
export async function signUp(email, pw) { needFb(); try { await fb.A.createUserWithEmailAndPassword(fb.auth, email, pw); } catch (e) { throw new Error(authMsg(e)); } }
export async function signInGoogle() { needFb(); try { await fb.A.signInWithPopup(fb.auth, new fb.A.GoogleAuthProvider()); } catch (e) { throw new Error(authMsg(e)); } }
export async function resetPassword(email) { needFb(); try { await fb.A.sendPasswordResetEmail(fb.auth, email); } catch (e) { throw new Error(authMsg(e)); } }
export async function signOut() { if (fb) await fb.A.signOut(fb.auth); }
