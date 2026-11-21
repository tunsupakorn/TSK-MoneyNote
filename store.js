// Data layer: Firebase Firestore, synced across devices and cached for offline use.
// Private app: only the owner's account can use it, and data lives in Firebase Firestore.
import { firebaseConfig as FILE_CONFIG, ownerUid as OWNER_UID } from './firebase-config.js';

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
  { id: 'electric', name: 'ค่าไฟ', emoji: '⚡', type: 'expense' },
  { id: 'water', name: 'ค่าน้ำ', emoji: '🚰', type: 'expense' },
  { id: 'internet', name: 'อินเทอร์เน็ต', emoji: '🌐', type: 'expense' },
  { id: 'phone', name: 'ค่าโทรศัพท์', emoji: '📱', type: 'expense' },
  { id: 'bills', name: 'บิลอื่นๆ', emoji: '🧾', type: 'expense' },
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

export const SHOP_CATEGORIES = [
  { id: 'stock', name: 'ต้นทุนสินค้า/วัตถุดิบ', emoji: '📦', type: 'expense' },
  { id: 'rent', name: 'ค่าเช่าร้าน', emoji: '🏠', type: 'expense' },
  { id: 'staff', name: 'ค่าจ้างพนักงาน', emoji: '👥', type: 'expense' },
  { id: 'utility', name: 'ค่าน้ำค่าไฟร้าน', emoji: '⚡', type: 'expense' },
  { id: 'shipping', name: 'ค่าขนส่ง', emoji: '🚚', type: 'expense' },
  { id: 'marketing', name: 'การตลาด/โฆษณา', emoji: '📣', type: 'expense' },
  { id: 'equipment', name: 'อุปกรณ์ร้าน', emoji: '🔧', type: 'expense' },
  { id: 'fee', name: 'ค่าธรรมเนียม', emoji: '🧾', type: 'expense' },
  { id: 'exp_other', name: 'อื่นๆ', emoji: '📦', type: 'expense' },
  { id: 'sales', name: 'ยอดขาย', emoji: '🏪', type: 'income' },
  { id: 'inc_other', name: 'รายได้อื่น', emoji: '💰', type: 'income' },
];
export const INVEST_CATEGORIES = [
  { id: 'buy', name: 'ซื้อหุ้น/กองทุน', emoji: '📈', type: 'expense' },
  { id: 'fee', name: 'ค่าธรรมเนียม', emoji: '🧾', type: 'expense' },
  { id: 'loss', name: 'ขาดทุน', emoji: '📉', type: 'expense' },
  { id: 'exp_other', name: 'อื่นๆ', emoji: '📦', type: 'expense' },
  { id: 'dividend', name: 'ปันผล', emoji: '💵', type: 'income' },
  { id: 'interest', name: 'ดอกเบี้ย', emoji: '🏦', type: 'income' },
  { id: 'gain', name: 'กำไรจากการขาย', emoji: '💹', type: 'income' },
  { id: 'inc_other', name: 'รายได้อื่น', emoji: '💰', type: 'income' },
];
// Book kinds and their starting categories. 'personal' uses DEFAULT_CATEGORIES.
export const BOOK_KINDS = {
  personal: { name: 'ส่วนตัว', emoji: '👤', categories: DEFAULT_CATEGORIES },
  shop: { name: 'ร้าน', emoji: '🏪', categories: SHOP_CATEGORIES },
  invest: { name: 'ลงทุน', emoji: '📈', categories: INVEST_CATEGORIES },
};
export const newBook = (kind, id = kind) => ({ id, kind, name: BOOK_KINDS[kind].name, emoji: BOOK_KINDS[kind].emoji,
  categories: BOOK_KINDS[kind].categories.map(c => ({ ...c })), budget: 0 });

const CAT_VERSION = 2;
const defaultSettings = () => ({ books: [newBook('personal'), newBook('shop'), newBook('invest')], catVersion: CAT_VERSION, ownerNames: '' });

// Older settings had one category list + budget: they become the "ส่วนตัว" book, with shop and invest books added.
function migrateBooks(s) {
  if (Array.isArray(s.books) && s.books.length) return false;
  const personal = { ...newBook('personal'), categories: s.categories || DEFAULT_CATEGORIES, budget: Number(s.budget || 0) };
  s.books = [personal, newBook('shop'), newBook('invest')];
  delete s.categories; delete s.budget;
  return true;
}

// Bring a saved category list up to date (v2 adds bill categories); returns true if it changed.
function migrateSettings(s) {
  if ((s.catVersion || 1) >= CAT_VERSION) return false;
  const list = [...(s.categories || DEFAULT_CATEGORIES)];
  const has = id => list.some(c => c.id === id);
  const bills = list.findIndex(c => c.id === 'bills');
  const add = ['electric', 'water', 'internet', 'phone'].filter(id => !has(id)).map(id => DEFAULT_CATEGORIES.find(c => c.id === id));
  list.splice(bills >= 0 ? bills : list.length, 0, ...add);
  const b = list.find(c => c.id === 'bills');
  if (b && b.name === 'บิล/ค่าน้ำไฟ') Object.assign(b, { name: 'บิลอื่นๆ', emoji: '🧾' });
  s.categories = list;
  s.catVersion = CAT_VERSION;
  return true;
}

