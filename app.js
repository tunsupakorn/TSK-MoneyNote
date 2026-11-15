import * as S from './store.js';
import { readFile, testKey, DEFAULT_MODEL, setModelChangeHandler, setFallbackHandler, setStatusHandler, cancelAll, resetCancel } from './gemini.js';
import { categoryBars, dailyColumns, bindColumnTips } from './charts.js';
import * as Sheet from './sheets.js';
import { readSlipQR } from './qr.js';

const { state, prefs } = S;
const $ = (sel, root = document) => root.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 });
const baht = n => '฿' + nf.format(Math.round((n || 0) * 100) / 100);
const todayISO = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const parseISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const monthLabel = ym => new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric' }).format(parseISO(ym + '-01'));
const dayLabel = iso => new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short' }).format(parseISO(iso));
const shortDay = iso => new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(parseISO(iso));
const METHODS = { cash: '💵 เงินสด', transfer: '📲 โอน', card: '💳 บัตร' };

const ui = {
  view: 'home',
  month: todayISO().slice(0, 7),
  statsType: 'expense',
  search: '',
  scan: { busy: false, done: 0, total: 0, items: [], errors: [], skipped: [], only30: true },
  tray: [],        // picked files waiting to be read: { file, url }
  slipNote: '',
  authMode: 'signin',
  authBusy: false,
  authError: '',
  obStep: 0,
};

const cats = () => state.settings.categories || S.DEFAULT_CATEGORIES;
// Gemini key: this device first, else the one synced with your account (enter once, every device gets it)
const geminiKey = () => prefs.geminiKey || state.settings.geminiKey || '';
const TRANSFER_CAT ={ id: 'transfer', name: 'ย้ายเงิน', emoji: '🔄', type: 'transfer' };
const catById = id => id === 'transfer' ? TRANSFER_CAT : cats().find(c => c.id === id) || { id, name: 'ไม่ระบุ', emoji: '❔', type: 'expense' };
const SIGN = { expense: '−', income: '+', transfer: '↔ ' };
const EMOJIS = ['🍜', '🍱', '🧋', '☕', '🍺', '🛒', '🛍️', '👕', '💄', '🚕', '🚗', '⛽', '🏍️', '🚇', '✈️', '🏠', '⚡', '🚰', '🌐', '📱', '🧾', '💊', '🏥', '🐶', '👶', '🎮', '🎬', '🎵', '📚', '🎓', '🏋️', '💇', '🎁', '❤️', '🙏', '💼', '🏪', '📈', '💰', '🔁', '🏦', '💳', '🧴', '🧹', '🔧', '📦'];
// owner names for spotting transfers between your own accounts: what you typed + your account name
const ownerNames = () => [...String(state.settings.ownerNames || '').split(/[,\n]/), state.user?.name || '']
  .map(s => s.trim()).filter(s => s.length > 1);
const monthTx = () => state.tx.filter(t => t.date?.startsWith(ui.month));
const sum = (list, type) => list.filter(t => t.type === type).reduce((s, t) => s + Number(t.amount || 0), 0);

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

function applyTheme() {
  const t = prefs.theme;
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}

// ---------- shared pieces ----------
const SYNC = {
  local: ['ในเครื่องนี้', 'local'], 'signed-out': ['ยังไม่ล็อกอิน', 'warn'], pending: ['กำลังซิงก์…', 'pending'],
  synced: ['ซิงก์แล้ว', 'ok'], error: ['ซิงก์ผิดพลาด', 'bad'],
};
function header(title) {
  const [label, cls] = SYNC[state.syncStatus] || SYNC.local;
  return `<header class="top">
    <div class="brand"><img src="icons/icon.svg" alt="" width="40" height="40"><div><h1>${title || 'จุกจิก'}</h1><small>JukJik</small></div></div>
    <button class="sync ${cls}" data-nav="settings" title="สถานะการซิงก์"><i></i>${label}</button>
  </header>`;
}
function monthSwitch() {
  return `<div class="month">
    <button class="icon-btn" data-action="month" data-d="-1" aria-label="เดือนก่อน">‹</button>
    <strong>${monthLabel(ui.month)}</strong>
    <button class="icon-btn" data-action="month" data-d="1" aria-label="เดือนถัดไป">›</button>
  </div>`;
}
function txRow(t) {
  const c = catById(t.cat);
  const sub = [t.merchant, t.note].filter(Boolean).join(' · ');
  return `<li><button class="tx" data-action="edit" data-id="${esc(t.id)}">
    <span class="bubble" aria-hidden="true">${c.emoji}</span>
    <span class="tx-main"><b>${esc(c.name)}</b><small>${esc(sub || METHODS[t.method] || '')}</small></span>
    <span class="tx-amt num ${t.type}">${t.slipUrl ? '<i class="clip" title="มีสลิปใน Drive">📎</i>' : ''}${SIGN[t.type] || ''}${baht(t.amount)}</span>
  </button></li>`;
}

// ---------- views ----------
function viewOnboarding() {
  const steps = [
    { e: '🐣', h: 'สวัสดี! ฉันชื่อ จุกจิก', p: 'ผู้ช่วยจดรายรับรายจ่ายของคุณ เรื่องเงินจุกจิกแค่ไหน ฉันก็จดให้ครบ' },
    { e: '🧾', h: 'ส่งสลิปมา ฉันอ่านให้', p: 'เลือกรูปสลิปโอนเงินย้อนหลังได้ทีละหลายใบ (สูงสุด 30 วัน) อ่านได้ทุกธนาคาร รวมถึงใบแจ้งยอดบัตรเครดิต PDF' },
    { e: '🔄', h: 'ซิงก์ทุกเครื่อง', p: 'มือถือ แท็บเล็ต กี่เครื่องก็ได้ ล็อกอินบัญชีเดียว ข้อมูลตรงกันทันที ไม่ต้องใช้เบอร์มือถือหรือ OTP' },
    { e: '📊', h: 'รู้ว่าเงินไปไหน', p: 'สรุปรายวัน รายเดือน แยกหมวด พร้อมตั้งงบไม่ให้ใช้เกิน' },
  ];
  const s = steps[ui.obStep];
  const last = ui.obStep === steps.length - 1;
  return `<section class="onboard">
    <button class="link skip" data-action="ob-done">ข้าม</button>
    <div class="ob-art"><img src="icons/icon.svg" alt="" class="ob-chick"><span class="ob-emoji">${s.e}</span></div>
    <h2>${s.h}</h2><p>${s.p}</p>
    <div class="dots">${steps.map((_, i) => `<i class="${i === ui.obStep ? 'on' : ''}"></i>`).join('')}</div>
    ${last
      ? `<button class="btn primary big" data-action="ob-done">เริ่มจดเลย</button>
         <button class="btn ghost" data-action="ob-sync">ตั้งค่าซิงก์ก่อน</button>
         <a class="link" href="guide.html">📖 อ่านวิธีใช้งานทั้งหมด</a>`
      : `<button class="btn primary big" data-action="ob-next">ถัดไป</button>`}
  </section>`;
}

