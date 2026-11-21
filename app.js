import * as S from './store.js';
import { readFile, testKey, DEFAULT_MODEL, setModelChangeHandler, setFallbackHandler, setStatusHandler, cancelAll, resetCancel } from './gemini.js';
import { categoryBars, dailyColumns, bindColumnTips } from './charts.js';
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
  authBusy: false,
  authError: '',
  obStep: 0,
  book: prefs.book || 'personal', // current book on this device, or 'all'
  setBook: '',                     // book whose categories/budget the settings page edits
  scanBook: '',                    // book that read slips are saved into
};

// ---- books (ส่วนตัว / ร้าน / ลงทุน …): each has its own categories and budget ----
const books = () => state.settings.books?.length ? state.settings.books : [S.newBook('personal')];
const bookById = id => books().find(b => b.id === id) || null;
const txBook = t => t.book || 'personal';
const isAll = () => ui.book === 'all';
const workBook = () => (!isAll() && bookById(ui.book)) || books()[0];   // book for new entries
const bookLabel = id => { const b = bookById(id); return b ? `${b.emoji} ${b.name}` : 'ไม่ระบุบัญชี'; };
const cats = (bookId = workBook().id) => bookById(bookId)?.categories || S.DEFAULT_CATEGORIES;
function saveBook(id, patch) { S.saveSettings({ books: books().map(b => b.id === id ? { ...b, ...patch } : b) }); }
// Gemini key: this device first, else the one synced with your account (enter once, every device gets it)
const geminiKey = () => prefs.geminiKey || state.settings.geminiKey || '';
const TRANSFER_CAT ={ id: 'transfer', name: 'ย้ายเงิน', emoji: '🔄', type: 'transfer' };
const catById = (id, bookId) => id === 'transfer' ? TRANSFER_CAT : cats(bookId).find(c => c.id === id) || { id, name: 'ไม่ระบุ', emoji: '❔', type: 'expense' };
const SIGN = { expense: '−', income: '+', transfer: '↔ ' };
const EMOJIS = ['🍜', '🍱', '🧋', '☕', '🍺', '🛒', '🛍️', '👕', '💄', '🚕', '🚗', '⛽', '🏍️', '🚇', '✈️', '🏠', '⚡', '🚰', '🌐', '📱', '🧾', '💊', '🏥', '🐶', '👶', '🎮', '🎬', '🎵', '📚', '🎓', '🏋️', '💇', '🎁', '❤️', '🙏', '💼', '🏪', '📈', '💰', '🔁', '🏦', '💳', '🧴', '🧹', '🔧', '📦'];
// owner names for spotting transfers between your own accounts: what you typed + your account name
const ownerNames = () => [...String(state.settings.ownerNames || '').split(/[,\n]/), state.user?.name || '']
  .map(s => s.trim()).filter(s => s.length > 1);
// entries of the month in the current book (a move between books shows in both), or in every book
const inBook = t => isAll() || txBook(t) === ui.book || t.toBook === ui.book;
const monthTx = () => state.tx.filter(t => t.date?.startsWith(ui.month) && inBook(t));
// money moved between books, seen from the current book: +1 in / -1 out (0 in the all-books view)
const moveDir = t => t.type !== 'transfer' || !t.toBook || t.toBook === txBook(t) || isAll() ? 0 : t.toBook === ui.book ? 1 : -1;
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
  'signed-out': ['ยังไม่ล็อกอิน', 'warn'], pending: ['กำลังซิงก์…', 'pending'],
  synced: ['ซิงก์แล้ว', 'ok'], error: ['ซิงก์ผิดพลาด', 'bad'],
};
function header(title) {
  const [label, cls] = SYNC[state.syncStatus] || SYNC['signed-out'];
  return `<header class="top">
    <div class="brand"><img src="icons/icon-192.png" alt="" width="40" height="40"><div><h1>${title || 'TSK-MoneyNote'}</h1><small>จดรายรับรายจ่าย</small></div></div>
    <button class="sync ${cls}" data-nav="settings" title="สถานะการซิงก์"><i></i>${label}</button>
  </header>`;
}
function bookBar() {
  if (books().length < 2) return '';
  const chip = (id, label) => `<button class="book-chip ${ui.book === id ? 'on' : ''}" data-action="book" data-b="${esc(id)}">${label}</button>`;
  return `<nav class="book-bar" aria-label="เลือกบัญชี">${chip('all', '📚 รวม')}${books().map(b => chip(b.id, `${b.emoji} ${esc(b.name)}`)).join('')}</nav>`;
}
function monthSwitch() {
  return `<div class="month">
    <button class="icon-btn" data-action="month" data-d="-1" aria-label="เดือนก่อน">‹</button>
    <strong>${monthLabel(ui.month)}</strong>
    <button class="icon-btn" data-action="month" data-d="1" aria-label="เดือนถัดไป">›</button>
  </div>`;
}
function txRow(t) {
  const c = catById(t.cat, txBook(t));
  const cross = t.type === 'transfer' && t.toBook && t.toBook !== txBook(t);
  const where = cross ? `${bookLabel(txBook(t))} → ${bookLabel(t.toBook)}` : isAll() && books().length > 1 ? bookLabel(txBook(t)) : '';
  const sub = [where, t.merchant, t.note].filter(Boolean).join(' · ');
  const dir = moveDir(t);
  const sign = dir > 0 ? '+' : dir < 0 ? '−' : SIGN[t.type] || '';
  return `<li><button class="tx" data-action="edit" data-id="${esc(t.id)}">
    <span class="bubble" aria-hidden="true">${c.emoji}</span>
    <span class="tx-main"><b>${esc(c.name)}</b><small>${esc(sub || METHODS[t.method] || '')}</small></span>
    <span class="tx-amt num ${dir > 0 ? 'income' : dir < 0 ? 'expense' : t.type}">${t.hasSlip || t.slipUrl ? '<i class="clip" title="มีรูปสลิป">📎</i>' : ''}${sign}${baht(t.amount)}</span>
  </button></li>`;
}