export const state = {
  mode: 'signed-out',       // 'signed-out' | 'cloud'
  syncStatus: 'signed-out', // signed-out | pending | synced | error
  syncError: '',
  user: null,
  tx: [],
  settings: defaultSettings(),
  settingsReady: false,    // true once the account's settings have loaded from Firestore
  access: 'ok',             // ok | private (signed in with an account that is not the owner's)
  isOwner: false,
};

import { DEFAULT_MODEL } from './gemini.js';
const RETIRED_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
export const prefs = Object.assign({ theme: 'auto', geminiKey: '', geminiModel: DEFAULT_MODEL, onboarded: false }, LS.get('jj_prefs', {}));
if (!prefs.geminiModel || RETIRED_MODELS.includes(prefs.geminiModel)) { prefs.geminiModel = DEFAULT_MODEL; LS.set('jj_prefs', prefs); }
// one-time switch of the old default (gemini-3.8-flash) to Flash-Lite; a later manual choice is kept
if (!prefs.liteDefaultApplied) {
  if (prefs.geminiModel === 'gemini-3.8-flash') prefs.geminiModel = DEFAULT_MODEL;
  prefs.liteDefaultApplied = true;
  LS.set('jj_prefs', prefs);
}
export function savePrefs(patch) { Object.assign(prefs, patch); LS.set('jj_prefs', prefs); }

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { listeners.forEach(fn => fn(state)); }

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let fb = null;                 // { auth, db, A (auth module), F (firestore module) }
let unsubs = [];