function viewHome() {
  const list = monthTx();
  const inc = sum(list, 'income'), exp = sum(list, 'expense');
  const budget = Number(state.settings.budget || 0);
  const q = ui.search.trim().toLowerCase();
  const shown = list.filter(t => !q || [catById(t.cat).name, t.merchant, t.note, String(t.amount)].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')) || (b.createdAt || 0) - (a.createdAt || 0));
  const groups = {};
  shown.forEach(t => (groups[t.date] ||= []).push(t));

  let budgetCard = '';
  if (budget > 0) {
    const pct = Math.min(100, exp / budget * 100);
    const over = exp > budget;
    const isThisMonth = ui.month === todayISO().slice(0, 7);
    const daysIn = new Date(+ui.month.slice(0, 4), +ui.month.slice(5), 0).getDate();
    const daysLeft = isThisMonth ? daysIn - new Date().getDate() + 1 : 0;
    const perDay = daysLeft > 0 ? Math.max(0, budget - exp) / daysLeft : 0;
    budgetCard = `<section class="card budget ${over ? 'over' : pct > 80 ? 'near' : ''}">
      <div class="row between"><span>งบเดือนนี้</span><span class="num">${baht(exp)} / ${baht(budget)}</span></div>
      <div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><div style="width:${pct}%"></div></div>
      <small>${over ? `⚠️ ใช้เกินงบแล้ว ${baht(exp - budget)}` : isThisMonth && daysLeft > 0 ? `เหลือ ${baht(budget - exp)} · ใช้ได้วันละ ${baht(perDay)}` : `เหลือ ${baht(budget - exp)}`}</small>
    </section>`;
  }

  const banner = state.mode === 'cloud' && state.localPendingCount > 0 ? `<section class="card notice">
      <p>📦 มี <b>${state.localPendingCount}</b> รายการที่จดไว้ในเครื่องนี้ก่อนล็อกอิน</p>
      <div class="row gap"><button class="btn primary sm" data-action="upload-local">อัปขึ้นบัญชี</button>
      <button class="btn ghost sm" data-action="discard-local">ไม่ต้อง</button></div></section>`
    : state.syncStatus === 'signed-out' ? `<section class="card notice"><p>🔐 ล็อกอินเพื่อซิงก์ข้อมูลทุกเครื่อง</p>
      <button class="btn primary sm" data-nav="settings">ล็อกอิน</button></section>` : '';

  return `${header()}${monthSwitch()}
    <section class="hero">
      <span class="hero-label">คงเหลือ</span>
      <div class="hero-num num">${inc - exp < 0 ? '−' : ''}${baht(Math.abs(inc - exp))}</div>
      <div class="hero-split">
        <div><small>รายรับ</small><b class="num">${baht(inc)}</b></div>
        <div><small>รายจ่าย</small><b class="num">${baht(exp)}</b></div>
      </div>
      <img src="icons/icon.svg" alt="" class="hero-chick">
    </section>
    ${banner}${budgetCard}
    ${list.length ? `<label class="search"><span aria-hidden="true">🔍</span><input type="search" placeholder="ค้นหารายการ" value="${esc(ui.search)}" data-input="search"></label>` : ''}
    ${Object.keys(groups).length ? Object.entries(groups).map(([d, items]) => `
      <section class="day">
        <div class="day-head"><span>${dayLabel(d)}</span><span class="num">${sum(items, 'expense') ? '−' + baht(sum(items, 'expense')) : ''}</span></div>
        <ul class="txs">${items.map(txRow).join('')}</ul>
      </section>`).join('')
    : `<section class="empty">
        <img src="icons/icon.svg" alt="" width="96" height="96">
        <h3>${q ? 'ไม่พบรายการที่ค้นหา' : 'ยังไม่มีรายการเดือนนี้'}</h3>
        ${q ? '' : `<p>กดปุ่มเหลือง <b>🧾 อ่านสลิป</b> ตรงกลาง หรือ <b>✏️ จดเอง</b></p>
        <button class="btn primary" data-nav="scan">🧾 อ่านสลิป</button>`}
      </section>`}`;
}

function viewStats() {
  const list = monthTx();
  const type = ui.statsType;
  const byCat = {};
  list.filter(t => t.type === type).forEach(t => byCat[t.cat] = (byCat[t.cat] || 0) + Number(t.amount));
  const rows = Object.entries(byCat).map(([id, amount]) => ({ ...catById(id), amount })).sort((a, b) => b.amount - a.amount);
  const [y, m] = ui.month.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const values = Array(days).fill(0);
  list.filter(t => t.type === type).forEach(t => values[+t.date.slice(8, 10) - 1] += Number(t.amount));
  const labels = values.map((_, i) => shortDay(`${ui.month}-${String(i + 1).padStart(2, '0')}`));
  const total = values.reduce((a, b) => a + b, 0);
  const isThisMonth = ui.month === todayISO().slice(0, 7);
  const elapsed = isThisMonth ? new Date().getDate() : days;
  const methods = {};
  list.filter(t => t.type === type).forEach(t => methods[t.method || 'cash'] = (methods[t.method || 'cash'] || 0) + Number(t.amount));

  return `${header('สรุป')}${monthSwitch()}
    <div class="seg" role="tablist">
      <button role="tab" aria-selected="${type === 'expense'}" data-action="stats-type" data-t="expense">รายจ่าย</button>
      <button role="tab" aria-selected="${type === 'income'}" data-action="stats-type" data-t="income">รายรับ</button>
    </div>
    <section class="stat-tiles">
      <div class="tile"><small>รวมทั้งเดือน</small><b class="num">${baht(total)}</b></div>
      <div class="tile"><small>เฉลี่ยต่อวัน</small><b class="num">${baht(total / Math.max(1, elapsed))}</b></div>
      <div class="tile"><small>จำนวนรายการ</small><b class="num">${list.filter(t => t.type === type).length}</b></div>
    </section>
    <section class="card"><h3>${type === 'expense' ? 'รายจ่าย' : 'รายรับ'}รายวัน</h3>${dailyColumns(values, labels, baht, type)}</section>
    <section class="card"><h3>แยกตามหมวด</h3>${categoryBars(rows, baht, type)}</section>
    ${Object.keys(methods).length ? `<section class="card"><h3>ช่องทาง</h3><ul class="methods">${Object.entries(methods).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `<li><span>${METHODS[k] || k}</span><span class="num">${baht(v)}</span></li>`).join('')}</ul></section>` : ''}`;
}

function viewScan() {
  const sc = ui.scan;
  const hasKey = !!geminiKey();
  const selected = sc.items.filter(i => i.keep).length;
  const off = sc.busy || !hasKey ? 'disabled' : '';
  const tray = ui.tray;
  return `${header('อ่านสลิป')}
    ${!hasKey ? `<section class="card notice"><p>🔑 ต้องใส่ Gemini API key ก่อน (ฟรี) เพื่อให้จุกจิกอ่านสลิปได้</p>
      <button class="btn primary sm" data-action="goto-gemini">ไปใส่ key</button></section>` : ''}
    <section class="pick ${off}" data-drop>
      <label class="pick-main">
        <input type="file" accept="image/*" multiple data-input="pick" ${off}>
        <span class="pick-icon">🖼️</span>
        <span><b>เลือกรูปสลิป</b><small>เปิดแกลเลอรี แตะเลือกได้หลายรูป</small></span>
      </label>
      <div class="pick-row">
        <label class="pick-btn"><input type="file" accept="image/*" capture="environment" data-input="pick" ${off}>📸<span>ถ่ายรูป</span></label>
        <label class="pick-btn"><input type="file" accept="application/pdf,.pdf" multiple data-input="pick" ${off}>📄<span>ใบแจ้งยอด PDF</span></label>
        <button class="pick-btn" data-action="paste-img" ${off}>📋<span>วางรูป</span></button>
      </div>
      <small class="pick-hint">💡 ${/Android/.test(navigator.userAgent) ? 'แชร์รูปจากแกลเลอรี / LINE / แอปธนาคาร มาที่ “จุกจิก” ได้เลย (ติดตั้งแอปบนหน้าจอหลักก่อน)' : 'ลากรูปมาวาง หรือกด Ctrl+V เพื่อวางรูปได้เลย'}</small>
    </section>
    ${tray.length ? `<section class="tray">
      <div class="row between"><b>เลือกไว้ ${tray.length} ไฟล์</b><button class="link small" data-action="tray-clear">ล้าง</button></div>
      <div class="tray-grid">${tray.map((t, i) => `<figure>
        ${t.url ? `<img src="${t.url}" alt="">` : `<div class="tray-pdf">📄<small>${esc(t.file.name)}</small></div>`}
        <button class="tray-x" data-action="tray-remove" data-i="${i}" aria-label="เอาออก">×</button></figure>`).join('')}
        <label class="tray-add"><input type="file" accept="image/*" multiple data-input="pick">＋</label></div>
      <button class="btn primary big sticky" data-action="tray-read" ${off}>🐣 อ่าน ${tray.length} ${tray.length > 1 ? 'ไฟล์' : 'สลิป'}</button>
    </section>` : ''}
    ${ui.slipNote ? `<p class="muted small center" id="slip-note">${esc(ui.slipNote)}</p>` : ''}
    <label class="check"><input type="checkbox" data-input="only30" ${sc.only30 ? 'checked' : ''}> เลือกเฉพาะสลิป 30 วันล่าสุดให้อัตโนมัติ</label>
    ${sc.busy ? `<section class="card progress"><div class="spinner"></div><p>จุกจิกกำลังอ่าน… ${sc.done}/${sc.total}</p>
      <div class="meter"><div style="width:${sc.total ? sc.done / sc.total * 100 : 0}%"></div></div>
      <small class="muted" id="scan-note">${esc(scanNote())}</small>
      <button class="btn ghost sm" data-action="scan-cancel" ${sc.cancel ? 'disabled' : ''}>${sc.cancel ? 'กำลังยกเลิก…' : 'ยกเลิก'}</button></section>` : ''}
    ${sc.skipped.length ? `<section class="card notice"><p>⏭️ ข้าม <b>${sc.skipped.length}</b> สลิปที่เคยบันทึกแล้ว (ตรวจจาก QR บนสลิป ไม่ใช้โควตา Gemini)</p></section>` : ''}
    ${sc.errors.length ? `<section class="card error"><b>อ่านไม่สำเร็จ ${sc.errors.length} ไฟล์</b><ul>${sc.errors.map(e => `<li>${esc(e.name)}: ${esc(e.msg)}</li>`).join('')}</ul>
      ${!sc.busy && sc.errors.some(e => e.file) ? `<button class="btn primary sm" data-action="scan-retry">🔄 ลองอ่านไฟล์เหล่านี้อีกครั้ง</button>` : ''}</section>` : ''}
    ${sc.items.length ? `<section class="review">
      <div class="row between"><h3>ตรวจก่อนบันทึก (${sc.items.length})</h3>
        <button class="link" data-action="scan-clear">ล้าง</button></div>
      <ul>${sc.items.map((it, i) => reviewRow(it, i)).join('')}</ul>
      <button class="btn primary big sticky" data-action="scan-save" ${selected ? '' : 'disabled'}>บันทึก ${selected} รายการ</button>
    </section>` : ''}
    <section class="card tips"><h3>💡 เคล็ดลับ</h3><ul>
      <li>แอปธนาคารส่วนใหญ่บันทึกสลิปลงอัลบั้มให้อัตโนมัติ เปิดอัลบั้มนั้นแล้วเลือกหลายรูปได้เลย</li>
      <li>ใบแจ้งยอดบัตรเครดิตที่มีรหัส PDF ให้ปลดรหัสก่อน (เช่น เปิดแล้วสั่งพิมพ์เป็น PDF ใหม่)</li>
      <li>สลิปที่เคยบันทึกแล้วจะถูกทำเครื่องหมาย "ซ้ำ" และไม่ถูกเลือกให้</li>
    </ul><a class="link" href="guide.html#sec-slip">📖 ดูวิธีใช้แบบละเอียด</a></section>`;
}