// ---------- views ----------
function viewOnboarding() {
  const steps = [
    { e: '👋', h: 'สวัสดี! ฉันคือ TSK-MoneyNote', p: 'ผู้ช่วยจดรายรับรายจ่ายของคุณ เรื่องเงินจุกจิกแค่ไหน ฉันก็จดให้ครบ' },
    { e: '🧾', h: 'ส่งสลิปมา ฉันอ่านให้', p: 'เลือกรูปสลิปโอนเงินย้อนหลังได้ทีละหลายใบ (สูงสุด 30 วัน) อ่านได้ทุกธนาคาร รวมถึงใบแจ้งยอดบัตรเครดิต PDF' },
    { e: '🔄', h: 'ซิงก์ทุกเครื่อง', p: 'มือถือ แท็บเล็ต กี่เครื่องก็ได้ ล็อกอินบัญชีเดียว ข้อมูลตรงกันทันที ไม่ต้องใช้เบอร์มือถือหรือ OTP' },
    { e: '📊', h: 'รู้ว่าเงินไปไหน', p: 'สรุปรายวัน รายเดือน แยกหมวด พร้อมตั้งงบไม่ให้ใช้เกิน' },
  ];
  const s = steps[ui.obStep];
  const last = ui.obStep === steps.length - 1;
  return `<section class="onboard">
    <button class="link skip" data-action="ob-done">ข้าม</button>
    <div class="ob-art"><img src="icons/icon-512.png" alt="" class="ob-logo"><span class="ob-emoji">${s.e}</span></div>
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
  const moveIn = list.filter(t => moveDir(t) > 0).reduce((a, t) => a + Number(t.amount || 0), 0);
  const moveOut = list.filter(t => moveDir(t) < 0).reduce((a, t) => a + Number(t.amount || 0), 0);
  const balance = inc - exp + moveIn - moveOut;
  const budget = isAll() ? 0 : Number(workBook().budget || 0);
  const q = ui.search.trim().toLowerCase();
  const shown = list.filter(t => !q || [catById(t.cat, txBook(t)).name, t.merchant, t.note, String(t.amount)].join(' ').toLowerCase().includes(q))
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

  return `${header()}${bookBar()}${monthSwitch()}
    <section class="hero">
      <span class="hero-label">คงเหลือ${books().length > 1 ? ` · ${isAll() ? '📚 รวมทุกบัญชี' : bookLabel(ui.book)}` : ''}</span>
      <div class="hero-num num">${balance < 0 ? '−' : ''}${baht(Math.abs(balance))}</div>
      <div class="hero-split">
        <div><small>รายรับ</small><b class="num">${baht(inc)}</b></div>
        <div><small>รายจ่าย</small><b class="num">${baht(exp)}</b></div>
      </div>
      ${moveIn || moveOut ? `<small class="hero-move">ย้ายระหว่างบัญชี${moveIn ? ` · เข้า +${baht(moveIn)}` : ''}${moveOut ? ` · ออก −${baht(moveOut)}` : ''}</small>` : ''}
      <img src="icons/icon-512.png" alt="" class="hero-logo">
    </section>
    ${budgetCard}
    ${list.length ? `<label class="search"><span aria-hidden="true">🔍</span><input type="search" placeholder="ค้นหารายการ" value="${esc(ui.search)}" data-input="search"></label>` : ''}
    ${Object.keys(groups).length ? Object.entries(groups).map(([d, items]) => `
      <section class="day">
        <div class="day-head"><span>${dayLabel(d)}</span><span class="num">${sum(items, 'expense') ? '−' + baht(sum(items, 'expense')) : ''}</span></div>
        <ul class="txs">${items.map(txRow).join('')}</ul>
      </section>`).join('')
    : `<section class="empty">
        <img src="icons/icon-512.png" alt="" width="96" height="96">
        <h3>${q ? 'ไม่พบรายการที่ค้นหา' : 'ยังไม่มีรายการเดือนนี้'}</h3>
        ${q ? '' : `<p>กดปุ่มเหลือง <b>🧾 อ่านสลิป</b> ตรงกลาง หรือ <b>✏️ จดเอง</b></p>
        <button class="btn primary" data-nav="scan">🧾 อ่านสลิป</button>`}
      </section>`}`;
}

function viewStats() {
  const list = monthTx();
  const type = ui.statsType;
  const byCat = {};
  list.filter(t => t.type === type).forEach(t => { const k = txBook(t) + '|' + t.cat; byCat[k] = (byCat[k] || 0) + Number(t.amount); });
  const rows = Object.entries(byCat).map(([k, amount]) => {
    const [b, id] = k.split('|'); const c = catById(id, b);
    return { ...c, id: k, name: isAll() && books().length > 1 ? `${bookById(b)?.emoji || ''} ${c.name}` : c.name, amount };
  }).sort((a, b) => b.amount - a.amount);
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

  return `${header('สรุป')}${bookBar()}${monthSwitch()}
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
    ${!hasKey ? `<section class="card notice"><p>🔑 ต้องใส่ Gemini API key ก่อน (ฟรี) เพื่อให้ TSK-MoneyNote อ่านสลิปได้</p>
      <button class="btn primary sm" data-action="goto-gemini">ไปใส่ key</button></section>` : ''}
    ${books().length > 1 ? `<label class="lbl scan-book">จดลงบัญชี<select data-input="scanbook">${books().map(b =>
      `<option value="${esc(b.id)}" ${b.id === scanBook() ? 'selected' : ''}>${b.emoji} ${esc(b.name)}</option>`).join('')}</select></label>` : ''}
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
      <small class="pick-hint">💡 ${/Android/.test(navigator.userAgent) ? 'แชร์รูปจากแกลเลอรี / LINE / แอปธนาคาร มาที่ “TSK-MoneyNote” ได้เลย (ติดตั้งแอปบนหน้าจอหลักก่อน)' : 'ลากรูปมาวาง หรือกด Ctrl+V เพื่อวางรูปได้เลย'}</small>
    </section>
    ${tray.length ? `<section class="tray">
      <div class="row between"><b>เลือกไว้ ${tray.length} ไฟล์</b><button class="link small" data-action="tray-clear">ล้าง</button></div>
      <div class="tray-grid">${tray.map((t, i) => `<figure>
        ${t.url ? `<img src="${t.url}" alt="">` : `<div class="tray-pdf">📄<small>${esc(t.file.name)}</small></div>`}
        <button class="tray-x" data-action="tray-remove" data-i="${i}" aria-label="เอาออก">×</button></figure>`).join('')}
        <label class="tray-add"><input type="file" accept="image/*" multiple data-input="pick">＋</label></div>
      <button class="btn primary big sticky" data-action="tray-read" ${off}>🧾 อ่าน ${tray.length} ${tray.length > 1 ? 'ไฟล์' : 'สลิป'}</button>
    </section>` : ''}
    <label class="check"><input type="checkbox" data-input="only30" ${sc.only30 ? 'checked' : ''}> เลือกเฉพาะสลิป 30 วันล่าสุดให้อัตโนมัติ</label>
    ${sc.busy ? `<section class="card progress"><div class="spinner"></div><p>TSK-MoneyNote กำลังอ่าน… ${sc.done}/${sc.total}</p>
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

function scanBook() { return bookById(ui.scanBook)?.id || workBook().id; }
function reviewRow(it, i) {
  const options = it.type === 'transfer' ? `<option value="transfer">🔄 ย้ายเงิน (ไม่นับรายรับ/รายจ่าย)</option>`
    : cats(scanBook()).filter(c => c.type === it.type).map(c => `<option value="${c.id}" ${c.id === it.cat ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('');
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
      <input type="text" class="rv-note" value="${esc(it.note || '')}" placeholder="หมายเหตุ (ไม่บังคับ)" data-rv="note" data-i="${i}" aria-label="หมายเหตุ">
    </div></li>`;
}

function setBook() { return bookById(ui.setBook) || workBook(); }
function viewSettings() {
  const sb = setBook();
  const expCats = cats(sb.id).filter(c => c.type === 'expense'), incCats = cats(sb.id).filter(c => c.type === 'income');
  const bookPick = books().length > 1 ? `<label class="lbl">บัญชี<select data-input="setbook">${books().map(b =>
    `<option value="${esc(b.id)}" ${b.id === sb.id ? 'selected' : ''}>${b.emoji} ${esc(b.name)}</option>`).join('')}</select></label>` : '';
  const catChips = list => list.map(c => `<button class="chip edit" data-action="cat-edit" data-id="${c.id}" aria-label="แก้ไขหมวด ${esc(c.name)}">${c.emoji} ${esc(c.name)} <i aria-hidden="true">✎</i></button>`).join('');
  const presets = (S.BOOK_KINDS[sb.kind] || S.BOOK_KINDS.personal).categories;
  const missingDefaults = presets.filter(d => !cats(sb.id).some(c => c.id === d.id)).length;

  const account = `<div class="row between"><div><b>${esc(state.user.name || state.user.email)}</b><br><small class="muted">${esc(state.user.email || '')}</small></div>
      <button class="btn ghost sm" data-action="signout">ออกจากระบบ</button></div>
      <p class="muted small">ล็อกอินบัญชีนี้บนเครื่องอื่น ข้อมูลจะตรงกันอัตโนมัติ · ใช้งานออฟไลน์ได้ แล้วซิงก์เมื่อกลับมาออนไลน์</p>`;

  return `${header('ตั้งค่า')}
    <section class="card"><h3>🔄 บัญชีและการซิงก์</h3>${account}</section>

    ${geminiCard()}


    <section class="card" id="books"><h3>📚 บัญชี</h3>
      <p class="muted small">แยกจดได้หลายบัญชี เช่น ส่วนตัว ร้าน ลงทุน · แต่ละบัญชีมีหมวดและงบของตัวเอง แตะเพื่อเปลี่ยนชื่อหรือลบ</p>
      <div class="chips">${books().map(b => `<button class="chip edit" data-action="book-edit" data-b="${esc(b.id)}">${b.emoji} ${esc(b.name)}
        <small class="muted">${state.tx.filter(t => txBook(t) === b.id).length}</small> <i aria-hidden="true">✎</i></button>`).join('')}</div>
      <div class="row gap wrap">${Object.entries(S.BOOK_KINDS).map(([k, v]) =>
        `<button class="btn ghost sm" data-action="book-new" data-k="${k}">+ ${v.emoji} บัญชี${k === 'personal' ? 'ทั่วไป' : v.name}</button>`).join('')}</div>
    </section>

    <section class="card"><h3>🎯 งบประมาณรายเดือน</h3>
      ${bookPick}
      <div class="row gap"><input type="number" inputmode="decimal" placeholder="เช่น 15000" value="${sb.budget || ''}" data-input="budget">
      <button class="btn primary sm" data-action="budget-save">บันทึก</button></div>
      <small class="muted">งบของบัญชี ${esc(sb.emoji + ' ' + sb.name)} · ใส่ 0 เพื่อปิดการแสดงงบ</small>
    </section>

    <section class="card" id="cats"><h3>🗂️ หมวดหมู่</h3>
      ${bookPick}
      <p class="muted small">หมวดของบัญชี ${esc(sb.emoji + ' ' + sb.name)} · แตะหมวดเพื่อเปลี่ยนชื่อ อีโมจิ ลำดับ หรือลบ</p>
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
      <small class="muted">ทั้งหมด ${state.tx.length} รายการ · มีรูปสลิป ${state.tx.filter(t => t.hasSlip).length} รายการ</small>
      <label class="check"><input type="checkbox" data-input="keepslips" ${state.settings.keepSlips !== false ? 'checked' : ''}> เก็บรูปสลิปไว้ในแอปตอนอ่านสลิป (ซิงก์ทุกเครื่อง กดดูได้จากรายการ)</label>
    </section>

    <section class="card"><h3>📖 วิธีใช้งาน</h3>
      <p class="small">คู่มือทุกฟีเจอร์ ตั้งแต่ติดตั้ง อ่านสลิป บัตรเครดิต งบ ไปจนถึงซิงก์หลายเครื่อง</p>
      <div class="row gap wrap">
        <a class="btn primary sm" href="guide.html">เปิดคู่มือ</a>
        <a class="btn ghost sm" href="guide.html#sec-install">วิธีติดตั้ง</a>
      </div>
      <button class="link" data-action="show-ob">ดูหน้าแนะนำแอปอีกครั้ง</button>
    </section>
    <p class="center muted small pad">TSK-MoneyNote v1.0</p>`;
}

// ---------- sign-in gate: the app is private to the owner's account ----------
function viewGate() {
  const email = esc(state.user?.email || '');
  if (state.access === 'private') {
    return `<section class="onboard gate">
      <div class="ob-art"><img src="icons/icon-512.png" alt="" class="ob-logo"><span class="ob-emoji">🔒</span></div>
      <h2>แอปส่วนตัว</h2>
      <p>TSK-MoneyNote นี้ใช้ได้เฉพาะบัญชีของเจ้าของเท่านั้น<br>ตอนนี้ล็อกอินอยู่ด้วย <b>${email}</b></p>
      <button class="btn primary big" data-action="signout-now">ออกจากระบบ แล้วล็อกอินบัญชีเจ้าของ</button>
    </section>`;
  }
  return `<section class="onboard gate">
    <div class="ob-art"><img src="icons/icon-512.png" alt="" class="ob-logo"><span class="ob-emoji">🔐</span></div>
    <h2>เข้าสู่ระบบ TSK-MoneyNote</h2>
    <p>แอปส่วนตัว · ล็อกอินด้วยบัญชีเดียวกันทุกเครื่อง ข้อมูลซิงก์ถึงกันหมด</p>
    <button class="btn primary big" data-action="google">เข้าสู่ระบบด้วย Google</button>
    <details class="more"><summary>เข้าสู่ระบบด้วยอีเมล</summary>
      <form class="auth" data-form="auth">
        <input type="email" name="email" placeholder="อีเมล" autocomplete="email" required>
        <input type="password" name="pw" placeholder="รหัสผ่าน" autocomplete="current-password" required>
        <button class="btn ghost" ${ui.authBusy ? 'disabled' : ''}>${ui.authBusy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}</button>
      </form>
    </details>
    ${ui.authError ? `<p class="err">${esc(ui.authError)}</p>` : ''}
    ${state.syncStatus === 'error' ? `<p class="err">${esc(state.syncError)}</p>` : ''}
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


// ---------- category editor ----------
let catDraft = null;
function openCatEditor(id, type) {
  const bookId = setBook().id;
  const c = id && cats(bookId).find(x => x.id === id);
  catDraft = c ? { ...c, bookId, isNew: false } : { id: 'c_' + S.newId(), name: '', emoji: type === 'income' ? '💰' : '🏷️', type, bookId, isNew: true };
  renderCatEditor();
  if (!$('#sheet').open) $('#sheet').showModal();
}
function renderCatEditor() {
  const d = catDraft;
  const same = cats(d.bookId).filter(c => c.type === d.type);
  const pos = same.findIndex(c => c.id === d.id);
  const used = state.tx.filter(t => t.cat === d.id && txBook(t) === d.bookId).length;
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
function deleteCategory(id, bookId) {
  const c = cats(bookId).find(x => x.id === id);
  const same = cats(bookId).filter(x => x.type === c.type && x.id !== id);
  if (!same.length) return toast('ต้องมีอย่างน้อย 1 หมวด');
  const other = same.find(x => x.id === (c.type === 'income' ? 'inc_other' : 'exp_other')) || same[same.length - 1];
  const used = state.tx.filter(t => t.cat === id && txBook(t) === bookId);
  const msg = used.length ? `ลบหมวด "${c.name}"? รายการ ${used.length} รายการในหมวดนี้จะย้ายไปหมวด "${other.name}"` : `ลบหมวด "${c.name}"?`;
  if (!confirm(msg)) return;
  if (used.length) S.saveMany(used.map(t => ({ ...t, cat: other.id })));
  saveBook(bookId, { categories: cats(bookId).filter(x => x.id !== id) });
  $('#sheet').close();
  toast('ลบหมวดแล้ว');
}
function moveCategory(id, dir, bookId) {
  const list = [...cats(bookId)];
  const i = list.findIndex(c => c.id === id);
  let j = i + dir;
  while (j >= 0 && j < list.length && list[j].type !== list[i].type) j += dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  saveBook(bookId, { categories: list });
  renderCatEditor();
}

// ---------- book editor ----------
let bookDraft = null;
function openBookEditor(id, kind) {
  const b = id && bookById(id);
  bookDraft = b ? { id: b.id, name: b.name, emoji: b.emoji, isNew: false }
    : { ...S.newBook(kind, 'b_' + S.newId()), isNew: true };
  renderBookEditor();
  if (!$('#sheet').open) $('#sheet').showModal();
}
function renderBookEditor() {
  const d = bookDraft;
  const used = d.isNew ? 0 : state.tx.filter(t => txBook(t) === d.id || t.toBook === d.id).length;
  $('#sheet').innerHTML = `<form method="dialog" class="sheet-body" data-form="book-edit">
    <div class="grab" aria-hidden="true"></div>
    <div class="row between"><h2>${d.isNew ? 'เพิ่มบัญชี' : 'แก้ไขบัญชี'}</h2>
      <button type="button" class="icon-btn" data-action="close-sheet" aria-label="ปิด">✕</button></div>
    <div class="row gap">
      <input class="w-emoji ce-emoji" value="${esc(d.emoji)}" data-be="emoji" maxlength="8" aria-label="อีโมจิ">
      <input class="grow" value="${esc(d.name)}" data-be="name" placeholder="ชื่อบัญชี เช่น ร้านกาแฟ" required maxlength="30" aria-label="ชื่อบัญชี">
    </div>
    <div class="emoji-grid" role="group" aria-label="เลือกอีโมจิ">${['👤', '🏪', '📈', '☕', '🍜', '🛍️', '🏠', '🚗', '👨‍👩‍👧', '🎓', '💼', '🐷', '🏦', '💳', '🌾', '🛠️']
      .map(e => `<button type="button" class="${e === d.emoji ? 'on' : ''}" data-action="be-emoji" data-e="${e}">${e}</button>`).join('')}</div>
    ${d.isNew ? '<p class="muted small">บัญชีใหม่จะมีหมวดเริ่มต้นตามประเภทที่เลือก แก้ได้ภายหลังในการ์ดหมวดหมู่</p>'
      : `<small class="muted">${used ? `มี ${used} รายการในบัญชีนี้ · ลบบัญชีได้เมื่อไม่มีรายการแล้ว` : 'ยังไม่มีรายการในบัญชีนี้'}</small>`}
    <div class="row gap">
      ${d.isNew || books().length < 2 ? '' : `<button type="button" class="btn danger" data-action="book-delete" ${used ? 'disabled' : ''}>ลบบัญชี</button>`}
      <button type="submit" class="btn primary big grow">${d.isNew ? 'เพิ่มบัญชี' : 'บันทึก'}</button>
    </div>
  </form>`;
}

// ---------- add / edit sheet ----------
let draft = null;
function openSheet(tx) {
  draft = tx ? { ...tx, book: txBook(tx) } : { type: 'expense', amount: '', cat: 'food', date: todayISO(), note: '', method: 'cash', source: 'manual', book: workBook().id };
  renderSheet();
  $('#sheet').showModal();
  if (!tx) setTimeout(() => $('#sheet [data-d="amount"]')?.focus(), 60);
}
function renderSheet() {
  const d = draft;
  const list = d.type === 'transfer' ? [] : cats(d.book).filter(c => c.type === d.type);
  const bookOpts = (sel, skip) => books().filter(b => b.id !== skip).map(b => `<option value="${esc(b.id)}" ${b.id === sel ? 'selected' : ''}>${b.emoji} ${esc(b.name)}</option>`).join('');
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
      ? `<p class="g-note">🔄 โอนระหว่างบัญชีธนาคารของคุณเอง หรือชำระบัตรเครดิต · <b>ไม่นับ</b>เป็นรายรับหรือรายจ่าย${books().length > 1 ? ' · ถ้าย้ายเงินไปอีกบัญชีในแอป เลือกปลายทางด้านล่าง' : ''}</p>`
      : `<div class="cat-grid">${list.map(c => `<button type="button" class="cat ${c.id === d.cat ? 'on' : ''}" data-action="d-cat" data-id="${c.id}">
      <span>${c.emoji}</span><small>${esc(c.name)}</small></button>`).join('')}</div>`}
    ${books().length > 1 ? `<div class="row gap">
      <label class="lbl grow">${d.type === 'transfer' ? 'จากบัญชี' : 'บัญชี'}<select data-d="book">${bookOpts(d.book)}</select></label>
      ${d.type === 'transfer' ? `<label class="lbl grow">ไปบัญชี<select data-d="toBook"><option value="">ภายในบัญชีเดียวกัน</option>${bookOpts(d.toBook, d.book)}</select></label>` : ''}
    </div>` : ''}
    <div class="row gap">
      <label class="lbl grow">วันที่<input type="date" value="${d.date}" data-d="date" required></label>
      <label class="lbl grow">ช่องทาง<select data-d="method">${Object.entries(METHODS).map(([k, l]) => `<option value="${k}" ${d.method === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <label class="lbl">โน้ต<input type="text" value="${esc(d.note || '')}" placeholder="เช่น ข้าวมันไก่ร้านประจำ" data-d="note"></label>
    ${d.merchant ? `<small class="muted">ผู้รับ: ${esc(d.merchant)}${d.ref ? ' · อ้างอิง ' + esc(d.ref) : ''}</small>` : ''}
    ${slipControls(d)}
    <div class="row gap">
      ${d.id ? `<button type="button" class="btn danger" data-action="d-delete">ลบ</button>` : ''}
      <button type="submit" class="btn primary big grow">บันทึก</button>
    </div>
  </form>`;
}

// Slip on an entry: view, attach, replace or remove. A new photo is saved when the entry is saved.
function slipControls(d) {
  const hasOld = d.hasSlip && !d.removeSlip;
  const drive = /^https:\/\/drive\.google\.com\//.test(d.slipUrl || '')
    ? `<a class="btn ghost sm" href="${esc(d.slipUrl)}" target="_blank" rel="noopener">📎 ดูใน Google Drive</a>` : '';
  const pick = label => `<label class="btn ghost sm">${label}<input type="file" accept="image/*" data-input="slip-attach" hidden></label>`;
  let body;
  if (d.slipFile) {
    body = `<span class="small">📎 ${esc(d.slipFile.name || 'รูปสลิป')} <span class="muted">· บันทึกเมื่อกด “บันทึก”</span></span>
      ${pick('เลือกรูปใหม่')}<button type="button" class="link small" data-action="slip-unpick">ไม่แนบ</button>`;
  } else if (hasOld) {
    body = `<button type="button" class="btn ghost sm" data-action="view-slip" data-id="${esc(d.id)}">🧾 ดูสลิป</button>
      ${pick('🔄 เปลี่ยนสลิป')}<button type="button" class="link small" data-action="slip-remove">ลบสลิป</button>`;
  } else {
    body = `${pick('📎 แนบสลิป')}${d.removeSlip ? '<span class="small muted">จะลบสลิปเมื่อกด “บันทึก”</span>' : ''}`;
  }
  return `<div class="slip-row row gap wrap">${body}${drive}</div>`;
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

// Files shared to the app (Android share sheet → "TSK-MoneyNote"): the service worker parks them in a cache.
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

// Show a kept slip image full screen.
let slipViewUrl = '';
async function viewSlip(id) {
  const dlg = $('#slipview');
  if (slipViewUrl) { URL.revokeObjectURL(slipViewUrl); slipViewUrl = ''; }
  dlg.innerHTML = `<div class="slip-view"><button type="button" class="icon-btn" data-action="close-slip" aria-label="ปิด">✕</button><div class="spinner"></div></div>`;
  dlg.showModal();
  try {
    slipViewUrl = await S.loadSlipImage(id);
    if (!dlg.open) return;
    dlg.querySelector('.slip-view').innerHTML = `<button type="button" class="icon-btn" data-action="close-slip" aria-label="ปิด">✕</button>` +
      (slipViewUrl ? `<img src="${slipViewUrl}" alt="รูปสลิป">` : '<p class="muted">ไม่พบรูปสลิปของรายการนี้</p>');
  } catch (e) {
    dlg.querySelector('.slip-view').innerHTML = `<button type="button" class="icon-btn" data-action="close-slip" aria-label="ปิด">✕</button><p class="err">โหลดรูปไม่ได้: ${esc(e.message)}</p>`;
  }
}

// Shrink a slip photo to a sharp-enough JPEG that fits well inside a Firestore document (aim ≤ 250KB).
async function compressSlip(file) {
  const bmp = await createImageBitmap(file);
  const toJpeg = (c, q) => new Promise(r => c.toBlob(r, 'image/jpeg', q));
  let max = 1400, best = null;
  for (let round = 0; round < 3; round++, max = Math.round(max * 0.8)) {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.75, 0.6, 0.45]) {
      const blob = await toJpeg(c, q);
      best = { blob, width: c.width, height: c.height };
      if (blob.size <= 250 * 1024) return best;
    }
  }
  if (best.blob.size > 900 * 1024) throw new Error('รูปใหญ่เกินไป');
  return best;
}

// Keep saved slip photos in Firestore in the background (PDF statements are not kept).
let keepQueue = Promise.resolve();
function keepSlips(pairs, announce = false) {
  pairs = pairs.filter(p => /^image\//.test(p.file?.type || ''));
  if (!pairs.length) return;
  keepQueue = keepQueue.then(async () => {
    let ok = 0, fail = 0, lastErr = '';
    for (const { tx, file } of pairs) {
      try { await S.saveSlipImage(tx.id, await compressSlip(file)); ok++; }
      catch (e) { fail++; lastErr = e.message; console.warn('keep slip', e); }
    }
    if (fail) toast(`เก็บรูปสลิปได้ ${ok}/${pairs.length} (${lastErr})`);
    else if (announce) toast('📎 แนบสลิปแล้ว');
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
  const opts = { key: geminiKey(), model: prefs.geminiModel, categories: cats(scanBook()), today: todayISO(), ownerNames: ownerNames() };
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
        if (found[0]) found[0].file = f; // the slip image is kept with its main entry
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
  if (!isAll() && !bookById(ui.book)) ui.book = books()[0].id; // book removed or not synced yet
  const onboarding = !prefs.onboarded;
  // private app: nothing is shown until the owner's account is signed in
  const gated = state.mode !== 'cloud' || state.access !== 'ok';
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
    case 'view-slip': return viewSlip(el.dataset.id);
    case 'slip-unpick': delete draft.slipFile; return renderSheet();
    case 'slip-remove': draft.removeSlip = true; delete draft.slipFile; return renderSheet();
    case 'close-slip': return $('#slipview').close();
    case 'month': {
      const [y, m] = ui.month.split('-').map(Number);
      const d = new Date(y, m - 1 + Number(el.dataset.d), 1);
      ui.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return render();
    }
    case 'stats-type': ui.statsType = el.dataset.t; return render();
    case 'book': ui.book = el.dataset.b; S.savePrefs({ book: ui.book }); return render();
    case 'book-new': return openBookEditor(null, el.dataset.k);
    case 'book-edit': return openBookEditor(el.dataset.b);
    case 'be-emoji': bookDraft.emoji = el.dataset.e; return renderBookEditor();
    case 'book-delete': {
      const b = bookById(bookDraft.id);
      if (!b || state.tx.some(t => txBook(t) === b.id || t.toBook === b.id)) return toast('ยังมีรายการในบัญชีนี้');
      if (!confirm(`ลบบัญชี "${b.name}"?`)) return;
      S.saveSettings({ books: books().filter(x => x.id !== b.id) });
      if (ui.book === b.id) { ui.book = books()[0].id; S.savePrefs({ book: ui.book }); }
      $('#sheet').close();
      return toast('ลบบัญชีแล้ว');
    }
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
      const pairs = chosen.map(({ keep, dup, old, fileName, file, ...t }) => ({ tx: { ...t, book: scanBook(), id: t.id || S.newId() }, file }));
      const n = await S.saveMany(pairs.map(p => p.tx));
      ui.scan.items = ui.scan.items.filter(i => !i.keep);
      toast(`บันทึก ${n} รายการแล้ว ✅`);
      if (pairs[0]) ui.month = pairs[0].tx.date.slice(0, 7);
      learnOwnerName(pairs.map(p => p.tx));
      render();
      if (S.canKeepSlips() && state.settings.keepSlips !== false) keepSlips(pairs.filter(p => p.file));
      return;
    }
    case 'google':
      try { await S.signInGoogle(); ui.authError = ''; toast('เข้าสู่ระบบแล้ว'); } catch (err) { ui.authError = err.message; render(); }
      return;
    case 'signout': if (confirm('ออกจากระบบในเครื่องนี้?')) await S.signOut(); return;
    case 'signout-now': await S.signOut(); return;
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
    case 'budget-save': saveBook(setBook().id, { budget: Math.max(0, Number($('[data-input="budget"]').value) || 0) }); return toast('บันทึกงบแล้ว');
    case 'cat-edit': return openCatEditor(el.dataset.id);
    case 'cat-new': return openCatEditor(null, el.dataset.t);
    case 'ce-emoji': catDraft.emoji = el.dataset.e; return renderCatEditor();
    case 'ce-move': return moveCategory(catDraft.id, Number(el.dataset.d), catDraft.bookId);
    case 'ce-delete': return deleteCategory(catDraft.id, catDraft.bookId);
    case 'cat-restore': {
      const sb = setBook();
      const list = [...cats(sb.id)];
      (S.BOOK_KINDS[sb.kind] || S.BOOK_KINDS.personal).categories.forEach(d => { if (!list.some(c => c.id === d.id)) list.push({ ...d }); });
      saveBook(sb.id, { categories: list });
      return toast('คืนหมวดเริ่มต้นแล้ว');
    }
    case 'owner-save': S.saveSettings({ ownerNames: $('[data-input="owner"]').value.trim() }); return toast('บันทึกชื่อแล้ว');
    case 'theme': S.savePrefs({ theme: el.dataset.t }); applyTheme(); return render();
    case 'export-json':
      return download(`tsk-moneynote-backup-${todayISO()}.json`, JSON.stringify({ app: 'jukjik', version: 1, tx: state.tx, settings: state.settings }, null, 2), 'application/json');
    case 'export-csv': {
      const head = 'date,book,type,amount,category,method,merchant,note,to_book';
      const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = [...state.tx].sort((a, b) => a.date.localeCompare(b.date))
        .map(t => [t.date, bookById(txBook(t))?.name || txBook(t), t.type, t.amount, catById(t.cat, txBook(t)).name, t.method, t.merchant, t.note, t.toBook ? bookById(t.toBook)?.name || t.toBook : ''].map(q).join(','));
      return download(`tsk-moneynote-${todayISO()}.csv`, '﻿' + [head, ...rows].join('\n'), 'text/csv');
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
    const { slipFile, removeSlip, ...rest } = draft;
    if (rest.type !== 'transfer' || rest.toBook === rest.book) delete rest.toBook;
    if (removeSlip && !slipFile) rest.hasSlip = false;
    const saved = S.saveTx({ ...rest, amount: Math.round(amount * 100) / 100 });
    ui.month = draft.date.slice(0, 7);
    $('#sheet').close();
    toast(draft.id ? 'แก้ไขแล้ว' : 'จดแล้ว ✅');
    if (slipFile) keepSlips([{ tx: saved, file: slipFile }], true);
    else if (removeSlip && draft.hasSlip) S.deleteSlipImage(saved.id).catch(err => toast('ลบสลิปไม่สำเร็จ: ' + err.message));
  } else if (f === 'auth') {
    const fd = new FormData(e.target);
    ui.authBusy = true; ui.authError = ''; render();
    try {
      await S.signIn(fd.get('email'), fd.get('pw'));
      toast('เข้าสู่ระบบแล้ว');
    } catch (err) { ui.authError = err.message; }
    ui.authBusy = false; render();
  } else if (f === 'book-edit') {
    const d = bookDraft;
    d.name = String(d.name || '').trim();
    if (!d.name) return toast('ใส่ชื่อบัญชีก่อน');
    if (books().some(b => b.id !== d.id && b.name === d.name)) return toast('มีบัญชีชื่อนี้แล้ว');
    const emoji = String(d.emoji || '').trim() || '📒';
    if (d.isNew) {
      const { isNew, ...book } = d;
      S.saveSettings({ books: [...books(), { ...book, emoji }] });
      ui.book = book.id; S.savePrefs({ book: ui.book }); ui.setBook = book.id;
    } else saveBook(d.id, { name: d.name, emoji });
    $('#sheet').close();
    toast(d.isNew ? 'เพิ่มบัญชีแล้ว' : 'บันทึกบัญชีแล้ว');
  } else if (f === 'cat-edit') {
    const d = catDraft;
    d.name = d.name.trim();
    if (!d.name) return toast('ใส่ชื่อหมวดก่อน');
    if (cats(d.bookId).some(c => c.id !== d.id && c.type === d.type && c.name === d.name)) return toast('มีหมวดชื่อนี้แล้ว');
    const item = { id: d.id, name: d.name, emoji: d.emoji.trim() || '🏷️', type: d.type };
    const list = d.isNew ? [...cats(d.bookId), item] : cats(d.bookId).map(c => c.id === d.id ? item : c);
    saveBook(d.bookId, { categories: list });
    $('#sheet').close();
    toast(d.isNew ? 'เพิ่มหมวดแล้ว' : 'บันทึกหมวดแล้ว');
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.d) {
    draft[t.dataset.d] = t.value;
    if (t.dataset.d === 'book') { if (draft.toBook === draft.book) draft.toBook = ''; renderSheet(); }
    return;
  }
  if (t.dataset.be) { bookDraft[t.dataset.be] = t.value; return; }
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
    case 'slip-attach': {
      const file = t.files[0]; t.value = '';
      if (!file) return;
      if (!/^image\//.test(file.type)) return toast('แนบได้เฉพาะรูปภาพ');
      draft.slipFile = file; delete draft.removeSlip;
      return renderSheet();
    }
    case 'setbook': ui.setBook = t.value; return render();
    case 'scanbook': {
      ui.scanBook = t.value;
      const ids = new Set(cats(t.value).map(c => c.id));
      ui.scan.items.forEach(it => { if (it.cat !== 'transfer' && !ids.has(it.cat)) it.cat = it.type === 'income' ? 'inc_other' : 'exp_other'; });
      return render();
    }
    case 'keepslips': S.saveSettings({ keepSlips: t.checked }); return toast(t.checked ? 'จะเก็บรูปสลิปไว้ในแอป' : 'ปิดการเก็บรูปสลิปในแอปแล้ว');
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
        if (data.settings?.books?.length) S.saveSettings({ books: data.settings.books });
        else if (data.settings?.categories) saveBook('personal', { categories: data.settings.categories, budget: data.settings.budget || 0 });
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
S.subscribe(() => {
  // a key saved only on this device (older version) is shared to the account once it is synced
  if (prefs.geminiKey && state.mode === 'cloud' && state.syncStatus === 'synced' && !state.settings.geminiKey) S.saveSettings({ geminiKey: prefs.geminiKey });
  render();
});
render();
S.initStore();
takeSharedFiles();
if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('sw.js').catch(() => {});
