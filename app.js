import * as S from './store.js';
import { readFile, testKey, DEFAULT_MODEL, setModelChangeHandler, setFallbackHandler } from './gemini.js';
import { categoryBars, dailyColumns, bindColumnTips } from './charts.js';

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
  scan: { busy: false, done: 0, total: 0, items: [], errors: [], only30: true },
  authMode: 'signin',
  authBusy: false,
  authError: '',
  obStep: 0,
};

const cats = () => state.settings.categories || S.DEFAULT_CATEGORIES;
const catById = id => cats().find(c => c.id === id) || { id, name: 'ไม่ระบุ', emoji: '❔', type: 'expense' };
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
    <span class="tx-amt num ${t.type}">${t.type === 'expense' ? '−' : '+'}${baht(t.amount)}</span>
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
        ${q ? '' : `<p>กด <b>+</b> เพื่อจดเอง หรือให้จุกจิกอ่านสลิปให้</p>
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
  const hasKey = !!prefs.geminiKey;
  const selected = sc.items.filter(i => i.keep).length;
  return `${header('อ่านสลิป')}
    ${!hasKey ? `<section class="card notice"><p>🔑 ต้องใส่ Gemini API key ก่อน (ฟรี) เพื่อให้จุกจิกอ่านสลิปได้</p>
      <button class="btn primary sm" data-action="goto-gemini">ไปใส่ key</button></section>` : ''}
    <label class="drop ${sc.busy || !hasKey ? 'disabled' : ''}">
      <input type="file" accept="image/*,application/pdf" multiple data-input="files" ${sc.busy || !hasKey ? 'disabled' : ''}>
      <span class="drop-icon">🧾</span>
      <b>เลือกสลิป หรือใบแจ้งยอดบัตรเครดิต</b>
      <small>เลือกได้หลายรูปพร้อมกัน · รองรับสลิปทุกธนาคาร · PDF ใบแจ้งยอด</small>
    </label>
    <label class="check"><input type="checkbox" data-input="only30" ${sc.only30 ? 'checked' : ''}> เลือกเฉพาะสลิป 30 วันล่าสุดให้อัตโนมัติ</label>
    ${sc.busy ? `<section class="card progress"><div class="spinner"></div><p>จุกจิกกำลังอ่าน… ${sc.done}/${sc.total}</p>
      <div class="meter"><div style="width:${sc.total ? sc.done / sc.total * 100 : 0}%"></div></div></section>` : ''}
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
  const options = cats().filter(c => c.type === it.type).map(c => `<option value="${c.id}" ${c.id === it.cat ? 'selected' : ''}>${c.emoji} ${esc(c.name)}</option>`).join('');
  return `<li class="rv ${it.keep ? '' : 'off'}">
    <label class="rv-check"><input type="checkbox" data-rv="keep" data-i="${i}" ${it.keep ? 'checked' : ''} aria-label="เลือกรายการ"></label>
    <div class="rv-body">
      <div class="row between"><b>${esc(it.merchant || it.fileName)}</b>
        ${it.dup ? '<span class="tag warn">ซ้ำ</span>' : it.old ? '<span class="tag">เกิน 30 วัน</span>' : ''}</div>
      <div class="rv-grid">
        <select data-rv="type" data-i="${i}" aria-label="ประเภท"><option value="expense" ${it.type === 'expense' ? 'selected' : ''}>รายจ่าย</option><option value="income" ${it.type === 'income' ? 'selected' : ''}>รายรับ</option></select>
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
  const catChips = list => list.map(c => `<span class="chip">${c.emoji} ${esc(c.name)}
    ${S.DEFAULT_CATEGORIES.some(d => d.id === c.id) ? '' : `<button class="x" data-action="cat-del" data-id="${c.id}" aria-label="ลบหมวด ${esc(c.name)}">×</button>`}</span>`).join('');

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

    <section class="card" id="gemini"><h3>🔑 Gemini (อ่านสลิป)</h3>
      <p class="muted small">สร้าง API key ฟรีที่ aistudio.google.com/apikey · key เก็บไว้ในเครื่องนี้เท่านั้น ใส่ทีละเครื่อง</p>
      <input type="password" placeholder="วาง API key ที่นี่" value="${esc(prefs.geminiKey)}" data-input="gkey" autocomplete="off">
      <label class="lbl">โมเดล<input type="text" value="${esc(prefs.geminiModel)}" data-input="gmodel"></label>
      <button class="btn ghost sm" data-action="gtest">ทดสอบ key</button>
    </section>

    <section class="card"><h3>🎯 งบประมาณรายเดือน</h3>
      <div class="row gap"><input type="number" inputmode="decimal" placeholder="เช่น 15000" value="${state.settings.budget || ''}" data-input="budget">
      <button class="btn primary sm" data-action="budget-save">บันทึก</button></div>
      <small class="muted">ใส่ 0 เพื่อปิดการแสดงงบ</small>
    </section>

    <section class="card"><h3>🗂️ หมวดหมู่</h3>
      <small class="muted">รายจ่าย</small><div class="chips">${catChips(expCats)}</div>
      <small class="muted">รายรับ</small><div class="chips">${catChips(incCats)}</div>
      <form class="row gap wrap" data-form="cat">
        <input name="emoji" placeholder="😀" maxlength="4" class="w-emoji" aria-label="อีโมจิ">
        <input name="name" placeholder="ชื่อหมวดใหม่" required class="grow" aria-label="ชื่อหมวด">
        <select name="type" aria-label="ประเภท"><option value="expense">รายจ่าย</option><option value="income">รายรับ</option></select>
        <button class="btn primary sm">เพิ่ม</button>
      </form>
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
  const list = cats().filter(c => c.type === d.type);
  if (!list.some(c => c.id === d.cat)) d.cat = list[0]?.id;
  $('#sheet').innerHTML = `<form method="dialog" class="sheet-body" data-form="tx">
    <div class="grab" aria-hidden="true"></div>
    <div class="row between"><h2>${d.id ? 'แก้ไขรายการ' : 'จดรายการใหม่'}</h2><button type="button" class="icon-btn" data-action="close-sheet" aria-label="ปิด">✕</button></div>
    <div class="seg ${d.type}">
      <button type="button" aria-selected="${d.type === 'expense'}" data-action="d-type" data-t="expense">รายจ่าย</button>
      <button type="button" aria-selected="${d.type === 'income'}" data-action="d-type" data-t="income">รายรับ</button>
    </div>
    <label class="amount ${d.type}"><span>฿</span><input type="number" inputmode="decimal" step="0.01" min="0" placeholder="0" value="${d.amount}" data-d="amount" required aria-label="จำนวนเงิน"></label>
    <div class="cat-grid">${list.map(c => `<button type="button" class="cat ${c.id === d.cat ? 'on' : ''}" data-action="d-cat" data-id="${c.id}">
      <span>${c.emoji}</span><small>${esc(c.name)}</small></button>`).join('')}</div>
    <div class="row gap">
      <label class="lbl grow">วันที่<input type="date" value="${d.date}" data-d="date" required></label>
      <label class="lbl grow">ช่องทาง<select data-d="method">${Object.entries(METHODS).map(([k, l]) => `<option value="${k}" ${d.method === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <label class="lbl">โน้ต<input type="text" value="${esc(d.note || '')}" placeholder="เช่น ข้าวมันไก่ร้านประจำ" data-d="note"></label>
    ${d.merchant ? `<small class="muted">ผู้รับ: ${esc(d.merchant)}${d.ref ? ' · อ้างอิง ' + esc(d.ref) : ''}</small>` : ''}
    <div class="row gap">
      ${d.id ? `<button type="button" class="btn danger" data-action="d-delete">ลบ</button>` : ''}
      <button type="submit" class="btn primary big grow">บันทึก</button>
    </div>
  </form>`;
}

// ---------- scan ----------
function isDup(it, existing) {
  return existing.some(t => (it.ref && t.ref && t.ref === it.ref) ||
    (t.date === it.date && Number(t.amount) === Number(it.amount) && t.type === it.type && (t.merchant || '') === (it.merchant || '') && (t.time || '') === (it.time || '')));
}
async function runScan(files) {
  const sc = ui.scan;
  Object.assign(sc, { busy: true, done: 0, total: files.length, errors: [] });
  render();
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
  const cutISO = new Date(cutoff - cutoff.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const queue = [...files];
  const opts = { key: prefs.geminiKey, model: prefs.geminiModel, categories: cats(), today: todayISO() };
  const worker = async () => {
    while (queue.length) {
      const f = queue.shift();
      try {
        const found = await readFile(f, opts);
        if (!found.length) sc.errors.push({ name: f.name, msg: 'ไม่พบรายการเงินในไฟล์นี้', file: f });
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
  sc.items.sort((a, b) => b.date.localeCompare(a.date));
  sc.busy = false;
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
  document.body.classList.toggle('no-nav', onboarding);
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
    case 'scan-clear': Object.assign(ui.scan, { items: [], errors: [] }); return render();
    case 'scan-retry': { const files = ui.scan.errors.map(e => e.file).filter(Boolean); if (files.length) runScan(files); return; }
    case 'scan-save': {
      const keep = ui.scan.items.filter(i => i.keep).map(({ keep, dup, old, fileName, ...t }) => t);
      const n = await S.saveMany(keep);
      ui.scan.items = ui.scan.items.filter(i => !i.keep);
      toast(`บันทึก ${n} รายการแล้ว 🐣`);
      if (keep[0]) ui.month = keep[0].date.slice(0, 7);
      return render();
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
      if (!prefs.geminiKey) return toast('ใส่ key ก่อน');
      toast('กำลังทดสอบ…');
      try { await testKey(prefs.geminiKey, prefs.geminiModel); toast('✅ key ใช้งานได้'); } catch (err) { toast('❌ ' + err.message); }
      return;
    case 'budget-save': S.saveSettings({ budget: Math.max(0, Number($('[data-input="budget"]').value) || 0) }); return toast('บันทึกงบแล้ว');
    case 'cat-del': {
      const id = el.dataset.id;
      if (state.tx.some(t => t.cat === id) && !confirm('หมวดนี้มีรายการอยู่ ลบหมวดได้แต่รายการจะแสดงเป็น "ไม่ระบุ" ต่อไหม?')) return;
      return S.saveSettings({ categories: cats().filter(c => c.id !== id) });
    }
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
  } else if (f === 'cat') {
    const fd = new FormData(e.target);
    const name = String(fd.get('name')).trim();
    if (!name) return;
    S.saveSettings({ categories: [...cats(), { id: 'c_' + S.newId(), name, emoji: String(fd.get('emoji')).trim() || '🏷️', type: fd.get('type') }] });
    toast('เพิ่มหมวดแล้ว');
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.dataset.d) { draft[t.dataset.d] = t.value; return; }
  if (t.dataset.rv) {
    const it = ui.scan.items[+t.dataset.i];
    const k = t.dataset.rv;
    if (k === 'keep') { it.keep = t.checked; render(); }
    else if (k === 'amount') it.amount = Number(t.value);
    else if (k === 'type') { it.type = t.value; it.cat = it.type === 'income' ? 'inc_other' : 'exp_other'; render(); }
    else it[k] = t.value;
    return;
  }
  switch (t.dataset.input) {
    case 'search': ui.search = t.value; return render();
    case 'gkey': return S.savePrefs({ geminiKey: t.value.trim() });
    case 'gmodel': return S.savePrefs({ geminiModel: t.value.trim() || DEFAULT_MODEL });
  }
});

document.addEventListener('change', async e => {
  const t = e.target;
  switch (t.dataset.input) {
    case 'only30':
      ui.scan.only30 = t.checked;
      ui.scan.items.forEach(it => { if (!it.dup) it.keep = !(t.checked && it.old); });
      return render();
    case 'files': { const files = [...t.files]; t.value = ''; if (files.length) runScan(files); return; }
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
S.subscribe(() => render());
render();
S.initStore();
if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('sw.js').catch(() => {});