function reviewRow(it, i) {
  const options = it.type === 'transfer' ? `<option value="transfer">🔄 ย้ายเงิน (ไม่นับรายรับ/รายจ่าย)</option>`
    : cats().filter(c => c.type === it.type).map(c => `<option value="${c.id}" ${c.id === it.cat ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('');
  return `<li class="rv ${it.keep ? '' : 'off'}">
    <label class="rv-check"><input type="checkbox" data-rv="keep" data-i="${i}" ${it.keep ? 'checked' : ''} aria-label="เลือกรายการ"></label>
    <div class="rv-body">
      <div class="row between"><b>${esc(it.merchant || it.fileName)}</b>
<span class="row gap">${it.qrRef ? '<span class="tag ok" title="เลขอ้างอิงยืนยันจาก QR บนสลิป">✓ QR</span>' : ''}
        ${it.dup ? '<span class="tag warn">ซ้ำ</span>' : it.old ? '<span class="tag">เกิน 30 วัน</span>' : ''}</span></div>
      <div class="rv-grid">
        <select data-rv="type" data-i="${i}" aria-label="ประเภท">${[['expense', 'รายจ่าย'], ['income', 'รายรับ'], ['transfer', 'ย้ายเงิน']]
          .map(([v, l]) => `<option value="${v}" ${it.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input type="number" inputmode="decimal" step="0.01" value="${it.amount}" data-rv="amount" data-i="${i}" aria-label="จำนวนเงิน">
        <select data-rv="cat" data-i="${i}" aria-label="หมวด">${options}</select>
        <input type="date" value="${it.date}" data-rv="date" data-i="${i}" aria-label="วันที่">
      </div>
      ${it.note ? `<small class="muted">${esc(it.note)}</small>` : ''}
    </div></li>`;
}

function viewSettings() {
  const cfg = S.getFirebaseConfig();
  const expCats = cats().filter(c => c.type === 'expense'), incCats = cats().filter(c => c.type === 'income');
  const catChips = list => list.map(c => `<button class="chip edit" data-action="cat-edit" data-id="${c.id}" aria-label="แก้ไขหมวด ${esc(c.name)}">${c.emoji} ${esc(c.name)} <i aria-hidden="true">✎</i></button>`).join('');
  const missingDefaults = S.DEFAULT_CATEGORIES.filter(d => !cats().some(c => c.id === d.id)).length;

  let account;
  if (!cfg) {
    account = `<p>ตอนนี้ข้อมูลเก็บ <b>ในเครื่องนี้เท่านั้น</b> หากต้องการซิงก์หลายเครื่อง ให้สร้างโปรเจกต์ Firebase (ฟรี) ตามคู่มือใน README แล้ววางค่า config ที่นี่</p>
      <details><summary>วางค่า Firebase config</summary>
        <textarea rows="7" data-input="fbcfg" placeholder='{"apiKey":"...","authDomain":"...","projectId":"...","appId":"..."}'></textarea>
        <button class="btn primary sm" data-action="fbcfg-save">บันทึกและเชื่อมต่อ</button>
      </details>`;
  } else if (state.user) {
    account = `<div class="row between"><div><b>${esc(state.user.name || state.user.email)}</b><br><small class="muted">${esc(state.user.email || '')}</small></div>
      <button class="btn ghost sm" data-action="signout">ออกจากระบบ</button></div>
      <p class="muted small">ล็อกอินบัญชีนี้บนเครื่องอื่น ข้อมูลจะตรงกันอัตโนมัติ · ใช้งานออฟไลน์ได้ แล้วซิงก์เมื่อกลับมาออนไลน์</p>`;
  } else {
    const up = ui.authMode === 'signup';
    account = `<form class="auth" data-form="auth">
        <input type="email" name="email" placeholder="อีเมล" autocomplete="email" required>
        <input type="password" name="pw" placeholder="รหัสผ่าน (6 ตัวขึ้นไป)" autocomplete="${up ? 'new-password' : 'current-password'}" minlength="6" required>
        ${ui.authError ? `<p class="err">${esc(ui.authError)}</p>` : ''}
        <button class="btn primary" ${ui.authBusy ? 'disabled' : ''}>${ui.authBusy ? 'กำลังดำเนินการ…' : up ? 'สมัครบัญชีใหม่' : 'เข้าสู่ระบบ'}</button>
        <button type="button" class="btn ghost" data-action="google">เข้าสู่ระบบด้วย Google</button>
        <div class="row between small"><button type="button" class="link" data-action="auth-mode">${up ? 'มีบัญชีแล้ว? เข้าสู่ระบบ' : 'ยังไม่มีบัญชี? สมัครใหม่'}</button>
        <button type="button" class="link" data-action="reset-pw">ลืมรหัสผ่าน</button></div>
      </form>
      ${state.syncStatus === 'error' ? `<p class="err">${esc(state.syncError)}</p>` : ''}`;
  }

  return `${header('ตั้งค่า')}
    <section class="card"><h3>🔄 บัญชีและการซิงก์</h3>${account}</section>

    ${geminiCard()}

    ${sheetCard()}
    ${state.isOwner ? ownerCard() : ''}

    <section class="card"><h3>🎯 งบประมาณรายเดือน</h3>
      <div class="row gap"><input type="number" inputmode="decimal" placeholder="เช่น 15000" value="${state.settings.budget || ''}" data-input="budget">
      <button class="btn primary sm" data-action="budget-save">บันทึก</button></div>
      <small class="muted">ใส่ 0 เพื่อปิดการแสดงงบ</small>
    </section>

    <section class="card" id="cats"><h3>🗂️ หมวดหมู่</h3>
      <p class="muted small">แตะหมวดเพื่อเปลี่ยนชื่อ อีโมจิ ลำดับ หรือลบ</p>
      <div class="row between"><small class="muted">รายจ่าย (${expCats.length})</small><button class="link small" data-action="cat-new" data-t="expense">+ เพิ่มหมวดรายจ่าย</button></div>
      <div class="chips">${catChips(expCats)}</div>
      <div class="row between"><small class="muted">รายรับ (${incCats.length})</small><button class="link small" data-action="cat-new" data-t="income">+ เพิ่มหมวดรายรับ</button></div>
      <div class="chips">${catChips(incCats)}</div>
      ${missingDefaults ? `<button class="link small" data-action="cat-restore">↺ คืนหมวดเริ่มต้นที่ลบไป (${missingDefaults})</button>` : ''}
    </section>

    <section class="card"><h3>🎨 ธีม</h3>
      <div class="seg">${[['auto', 'ตามเครื่อง'], ['light', 'สว่าง'], ['dark', 'มืด']].map(([k, l]) =>
        `<button aria-selected="${prefs.theme === k}" data-action="theme" data-t="${k}">${l}</button>`).join('')}</div>
    </section>

    <section class="card"><h3>💾 ข้อมูล</h3>
      <div class="row gap wrap">
        <button class="btn ghost sm" data-action="export-json">สำรอง (JSON)</button>
        <button class="btn ghost sm" data-action="export-csv">ส่งออก CSV</button>
        <label class="btn ghost sm">นำเข้า JSON<input type="file" accept="application/json" data-input="import" hidden></label>
      </div>
      <small class="muted">ทั้งหมด ${state.tx.length} รายการ</small>
    </section>

    <section class="card"><h3>📖 วิธีใช้งาน</h3>
      <p class="small">คู่มือทุกฟีเจอร์ ตั้งแต่ติดตั้ง อ่านสลิป บัตรเครดิต งบ ไปจนถึงซิงก์หลายเครื่อง</p>
      <div class="row gap wrap">
        <a class="btn primary sm" href="guide.html">เปิดคู่มือ</a>
        <a class="btn ghost sm" href="guide.html#sec-install">วิธีติดตั้ง</a>
      </div>
      <button class="link" data-action="show-ob">ดูหน้าแนะนำแอปอีกครั้ง</button>
    </section>
    <p class="center muted small pad">จุกจิก JukJik v1.0</p>`;
}

// ---------- access gate (email not verified / not on the allow list) ----------
function viewGate() {
  const email = esc(state.user?.email || '');
  const verify = state.access === 'verify';
  return `<section class="onboard gate">
    <div class="ob-art"><img src="icons/icon.svg" alt="" class="ob-chick"><span class="ob-emoji">${verify ? '📧' : '🔒'}</span></div>
    <h2>${verify ? 'ยืนยันอีเมลก่อนใช้งาน' : 'บัญชีนี้ยังไม่ได้รับอนุญาต'}</h2>
    ${verify
      ? `<p>จุกจิกส่งลิงก์ยืนยันไปที่ <b>${email}</b> แล้ว เปิดอีเมล (ดูในโฟลเดอร์สแปมด้วย) กดลิงก์ แล้วกลับมากดปุ่มด้านล่าง</p>
         <button class="btn primary big" data-action="gate-recheck">ยืนยันแล้ว เข้าใช้งาน</button>
         <button class="btn ghost" data-action="gate-resend">ส่งอีเมลยืนยันอีกครั้ง</button>`
      : `<p>แอปนี้เปิดให้เฉพาะคนที่เจ้าของแอปอนุญาต ส่งอีเมลนี้ให้เจ้าของแอปเพิ่มให้:</p>
         <p class="gate-email">${email}</p>
         <button class="btn primary big" data-action="gate-recheck">ได้รับอนุญาตแล้ว ลองอีกครั้ง</button>
         <button class="btn ghost" data-action="gate-copy">📋 คัดลอกอีเมล</button>`}
    <button class="link" data-action="signout">ออกจากระบบ / ใช้บัญชีอื่น</button>
    ${ui.gateMsg ? `<p class="small muted">${esc(ui.gateMsg)}</p>` : ''}
  </section>`;
}

// ---------- owner: who may use the app ----------
const APP_URL = 'https://tunsupakorn.github.io/jukjik/';
const TEMPLATE_URL = 'https://docs.google.com/spreadsheets/d/1IT8M4VotXmahde_1bo0Shdfwyem8lhZWQuTZL5uCnH8/copy';
function inviteText(name) {
  return `${name ? `สวัสดี ${name} ` : ''}ชวนมาใช้ "จุกจิก" แอปจดรายรับรายจ่าย อ่านสลิปให้อัตโนมัติ 🐣
1) เปิด ${APP_URL} แล้วติดตั้งลงหน้าจอ (วิธีติดตั้ง: ${APP_URL}guide.html#sec-install)
2) ตั้งค่า › สมัคร/เข้าสู่ระบบด้วย Google หรืออีเมลที่ให้ไว้
3) (ไม่บังคับ) อยากได้ Google Sheet ของตัวเอง: ${TEMPLATE_URL.includes('TEMPLATE_ID') ? APP_URL + 'guide.html#sheet-template' : TEMPLATE_URL}`;
}
function ownerCard() {
  const list = state.allowList;
  return `<section class="card" id="access"><h3>👥 ใครใช้แอปได้บ้าง</h3>
    <label class="check"><input type="checkbox" data-input="opensignup" ${state.openSignup ? 'checked' : ''}> เปิดให้ทุกคนที่มีลิงก์ใช้ได้</label>
    <p class="muted small">${state.openSignup ? '⚠️ ตอนนี้ใครก็สมัครใช้ได้ (ข้อมูลยังแยกกันของใครของมัน)' : `🔒 ใช้ได้เฉพาะคุณ และอีเมลด้านล่าง (${list.length})`}</p>
    <ul class="allow-list">${list.map(a => `<li><span><b>${esc(a.name || a.email)}</b>${a.name ? `<small>${esc(a.email)}</small>` : ''}</span>
      <span class="row gap"><button class="link small" data-action="allow-invite" data-e="${esc(a.email)}">ข้อความชวน</button>
      <button class="x" data-action="allow-remove" data-e="${esc(a.email)}" aria-label="เอาออก ${esc(a.email)}">×</button></span></li>`).join('')
      || '<li class="muted small">ยังไม่มีใคร เพิ่มอีเมลของคนที่จะชวนได้เลย</li>'}</ul>
    <form class="row gap wrap" data-form="allow">
      <input name="email" type="email" placeholder="อีเมลของคนที่ชวน" required class="grow" autocomplete="off">
      <input name="name" placeholder="ชื่อเล่น (ไม่บังคับ)" class="w-name" autocomplete="off">
      <button class="btn primary sm">อนุญาต</button>
    </form>
    <small class="muted">คนที่สมัครด้วยอีเมล+รหัสผ่านต้องกดยืนยันอีเมลก่อน · บัญชี Google ใช้ได้ทันที</small>
  </section>`;
}

function geminiCard() {
  const key = geminiKey();
  const synced = state.mode === 'cloud' && state.settings.geminiKey;
  const more = `<details class="more"><summary>ตั้งค่าเพิ่มเติม</summary>
      <label class="lbl">โมเดล<input type="text" value="${esc(prefs.geminiModel)}" data-input="gmodel"></label>
      <label class="lbl">ชื่อ-นามสกุลของคุณ ตามบัญชีธนาคาร (แอปจำจากสลิปให้เองได้)
        <input type="text" placeholder="เช่น ศุภกร นิตยวรรณ, Supakorn Nittayawan" value="${esc(state.settings.ownerNames || '')}" data-input="owner"></label>
      <div class="row gap wrap"><button class="btn ghost sm" data-action="owner-save">บันทึกชื่อ</button>
        ${key ? `<button class="btn ghost sm" data-action="gtest">ทดสอบ key</button><button class="btn ghost sm" data-action="gkey-change">เปลี่ยน key</button>` : ''}</div>
    </details>`;
  if (key && !ui.editKey) {
    return `<section class="card compact" id="gemini">
      <div class="row between"><h3>🔑 อ่านสลิป</h3><span class="ok-pill">✅ พร้อมใช้</span></div>
      <p class="muted small">${esc(prefs.geminiModel)} · ${synced ? 'key ซิงก์กับทุกเครื่องในบัญชีนี้แล้ว' : state.mode === 'cloud' ? 'key อยู่ในเครื่องนี้' : 'key อยู่ในเครื่องนี้ (ล็อกอินเพื่อใช้กับทุกเครื่อง)'}
        ${state.settings.ownerNames ? ` · ชื่อ: ${esc(state.settings.ownerNames)}` : ''}</p>
      ${more}
    </section>`;
  }
  return `<section class="card" id="gemini"><h3>🔑 ตั้งค่าอ่านสลิป (ทำครั้งเดียว)</h3>
    <ol class="steps">
      <li><a class="btn ghost sm" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">① เปิดหน้าสร้าง key ฟรี ↗</a>
        <small class="muted">กด “Create API key” แล้วกดคัดลอก</small></li>
      <li><button class="btn primary sm" data-action="gkey-paste">② 📋 วาง key จากคลิปบอร์ด</button>
        <small class="muted">แอปจะทดสอบให้เอง แล้วใช้กับทุกเครื่องที่ล็อกอินบัญชีนี้</small></li>
    </ol>
    <div class="row gap"><input type="password" class="grow" placeholder="หรือวาง key ที่นี่ (AIza…)" data-input="gkey" autocomplete="off">
      <button class="btn ghost sm" data-action="gkey-save">บันทึก</button></div>
    ${ui.keyMsg ? `<p class="small ${ui.keyMsg.startsWith('❌') ? 'err' : ''}">${esc(ui.keyMsg)}</p>` : ''}
    ${ui.editKey ? `<button class="link small" data-action="gkey-cancel">ยกเลิก</button>` : ''}
    ${more}
  </section>`;
}

async function saveGeminiKey(raw) {
  const key = String(raw || '').trim().replace(/\s+/g, '');
  if (!key) { ui.keyMsg = '❌ ไม่พบ key'; return render(); }
  if (!/^AIza[\w-]{20,}$/.test(key)) { ui.keyMsg = '❌ ดูไม่เหมือน Gemini API key (ควรขึ้นต้นด้วย AIza)'; return render(); }
  ui.keyMsg = '⏳ กำลังทดสอบ key…'; render();
  try {
    await testKey(key, prefs.geminiModel);
  } catch (e) { ui.keyMsg = '❌ ' + e.message; return render(); }
  S.savePrefs({ geminiKey: key });
  if (state.mode === 'cloud') S.saveSettings({ geminiKey: key });
  ui.keyMsg = ''; ui.editKey = false;
  toast(state.mode === 'cloud' ? '✅ key ใช้งานได้ และใช้กับทุกเครื่องแล้ว' : '✅ key ใช้งานได้');
  render();
}

function sheetCard() {
  if (!Sheet.isConnected()) {
    return `<section class="card" id="gsheet"><h3>📗 Google Sheet</h3>
      <p class="muted small">คัดลอกทุกรายการลง Google Sheet ของคุณอัตโนมัติ ไว้ดู ทำสูตร หรือทำกราฟ (ข้อมูลหลักยังอยู่ใน Firebase)</p>
      <input type="url" placeholder="วางลิงก์ web app (https://script.google.com/macros/s/…/exec)" data-input="sheeturl" autocomplete="off">
      <div class="row gap wrap" style="margin-top:10px">
        <button class="btn primary sm" data-action="sheet-connect">เชื่อมต่อ</button>
        <a class="link small" href="guide.html#sheet-setup">วิธีสร้างลิงก์ web app</a>
      </div>
      ${Sheet.sheet.status === 'error' ? `<p class="err">${esc(Sheet.sheet.msg)}</p>` : ''}
    </section>`;
  }
  const s = Sheet.sheet;
  const time = s.at ? new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit' }).format(s.at) : '';
  const line = s.status === 'syncing' ? '⏳ กำลังส่งข้อมูลลงชีต…'
    : s.status === 'ok' ? `✅ ซิงก์ลงชีตแล้ว ${time} น. · ${s.rows} รายการ`
    : s.status === 'error' ? `⚠️ ${esc(s.msg)}`
    : state.cloudConfigured && state.syncStatus !== 'synced' ? '⏸️ รอซิงก์กับบัญชีให้เสร็จก่อน แล้วจะส่งลงชีตให้'
    : '🟢 เชื่อมต่อแล้ว ข้อมูลจะถูกส่งลงชีตอัตโนมัติเมื่อมีการเปลี่ยนแปลง';
  const slips = state.settings.saveSlips !== false;
  return `<section class="card compact" id="gsheet">
    <div class="row between"><h3>📗 Google Sheet & Drive</h3>${s.status === 'error' ? '<span class="tag warn">มีปัญหา</span>' : '<span class="ok-pill">✅ เชื่อมแล้ว</span>'}</div>
    <p class="small ${s.status === 'error' ? 'err' : 'muted'}">${line}${slips ? ' · เก็บสลิปใน Drive' : ''}</p>
    <div class="row gap wrap">
      ${Sheet.sheetUrl() ? `<a class="btn ghost sm" href="${esc(Sheet.sheetUrl())}" target="_blank" rel="noopener">📗 เปิดชีต</a>` : ''}
      ${Sheet.slipFolderUrl() ? `<a class="btn ghost sm" href="${esc(Sheet.slipFolderUrl())}" target="_blank" rel="noopener">📁 โฟลเดอร์สลิป</a>` : ''}
    </div>
    <details class="more"><summary>ตั้งค่าเพิ่มเติม</summary>
      <label class="check"><input type="checkbox" data-input="saveslips" ${slips ? 'checked' : ''}> เก็บรูปสลิปไว้ใน Google Drive (โฟลเดอร์ “จุกจิก JukJik — สลิป” แยกตามเดือน)</label>
      <div class="row gap wrap">
        <button class="btn ghost sm" data-action="sheet-sync" ${s.status === 'syncing' ? 'disabled' : ''}>ซิงก์ตอนนี้</button>
        <button class="btn ghost sm" data-action="sheet-disconnect">ยกเลิกการเชื่อม</button>
      </div>
    </details>
  </section>`;
}

// ---------- category editor ----------
let catDraft = null;
function openCatEditor(id, type) {
  const c = id && cats().find(x => x.id === id);
  catDraft = c ? { ...c, isNew: false } : { id: 'c_' + S.newId(), name: '', emoji: type === 'income' ? '💰' : '🏷️', type, isNew: true };
  renderCatEditor();
  if (!$('#sheet').open) $('#sheet').showModal();
}
function renderCatEditor() {
  const d = catDraft;
  const same = cats().filter(c => c.type === d.type);
  const pos = same.findIndex(c => c.id === d.id);
  const used = state.tx.filter(t => t.cat === d.id).length;
  $('#sheet').innerHTML = `<form method="dialog" class="sheet-body" data-form="cat-edit">
    <div class="grab" aria-hidden="true"></div>
    <div class="row between"><h2>${d.isNew ? 'เพิ่มหมวด' : 'แก้ไขหมวด'}${d.type === 'income' ? 'รายรับ' : 'รายจ่าย'}</h2>
      <button type="button" class="icon-btn" data-action="close-sheet" aria-label="ปิด">✕</button></div>
    <div class="row gap">
      <input class="w-emoji ce-emoji" value="${esc(d.emoji)}" data-ce="emoji" maxlength="8" aria-label="อีโมจิ">
      <input class="grow" value="${esc(d.name)}" data-ce="name" placeholder="ชื่อหมวด เช่น ค่าเทอมลูก" required maxlength="30" aria-label="ชื่อหมวด">
    </div>
    <div class="emoji-grid" role="group" aria-label="เลือกอีโมจิ">${EMOJIS.map(e => `<button type="button" class="${e === d.emoji ? 'on' : ''}" data-action="ce-emoji" data-e="${e}">${e}</button>`).join('')}</div>
    ${d.isNew ? '' : `<div class="row between">
      <small class="muted">ลำดับ ${pos + 1} จาก ${same.length}${used ? ` · ใช้อยู่ ${used} รายการ` : ''}</small>
      <div class="row gap"><button type="button" class="btn ghost sm" data-action="ce-move" data-d="-1" ${pos <= 0 ? 'disabled' : ''}>‹ เลื่อนก่อน</button>
      <button type="button" class="btn ghost sm" data-action="ce-move" data-d="1" ${pos >= same.length - 1 ? 'disabled' : ''}>เลื่อนหลัง ›</button></div></div>`}
    <div class="row gap">
      ${d.isNew ? '' : `<button type="button" class="btn danger" data-action="ce-delete">ลบหมวด</button>`}
      <button type="submit" class="btn primary big grow">${d.isNew ? 'เพิ่มหมวด' : 'บันทึก'}</button>
    </div>
  </form>`;
}
function deleteCategory(id) {
  const c = cats().find(x => x.id === id);
  const same = cats().filter(x => x.type === c.type && x.id !== id);
  if (!same.length) return toast('ต้องมีอย่างน้อย 1 หมวด');
  const other = same.find(x => x.id === (c.type === 'income' ? 'inc_other' : 'exp_other')) || same[same.length - 1];
  const used = state.tx.filter(t => t.cat === id);
  const msg = used.length ? `ลบหมวด "${c.name}"? รายการ ${used.length} รายการในหมวดนี้จะย้ายไปหมวด "${other.name}"` : `ลบหมวด "${c.name}"?`;
  if (!confirm(msg)) return;
  if (used.length) S.saveMany(used.map(t => ({ ...t, cat: other.id })));
  S.saveSettings({ categories: cats().filter(x => x.id !== id) });
  $('#sheet').close();
  toast('ลบหมวดแล้ว');
}
function moveCategory(id, dir) {
  const list = [...cats()];
  const i = list.findIndex(c => c.id === id);
  let j = i + dir;
  while (j >= 0 && j < list.length && list[j].type !== list[i].type) j += dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  S.saveSettings({ categories: list });
  renderCatEditor();
}

// ---------- add / edit sheet ----------
let draft = null;
function openSheet(tx) {
  draft = tx ? { ...tx } : { type: 'expense', amount: '', cat: 'food', date: todayISO(), note: '', method: 'cash', source: 'manual' };
  renderSheet();
  $('#sheet').showModal();
  if (!tx) setTimeout(() => $('#sheet [data-d="amount"]')?.focus(), 60);
}
function renderSheet() {
  const d = draft;
  const list = d.type === 'transfer' ? [] : cats().filter(c => c.type === d.type);
  if (d.type === 'transfer') d.cat = 'transfer';
  else if (!list.some(c => c.id === d.cat)) d.cat = list[0]?.id;
  $('#sheet').innerHTML = `<form method="dialog" class="sheet-body" data-form="tx">
    <div class="grab" aria-hidden="true"></div>
    <div class="row between"><h2>${d.id ? 'แก้ไขรายการ' : 'จดรายการใหม่'}</h2><button type="button" class="icon-btn" data-action="close-sheet" aria-label="ปิด">✕</button></div>
    <div class="seg ${d.type}">
      <button type="button" aria-selected="${d.type === 'expense'}" data-action="d-type" data-t="expense">รายจ่าย</button>
      <button type="button" aria-selected="${d.type === 'income'}" data-action="d-type" data-t="income">รายรับ</button>
      <button type="button" aria-selected="${d.type === 'transfer'}" data-action="d-type" data-t="transfer">ย้ายเงิน</button>
    </div>
    <label class="amount ${d.type}"><span>฿</span><input type="number" inputmode="decimal" step="0.01" min="0" placeholder="0" value="${d.amount}" data-d="amount" required aria-label="จำนวนเงิน"></label>
    ${d.type === 'transfer'
      ? `<p class="g-note">🔄 โอนระหว่างบัญชีของคุณเอง หรือชำระบัตรเครดิต · <b>ไม่นับ</b>เป็นรายรับหรือรายจ่าย</p>`
      : `<div class="cat-grid">${list.map(c => `<button type="button" class="cat ${c.id === d.cat ? 'on' : ''}" data-action="d-cat" data-id="${c.id}">
      <span>${c.emoji}</span><small>${esc(c.name)}</small></button>`).join('')}</div>`}
    <div class="row gap">
      <label class="lbl grow">วันที่<input type="date" value="${d.date}" data-d="date" required></label>
      <label class="lbl grow">ช่องทาง<select data-d="method">${Object.entries(METHODS).map(([k, l]) => `<option value="${k}" ${d.method === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <label class="lbl">โน้ต<input type="text" value="${esc(d.note || '')}" placeholder="เช่น ข้าวมันไก่ร้านประจำ" data-d="note"></label>
    ${d.merchant ? `<small class="muted">ผู้รับ: ${esc(d.merchant)}${d.ref ? ' · อ้างอิง ' + esc(d.ref) : ''}</small>` : ''}
    ${/^https:\/\/drive\.google\.com\//.test(d.slipUrl || '') ? `<a class="btn ghost sm" href="${esc(d.slipUrl)}" target="_blank" rel="noopener">📎 ดูสลิปใน Google Drive</a>` : ''}
    <div class="row gap">
      ${d.id ? `<button type="button" class="btn danger" data-action="d-delete">ลบ</button>` : ''}
      <button type="submit" class="btn primary big grow">บันทึก</button>
    </div>
  </form>`;
}

// ---------- scan ----------
function isDup(it, existing) {
  return existing.some(t => (it.qrRef && t.qrRef === it.qrRef) || (it.ref && t.ref && t.ref === it.ref) ||
    (t.date === it.date && Number(t.amount) === Number(it.amount) && t.type === it.type && (t.merchant || '') === (it.merchant || '') && (t.time || '') === (it.time || '')));
}
// ---------- picking slips: tray with thumbnails ----------
const OK_FILE = f => /^image\//.test(f.type) || f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
function addToTray(files) {
  const add = [...files].filter(OK_FILE)
    .filter(f => !ui.tray.some(t => t.file.name === f.name && t.file.size === f.size && t.file.lastModified === f.lastModified));
  if (!add.length) { if (files.length) toast('รองรับเฉพาะรูปภาพและ PDF'); return; }
  ui.tray.push(...add.map(file => ({ file, url: /^image\//.test(file.type) ? URL.createObjectURL(file) : '' })));
  if (ui.view !== 'scan') ui.view = 'scan';
  render();
}
function clearTray(keep = []) {
  ui.tray.forEach(t => { if (!keep.includes(t) && t.url) URL.revokeObjectURL(t.url); });
  ui.tray = keep;
}
async function pasteFromClipboard() {
  try {
    const items = await navigator.clipboard.read();
    const files = [];
    for (const it of items) {
      const type = it.types.find(t => /^image\//.test(t));
      if (type) { const b = await it.getType(type); files.push(new File([b], `วาง-${Date.now()}.${type.split('/')[1]}`, { type })); }
    }
    files.length ? addToTray(files) : toast('ไม่มีรูปในคลิปบอร์ด');
  } catch { toast('วางรูปไม่ได้ ลองกดค้างในช่องแล้วเลือก “วาง” หรือใช้ปุ่มเลือกรูป'); }
}
document.addEventListener('paste', e => {
  if (ui.view !== 'scan' || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addToTray(files); }
});
document.addEventListener('dragover', e => { if (e.target.closest?.('[data-drop]')) { e.preventDefault(); e.target.closest('[data-drop]').classList.add('over'); } });
document.addEventListener('dragleave', e => e.target.closest?.('[data-drop]')?.classList.remove('over'));
document.addEventListener('drop', e => {
  const zone = e.target.closest?.('[data-drop]');
  if (!zone) return;
  e.preventDefault(); zone.classList.remove('over');
  addToTray(e.dataTransfer?.files || []);
});

// Files shared to the app (Android share sheet → "จุกจิก"): the service worker parks them in a cache.
async function takeSharedFiles() {
  if (!new URLSearchParams(location.search).has('shared')) return;
  history.replaceState(null, '', location.pathname);
  try {
    const cache = await caches.open('jukjik-share');
    const keys = await cache.keys();
    const files = [];
    for (const req of keys) {
      const res = await cache.match(req);
      const blob = await res.blob();
      const name = decodeURIComponent(res.headers.get('x-name') || 'slip.jpg');
      files.push(new File([blob], name, { type: blob.type || res.headers.get('content-type') || 'image/jpeg' }));
      await cache.delete(req);
    }
    if (files.length) { ui.view = 'scan'; addToTray(files); toast(`รับ ${files.length} ไฟล์จากการแชร์แล้ว`); }
  } catch (e) { console.warn('share', e); }
}

// Upload saved slips to Google Drive in the background, then link each entry to its file.
let slipQueue = Promise.resolve();
function uploadSlips(pairs) {
  if (!pairs.length) return;
  slipQueue = slipQueue.then(async () => {
    let ok = 0, fail = 0;
    for (const { tx, file } of pairs) {
      try {
        const r = await Sheet.uploadSlip(file, tx, catById(tx.cat).name);
        const cur = state.tx.find(t => t.id === tx.id) || tx;
        S.saveTx({ ...cur, slipUrl: r.url, slipId: r.id });
        ok++;
      } catch (e) { fail++; console.warn('slip upload', e); ui.slipError = e.message; }
      ui.slipNote = `กำลังเก็บสลิปเข้า Google Drive ${ok + fail}/${pairs.length}`;
      if (ui.view === 'scan') { const el = $('#slip-note'); if (el) el.textContent = ui.slipNote; }
    }
    ui.slipNote = '';
    toast(fail ? `เก็บสลิปเข้า Drive ได้ ${ok}/${pairs.length} (${ui.slipError})` : `📁 เก็บสลิปเข้า Google Drive แล้ว ${ok} รูป`);
    if (ui.view === 'scan') render();
  });
}

// When a slip shows a transfer between your own accounts with an unmasked name, remember that name.
function learnOwnerName(list) {
  if (String(state.settings.ownerNames || '').trim()) return;
  const t = list.find(x => x.type === 'transfer' && x.merchant && !/[*xX]{2,}/.test(x.merchant) && /\s/.test(x.merchant.trim()));
  if (!t) return;
  const name = t.merchant.replace(/^(นาย|นางสาว|นาง|น\.ส\.)\s*/, '').trim();
  S.saveSettings({ ownerNames: name });
  toast(`จำชื่อของคุณแล้ว: ${name}`);
}

const scanNote = () => `${ui.scan.note || 'ปกติใช้เวลา 5–20 วินาทีต่อใบ'} · ${Math.round((Date.now() - (ui.scan.started || Date.now())) / 1000)} วินาที`;

async function runScan(files) {
  const sc = ui.scan;
  Object.assign(sc, { busy: true, done: 0, total: files.length, errors: [], skipped: [], note: '', cancel: false, started: Date.now() });
  resetCancel();
  render();
  const ticker = setInterval(() => { const el = $('#scan-note'); if (el) el.textContent = scanNote(); }, 1000);
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  const cutISO = new Date(cutoff - cutoff.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const queue = [...files];
  const opts = { key: geminiKey(), model: prefs.geminiModel, categories: cats(), today: todayISO(), ownerNames: ownerNames() };
  const seenQR = new Set(sc.items.map(i => i.qrRef).filter(Boolean));
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      if (sc.cancel) { sc.errors.push({ name: f.name, msg: 'ยกเลิกแล้ว', file: f }); sc.done++; continue; }
      sc.note = '';
      try {
        // free on-device QR check first: a slip already saved is skipped without calling Gemini
        const qr = await readSlipQR(f);
        if (qr && (seenQR.has(qr.key) || state.tx.some(t => t.qrRef === qr.key))) {
          sc.skipped.push(f.name); sc.done++; render(); continue;
        }
        if (qr) seenQR.add(qr.key);
        const found = await readFile(f, opts);
        if (!found.length) sc.errors.push({ name: f.name, msg: 'ไม่พบรายการเงินในไฟล์นี้', file: f });
        if (qr && found[0]) Object.assign(found[0], { qrRef: qr.key, ref: found[0].ref || qr.ref });
        if (found[0]) found[0].file = f; // the slip image goes to Drive with its main entry
        found.forEach(t => {
          const it = { ...t, fileName: f.name };
          it.dup = isDup(it, state.tx) || isDup(it, sc.items);
          it.old = it.source === 'slip' && it.date < cutISO;
          it.keep = !it.dup && !(sc.only30 && it.old);
          sc.items.push(it);
        });
      } catch (e) { sc.errors.push({ name: f.name, msg: e.message, file: f }); }
      sc.done++;
      render();
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  clearInterval(ticker);
  sc.items.sort((a, b) => b.date.localeCompare(a.date));
  Object.assign(sc, { busy: false, note: '', cancel: false });
  render();
}

// ---------- export / import ----------
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- render ----------
function render() {
  const app = $('#app');
  const onboarding = !prefs.onboarded;
  const gated = state.mode === 'cloud' && state.access !== 'ok';
  document.body.classList.toggle('no-nav', onboarding || gated);
  if (gated && !onboarding) { $('#app').innerHTML = viewGate(); return; }
  const keepScroll = window.scrollY;
  const active = document.activeElement;
  const focusKey = active?.dataset?.input;
  app.innerHTML = onboarding ? viewOnboarding()
    : ui.view === 'stats' ? viewStats() : ui.view === 'scan' ? viewScan() : ui.view === 'settings' ? viewSettings() : viewHome();
  document.querySelectorAll('.tabbar [data-nav]').forEach(b => b.classList.toggle('on', b.dataset.nav === ui.view));
  bindColumnTips(app);
  if (focusKey === 'search') { const el = $('[data-input="search"]'); el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); }
  window.scrollTo(0, keepScroll);
}

function go(view) { ui.view = view; window.scrollTo(0, 0); render(); }

// ---------- events ----------
document.addEventListener('click', async e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { if ($('#sheet').open) $('#sheet').close(); return go(nav.dataset.nav); }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  switch (a) {
    case 'add': return openSheet();
    case 'edit': return openSheet(state.tx.find(t => t.id === el.dataset.id));
    case 'close-sheet': return $('#sheet').close();
    case 'month': {
      const [y, m] = ui.month.split('-').map(Number);
      const d = new Date(y, m - 1 + Number(el.dataset.d), 1);
      ui.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return render();
    }
    case 'stats-type': ui.statsType = el.dataset.t; return render();
    case 'd-type': draft.type = el.dataset.t; return renderSheet();
    case 'd-cat': draft.cat = el.dataset.id; return renderSheet();
    case 'd-delete':
      if (confirm('ลบรายการนี้?')) { S.deleteTx(draft.id); $('#sheet').close(); toast('ลบแล้ว'); }
      return;
    case 'ob-next': ui.obStep++; return render();
    case 'ob-done': S.savePrefs({ onboarded: true }); return go('home');
    case 'ob-sync': S.savePrefs({ onboarded: true }); return go('settings');
    case 'show-ob': ui.obStep = 0; S.savePrefs({ onboarded: false }); window.scrollTo(0, 0); return render();
    case 'goto-gemini': go('settings'); return $('#gemini')?.scrollIntoView({ behavior: 'smooth' });
    case 'scan-clear': Object.assign(ui.scan, { items: [], errors: [], skipped: [] }); return render();
    case 'scan-cancel': ui.scan.cancel = true; cancelAll(); return render();
    case 'tray-read': { const files = ui.tray.map(t => t.file); clearTray(); if (files.length) runScan(files); return; }
    case 'tray-remove': { const t = ui.tray.splice(Number(el.dataset.i), 1)[0]; if (t?.url) URL.revokeObjectURL(t.url); return render(); }
    case 'tray-clear': clearTray(); return render();
    case 'paste-img': return pasteFromClipboard();
    case 'scan-retry': { const files = ui.scan.errors.map(e => e.file).filter(Boolean); if (files.length) runScan(files); return; }
    case 'scan-save': {
      const chosen = ui.scan.items.filter(i => i.keep);
      const pairs = chosen.map(({ keep, dup, old, fileName, file, ...t }) => ({ tx: { ...t, id: t.id || S.newId() }, file }));
      const n = await S.saveMany(pairs.map(p => p.tx));
      ui.scan.items = ui.scan.items.filter(i => !i.keep);
      toast(`บันทึก ${n} รายการแล้ว 🐣`);
      if (pairs[0]) ui.month = pairs[0].tx.date.slice(0, 7);
      learnOwnerName(pairs.map(p => p.tx));
      render();
      if (Sheet.saveSlipsOn()) uploadSlips(pairs.filter(p => p.file));
      return;
    }
    case 'upload-local': { const n = await S.uploadLocalToCloud(); return toast(`อัปขึ้นบัญชีแล้ว ${n} รายการ`); }
    case 'discard-local': if (confirm('ไม่อัปข้อมูลในเครื่องนี้? (ข้อมูลในเครื่องจะถูกลบ)')) S.discardLocalPending(); return;
    case 'auth-mode': ui.authMode = ui.authMode === 'signin' ? 'signup' : 'signin'; ui.authError = ''; return render();
    case 'google':
      try { await S.signInGoogle(); ui.authError = ''; toast('เข้าสู่ระบบแล้ว'); } catch (err) { ui.authError = err.message; render(); }
      return;
    case 'reset-pw': {
      const email = $('[data-form="auth"] [name="email"]')?.value;
      if (!email) { ui.authError = 'กรอกอีเมลก่อน แล้วกด "ลืมรหัสผ่าน"'; return render(); }
      try { await S.resetPassword(email); toast('ส่งลิงก์ตั้งรหัสใหม่ไปที่อีเมลแล้ว'); } catch (err) { ui.authError = err.message; render(); }
      return;
    }
    case 'signout': if (confirm('ออกจากระบบในเครื่องนี้?')) await S.signOut(); return;
    case 'gate-recheck':
      ui.gateMsg = 'กำลังตรวจสอบ…'; render();
      try { await S.recheckAccess(); ui.gateMsg = state.access === 'ok' ? '' : (state.access === 'verify' ? 'ยังไม่ได้ยืนยันอีเมล ลองกดลิงก์ในอีเมลก่อน' : 'ยังไม่ได้รับอนุญาต'); }
      catch (err) { ui.gateMsg = err.message; }
      return render();
    case 'gate-resend':
      try { await S.resendVerification(); ui.gateMsg = 'ส่งอีเมลยืนยันอีกครั้งแล้ว'; } catch (err) { ui.gateMsg = err.message; }
      return render();
    case 'gate-copy':
      try { await navigator.clipboard.writeText(state.user?.email || ''); toast('คัดลอกอีเมลแล้ว'); } catch { toast(state.user?.email || ''); }
      return;
    case 'allow-remove':
      if (!confirm(`เอา ${el.dataset.e} ออกจากรายชื่อ? (ข้อมูลของเขายังอยู่ แต่จะเข้าใช้ไม่ได้)`)) return;
      try { await S.removeEmail(el.dataset.e); toast('เอาออกแล้ว'); } catch (err) { toast('❌ ' + err.message); }
      return;
    case 'allow-invite': {
      const a = state.allowList.find(x => x.email === el.dataset.e);
      const text = inviteText(a?.name);
      try { if (navigator.share) await navigator.share({ title: 'ชวนใช้จุกจิก', text }); else { await navigator.clipboard.writeText(text); toast('คัดลอกข้อความชวนแล้ว ส่งทาง LINE ได้เลย'); } }
      catch (err) { if (err?.name !== 'AbortError') { try { await navigator.clipboard.writeText(text); toast('คัดลอกข้อความชวนแล้ว'); } catch { prompt('คัดลอกข้อความนี้', text); } } }
      return;
    }
    case 'fbcfg-save': {
      const raw = $('[data-input="fbcfg"]').value.trim();
      try {
        const jsonish = raw.replace(/^[^{]*/, '').replace(/[^}]*$/, '').replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*}/, '}');
        const cfg = JSON.parse(jsonish);
        if (!cfg.apiKey || !cfg.projectId) throw new Error();
        S.setFirebaseConfig(cfg); toast('บันทึกแล้ว กำลังเชื่อมต่อ…'); setTimeout(() => location.reload(), 600);
      } catch { toast('รูปแบบ config ไม่ถูกต้อง'); }
      return;
    }
    case 'gtest':
      if (!geminiKey()) return toast('ใส่ key ก่อน');
      toast('กำลังทดสอบ…');
      try { await testKey(geminiKey(), prefs.geminiModel); toast('✅ key ใช้งานได้'); } catch (err) { toast('❌ ' + err.message); }
      return;
    case 'gkey-paste': {
      let text = '';
      try { text = await navigator.clipboard.readText(); } catch { ui.keyMsg = '❌ อ่านคลิปบอร์ดไม่ได้ วาง key ในช่องด้านล่างแทน'; return render(); }
      return saveGeminiKey(text);
    }
    case 'gkey-save': return saveGeminiKey($('[data-input="gkey"]')?.value);
    case 'gkey-change': ui.editKey = true; ui.keyMsg = ''; return render();
    case 'gkey-cancel': ui.editKey = false; ui.keyMsg = ''; return render();
    case 'sheet-connect': {
      const url = $('[data-input="sheeturl"]').value;
      el.disabled = true; el.textContent = 'กำลังเชื่อมต่อ…';
      try { await Sheet.connect(url); toast('เชื่อม Google Sheet แล้ว 📗'); }
      catch (err) { Sheet.sheet.status = 'error'; Sheet.sheet.msg = err.message; render(); }
      return;
    }
    case 'sheet-sync':
      if (state.cloudConfigured && state.syncStatus !== 'synced') return toast('รอซิงก์กับบัญชีให้เสร็จก่อน');
      return Sheet.syncNow(true);
    case 'sheet-disconnect':
      if (confirm('ยกเลิกการเชื่อม Google Sheet? (ข้อมูลในชีตเดิมยังอยู่ แต่จะไม่อัปเดตอีก)')) { Sheet.disconnect(); toast('ยกเลิกการเชื่อมแล้ว'); }
      return;
    case 'budget-save': S.saveSettings({ budget: Math.max(0, Number($('[data-input="budget"]').value) || 0) }); return toast('บันทึกงบแล้ว');
    case 'cat-edit': return openCatEditor(el.dataset.id);
    case 'cat-new': return openCatEditor(null, el.dataset.t);
    case 'ce-emoji': catDraft.emoji = el.dataset.e; return renderCatEditor();
    case 'ce-move': return moveCategory(catDraft.id, Number(el.dataset.d));
    case 'ce-delete': return deleteCategory(catDraft.id);
    case 'cat-restore': {
      const list = [...cats()];
      S.DEFAULT_CATEGORIES.forEach(d => { if (!list.some(c => c.id === d.id)) list.push({ ...d }); });
      S.saveSettings({ categories: list });
      return toast('คืนหมวดเริ่มต้นแล้ว');
    }
    case 'owner-save': S.saveSettings({ ownerNames: $('[data-input="owner"]').value.trim() }); return toast('บันทึกชื่อแล้ว');
    case 'theme': S.savePrefs({ theme: el.dataset.t }); applyTheme(); return render();
    case 'export-json':
      return download(`jukjik-backup-${todayISO()}.json`, JSON.stringify({ app: 'jukjik', version: 1, tx: state.tx, settings: state.settings }, null, 2), 'application/json');
    case 'export-csv': {
      const head = 'date,type,amount,category,method,merchant,note';
      const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [...state.tx].sort((a, b) => a.date.localeCompare(b.date))
        .map(t => [t.date, t.type, t.amount, catById(t.cat).name, t.method, t.merchant, t.note].map(q).join(','));
      return download(`jukjik-${todayISO()}.csv`, '﻿' + [head, ...rows].join('\n'), 'text/csv');
    }
  }
});

document.addEventListener('submit', async e => {
  const f = e.target.dataset.form;
  if (!f) return;
  e.preventDefault();
  if (f === 'tx') {
    const amount = Number(draft.amount);
    if (!(amount > 0)) return toast('ใส่จำนวนเงินก่อน');
    S.saveTx({ ...draft, amount: Math.round(amount * 100) / 100 });
    ui.month = draft.date.slice(0, 7);
    $('#sheet').close();
    toast(draft.id ? 'แก้ไขแล้ว' : 'จดแล้ว 🐣');
  } else if (f === 'auth') {
    const fd = new FormData(e.target);
    ui.authBusy = true; ui.authError = ''; render();
    try {
      await (ui.authMode === 'signup' ? S.signUp : S.signIn)(fd.get('email'), fd.get('pw'));
      toast('เข้าสู่ระบบแล้ว');
    } catch (err) { ui.authError = err.message; }
    ui.authBusy = false; render();
  } else if (f === 'allow') {
    const fd = new FormData(e.target);
    try {
      await S.allowEmail(fd.get('email'), fd.get('name'));
      toast(`อนุญาต ${String(fd.get('email')).trim().toLowerCase()} แล้ว · กด “ข้อความชวน” เพื่อส่งลิงก์`);
      e.target.reset();
    } catch (err) { toast('❌ ' + err.message); }
  } else if (f === 'cat-edit') {
    const d = catDraft;
    d.name = d.name.trim();
    if (!d.name) return toast('ใส่ชื่อหมวดก่อน');
    if (cats().some(c => c.id !== d.id && c.type === d.type && c.name === d.name)) return toast('มีหมวดชื่อนี้แล้ว');
    const item = { id: d.id, name: d.name, emoji: d.emoji.trim() || '🏷️', type: d.type };
    const list = d.isNew ? [...cats(), item] : cats().map(c => c.id === d.id ? item : c);
    S.saveSettings({ categories: list });
    $('#sheet').close();
    toast(d.isNew ? 'เพิ่มหมวดแล้ว' : 'บันทึกหมวดแล้ว');
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.d) { draft[t.dataset.d] = t.value; return; }
  if (t.dataset.ce) { catDraft[t.dataset.ce] = t.value; return; }
  if (t.dataset.rv) {
    const it = ui.scan.items[+t.dataset.i];
    const k = t.dataset.rv;
    if (k === 'keep') { it.keep = t.checked; render(); }
    else if (k === 'amount') it.amount = Number(t.value);
    else if (k === 'type') { it.type = t.value; it.cat = it.type === 'transfer' ? 'transfer' : it.type === 'income' ? 'inc_other' : 'exp_other'; render(); }
    else it[k] = t.value;
    return;
  }
  switch (t.dataset.input) {
    case 'search': ui.search = t.value; return render();
    case 'gkey': {
      const v = t.value.trim();
      if (/^AIza[\w-]{30,}$/.test(v)) saveGeminiKey(v); // pasted a full key: test & save right away
      return;
    }
    case 'gmodel': return S.savePrefs({ geminiModel: t.value.trim() || DEFAULT_MODEL });
  }
});

document.addEventListener('change', async e => {
  const t = e.target;
  switch (t.dataset.input) {
    case 'saveslips': S.saveSettings({ saveSlips: t.checked }); return toast(t.checked ? 'จะเก็บสลิปไว้ใน Google Drive' : 'ปิดการเก็บสลิปแล้ว');
    case 'opensignup':
      if (t.checked && !confirm('เปิดให้ทุกคนที่มีลิงก์สมัครใช้ได้? (ข้อมูลยังแยกกันของใครของมัน)')) { t.checked = false; return; }
      try { await S.setOpenSignup(t.checked); toast(t.checked ? 'เปิดให้ทุกคนใช้ได้แล้ว' : 'จำกัดเฉพาะอีเมลที่อนุญาตแล้ว'); } catch (err) { toast('❌ ' + err.message); }
      return;
    case 'only30':
      ui.scan.only30 = t.checked;
      ui.scan.items.forEach(it => { if (!it.dup) it.keep = !(t.checked && it.old); });
      return render();
    case 'files': { const files = [...t.files]; t.value = ''; if (files.length) runScan(files); return; }
    case 'pick': { const files = [...t.files]; t.value = ''; addToTray(files); return; }
    case 'import': {
      const file = t.files[0]; t.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.tx)) throw new Error();
        if (!confirm(`นำเข้า ${data.tx.length} รายการ? (รายการที่มี id เดียวกันจะถูกแทนที่)`)) return;
        await S.saveMany(data.tx);
        if (data.settings?.categories) S.saveSettings({ categories: data.settings.categories, budget: data.settings.budget || 0 });
        toast(`นำเข้าแล้ว ${data.tx.length} รายการ`);
      } catch { toast('ไฟล์ไม่ถูกต้อง'); }
    }
  }
});

// close sheet when tapping the backdrop
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') e.target.close(); });

// ---------- boot ----------
applyTheme();
setModelChangeHandler(m => {
  S.savePrefs({ geminiModel: m });
  const el = $('[data-input="gmodel"]'); if (el) el.value = m;
  toast(`เปลี่ยนเป็นโมเดล ${m} ให้อัตโนมัติ`);
});
setFallbackHandler(m => toast(`รุ่นหลักคนใช้เยอะ ใช้ ${m} แทนชั่วคราว`));
setStatusHandler(msg => { ui.scan.note = msg; if (ui.view === 'scan') render(); });
Sheet.onSheetChange(() => { if (ui.view === 'settings') render(); });
S.subscribe(() => {
  // a key saved only on this device (older version) is shared to the account once it is synced
  if (prefs.geminiKey && state.mode === 'cloud' && state.syncStatus === 'synced' && !state.settings.geminiKey) S.saveSettings({ geminiKey: prefs.geminiKey });
  render(); Sheet.schedule();
});
render();
S.initStore();
takeSharedFiles();
if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('sw.js').catch(() => {});