export async function initStore() {
  emit();
  try { await initFirebase(FILE_CONFIG); }
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

function denied(err) {
  if (err?.code !== 'permission-denied') return false;
  unsubs.forEach(u => u()); unsubs = [];
  state.access = 'private';
  state.tx = [];
  state.syncStatus = 'error';
  state.syncError = 'บัญชีนี้ยังไม่ได้รับอนุญาตให้ใช้แอป';
  emit();
  return true;
}

function attachUser(user) {
  const { db, F } = fb;
  unsubs.forEach(u => u()); unsubs = [];
  state.mode = 'cloud';
  state.isOwner = !!OWNER_UID && user.uid === OWNER_UID;
  state.user = { uid: user.uid, email: user.email, name: user.displayName, verified: user.emailVerified,
    provider: user.providerData?.[0]?.providerId || 'password' };
  state.access = 'ok';
  // private app: only the owner's account may use it
  if (!state.isOwner) {
    state.access = 'private';
    state.syncStatus = 'signed-out';
    state.tx = [];
    emit();
    return;
  }
  state.syncStatus = 'pending';
  emit();
  unsubs.push(F.onSnapshot(F.collection(db, 'users', user.uid, 'tx'), { includeMetadataChanges: true }, snap => {
    state.tx = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    state.syncStatus = snap.metadata.hasPendingWrites || snap.metadata.fromCache ? 'pending' : 'synced';
    emit();
  }, err => { if (!denied(err)) { state.syncStatus = 'error'; state.syncError = err.message; emit(); } }));
  state.settingsReady = false;
  unsubs.push(F.onSnapshot(F.doc(db, 'users', user.uid), snap => {
    const s = snap.exists() ? snap.data().settings : null;
    state.settingsReady = true;
    state.settings = { ...defaultSettings(), catVersion: s?.categories ? 1 : CAT_VERSION, ...(s || {}) };
    if (s?.categories || s?.budget !== undefined) delete state.settings.books; // old layout: rebuild books from it
    const changed = [migrateSettings(state.settings), migrateBooks(state.settings)].some(Boolean);
    // updateDoc replaces the whole settings map, so the old categories/budget keys are dropped
    if (s && changed && !snap.metadata.fromCache)
      F.updateDoc(F.doc(db, 'users', user.uid), { settings: clean(state.settings) }).catch(syncFail);
    emit();
  }, err => { if (!denied(err)) console.warn(err); }));
}

function detachUser() {
  unsubs.forEach(u => u()); unsubs = [];
  state.mode = 'signed-out';
  state.user = null;
  state.access = 'ok';
  state.isOwner = false;
  state.syncStatus = 'signed-out';
  state.tx = [];
  state.settings = defaultSettings();
  state.settingsReady = false;
  emit();
}

const clean = o => JSON.parse(JSON.stringify(o)); // drop undefined for Firestore
const userPath = (...p) => [fb.db, 'users', state.user.uid, ...p];

function needCloud() { if (state.mode !== 'cloud') throw new Error('ต้องล็อกอินก่อน'); }

export function saveTx(tx) {
  tx = { ...tx, id: tx.id || newId(), updatedAt: Date.now() };
  tx.createdAt ||= tx.updatedAt;
  needCloud();
  fb.F.setDoc(fb.F.doc(...userPath('tx', tx.id)), clean(tx)).catch(syncFail);
  return tx;
}

export async function saveMany(list) {
  const items = list.map(t => ({ ...t, id: t.id || newId(), createdAt: t.createdAt || Date.now(), updatedAt: Date.now() }));
  needCloud();
  const { F, db } = fb;
  for (let i = 0; i < items.length; i += 400) {
    const b = F.writeBatch(db);
    items.slice(i, i + 400).forEach(t => b.set(F.doc(...userPath('tx', t.id)), clean(t)));
    b.commit().catch(syncFail);
  }
  return items.length;
}

export function deleteTx(id) {
  needCloud();
  const hadSlip = state.tx.find(t => t.id === id)?.hasSlip;
  fb.F.deleteDoc(fb.F.doc(...userPath('tx', id))).catch(syncFail);
  if (hadSlip) fb.F.deleteDoc(fb.F.doc(...userPath('slips', id))).catch(e => console.warn('slip delete', e));
}

// ---- slip images, kept in Firestore next to their entry: users/{uid}/slips/{txId} ----
export const canKeepSlips = () => state.mode === 'cloud' && !!fb;
export async function saveSlipImage(txId, { blob, width, height }) {
  if (!canKeepSlips()) throw new Error('ต้องล็อกอินก่อนจึงจะเก็บรูปสลิปได้');
  const { F } = fb;
  const bytes = F.Bytes.fromUint8Array(new Uint8Array(await blob.arrayBuffer()));
  await F.setDoc(F.doc(...userPath('slips', txId)), { img: bytes, mime: blob.type || 'image/jpeg', width, height, size: blob.size, createdAt: Date.now() });
  await F.setDoc(F.doc(...userPath('tx', txId)), { hasSlip: true, updatedAt: Date.now() }, { merge: true });
}
export async function deleteSlipImage(txId) {
  needCloud();
  const { F } = fb;
  await F.setDoc(F.doc(...userPath('tx', txId)), { hasSlip: false, updatedAt: Date.now() }, { merge: true });
  await F.deleteDoc(F.doc(...userPath('slips', txId)));
}
// Returns an object URL for the slip image, or null if there is none.
export async function loadSlipImage(txId) {
  if (!canKeepSlips()) return null;
  const { F } = fb;
  const snap = await F.getDoc(F.doc(...userPath('slips', txId)));
  if (!snap.exists()) return null;
  const d = snap.data();
  return URL.createObjectURL(new Blob([d.img.toUint8Array()], { type: d.mime || 'image/jpeg' }));
}

export function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  if (state.mode === 'cloud') {
    const ref = fb.F.doc(...userPath());
    // before the saved settings have loaded, only merge the changed keys so nothing else is overwritten
    if (!state.settingsReady) fb.F.setDoc(ref, { settings: clean(patch) }, { merge: true }).catch(syncFail);
    else fb.F.updateDoc(ref, { settings: clean(state.settings) })
      .catch(() => fb.F.setDoc(ref, { settings: clean(state.settings) }, { merge: true }).catch(syncFail));
  }
  emit();
}

function syncFail(e) { console.error(e); state.syncStatus = 'error'; state.syncError = e.message; emit(); }


// ---- auth ----
const authMsg = e => ({
  'auth/invalid-email': 'อีเมลไม่ถูกต้อง',
  'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  'auth/wrong-password': 'รหัสผ่านไม่ถูกต้อง',
  'auth/user-not-found': 'ไม่พบบัญชีนี้',
  'auth/popup-blocked': 'เบราว์เซอร์บล็อกหน้าต่างล็อกอิน ลองใช้อีเมลแทน',
  'auth/popup-closed-by-user': 'ปิดหน้าต่างล็อกอินก่อนเสร็จ',
  'auth/unauthorized-domain': 'โดเมนนี้ยังไม่ได้เพิ่มใน Firebase > Authentication > Settings > Authorized domains',
  'auth/operation-not-allowed': 'ยังไม่ได้เปิดวิธีล็อกอินนี้ใน Firebase Console',
  'auth/network-request-failed': 'เชื่อมต่ออินเทอร์เน็ตไม่ได้',
  'auth/too-many-requests': 'ส่งคำขอบ่อยเกินไป รอสักครู่แล้วลองใหม่',
}[e.code] || e.message);

function needFb() { if (!fb) throw new Error('ยังไม่ได้ตั้งค่า Firebase'); }
export async function signIn(email, pw) { needFb(); try { await fb.A.signInWithEmailAndPassword(fb.auth, email, pw); } catch (e) { throw new Error(authMsg(e)); } }
export async function signInGoogle() { needFb(); try { await fb.A.signInWithPopup(fb.auth, new fb.A.GoogleAuthProvider()); } catch (e) { throw new Error(authMsg(e)); } }
export async function signOut() { if (fb) await fb.A.signOut(fb.auth); }
