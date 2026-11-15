// Reads bank slips (images) and credit-card statements (PDF) with the Gemini API.

export const DEFAULT_MODEL = 'gemini-3.8-flash-lite'; // fast & light; the real name is looked up if this one doesn't exist
let onModelChange = () => {};
export function setModelChangeHandler(fn) { onModelChange = fn; }
let onFallback = () => {};
export function setFallbackHandler(fn) { onFallback = fn; }
let onStatus = () => {};
export function setStatusHandler(fn) { onStatus = fn; }

// Time limits so a stuck request never hangs the scan screen.
const CALL_TIMEOUT = 40000;   // one request
const FILE_DEADLINE = 120000; // all retries for one file
let cancelled = false;
const live = new Set();
export function cancelAll() { cancelled = true; live.forEach(c => c.abort()); live.clear(); }
export function resetCancel() { cancelled = false; }

const ENDPOINT = m =>`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;

function blobToBase64(blob) {
  return new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(',')[1]);
    r.onerror = () => bad(r.error);
    r.readAsDataURL(blob);
  });
}

// Shrink photos so uploads are fast; slips stay readable at ~1600px.
async function imagePart(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return { inline_data: { mime_type: 'image/jpeg', data: await blobToBase64(blob) } };
  } catch {
    return { inline_data: { mime_type: file.type || 'image/jpeg', data: await blobToBase64(file) } };
  }
}

async function filePart(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    if (file.size > 18 * 1024 * 1024) throw new Error('ไฟล์ PDF ใหญ่เกิน 18MB');
    return { inline_data: { mime_type: 'application/pdf', data: await blobToBase64(file) } };
  }
  return imagePart(file);
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    kind: { type: 'STRING', enum: ['slip', 'statement', 'receipt', 'other'] },
    transactions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING', description: 'YYYY-MM-DD, Gregorian calendar' },
          time: { type: 'STRING', description: 'HH:MM if visible' },
          amount: { type: 'NUMBER', description: 'positive number in THB' },
          type: { type: 'STRING', enum: ['expense', 'income'] },
          category: { type: 'STRING' },
          merchant: { type: 'STRING', description: 'recipient, shop or merchant name' },
          note: { type: 'STRING' },
          ref: { type: 'STRING', description: 'transaction/reference number if visible' },
          method: { type: 'STRING', enum: ['transfer', 'card', 'cash'] },
        },
        required: ['date', 'amount', 'type', 'category'],
      },
    },
  },
  required: ['kind', 'transactions'],
};

function prompt(categories, today) {
  const cats = categories.map(c => `${c.id} (${c.type}: ${c.name})`).join(', ');
  return `You extract money transactions for a Thai personal expense app. Today is ${today}.
The file is a Thai bank transfer slip (e-slip), a payment receipt, or a credit card statement.
Rules:
- Slip or receipt: return exactly one transaction. Money sent out by the owner is "expense"; a slip clearly showing money received is "income". method = "transfer" for slips.
- Credit card statement: return every purchase line as "expense" with method "card". Interest, fees and late charges are separate "expense" items with category "fee". Installment lines (e.g. 3/10) are expenses; put the installment info in note. Cashback, refunds and reversals are "income" with category "refund". SKIP payments made to the card itself (e.g. "PAYMENT", "ชำระเงิน", "ขอบคุณสำหรับการชำระ") and skip previous-balance/total lines.
- Thai slips often use the Buddhist year (e.g. 2569 or "69"): subtract 543 to get the Gregorian year. Output dates as YYYY-MM-DD. If the year is missing, pick the most recent date not after today.
- amount is always a positive number in baht without currency symbols.
- category must be one of these ids: ${cats}. Choose the best match from the merchant/recipient name; use "exp_other" or "inc_other" when unsure.
- merchant: the recipient or shop name as printed. ref: the reference/transaction number if visible.
- If the file contains no transaction, return an empty transactions array with kind "other".`;
}

export async function readFile(file, { key, model, categories, today }) {
  if (!key) throw new Error('ยังไม่ได้ใส่ Gemini API key (ไปที่ ตั้งค่า)');
  const part = await filePart(file);
  const data = await generate(key, model, {
    contents: [{ role: 'user', parts: [{ text: prompt(categories, today) }, part] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0 },
  });
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  let out;
  try { out = JSON.parse(text); } catch { throw new Error('อ่านผลลัพธ์จาก Gemini ไม่ได้'); }
  const ids = new Set(categories.map(c => c.id));
  return (out.transactions || [])
    .filter(t => t && Number(t.amount) > 0)
    .map(t => ({
      date: /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : today,
      time: t.time || '',
      amount: Math.round(Number(t.amount) * 100) / 100,
      type: t.type === 'income' ? 'income' : 'expense',
      cat: ids.has(t.category) ? t.category : (t.type === 'income' ? 'inc_other' : 'exp_other'),
      merchant: t.merchant || '',
      note: t.note || '',
      ref: t.ref || '',
      method: t.method || (out.kind === 'statement' ? 'card' : 'transfer'),
      source: out.kind === 'statement' ? 'statement' : 'slip',
    }));
}

export async function testKey(key, model) {
  await generate(key, model, { contents: [{ parts: [{ text: 'ตอบคำว่า OK' }] }] });
  return true;
}

const BUSY = new Set([0, 408, 429, 500, 502, 503, 504]); // 0 = network hiccup, 408 = our timeout
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callOnce(key, model, body, timeoutMs) {
  const ctrl = new AbortController();
  live.add(ctrl);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, Math.max(1000, timeoutMs));
  try {
    const res = await fetch(ENDPOINT(model), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (res.ok) return { ok: true, data: await res.json() };
    let msg = ''; try { msg = (await res.json()).error?.message || ''; } catch {}
    return { ok: false, status: res.status, msg };
  } catch {
    if (cancelled) return { ok: false, status: -1, msg: 'cancelled' };
    return { ok: false, status: timedOut ? 408 : 0, msg: timedOut ? 'timeout' : '' };
  } finally {
    clearTimeout(timer);
    live.delete(ctrl);
  }
}

// Picks another Flash model this key can use: same family first (Lite ↔ Lite), stable before
// preview, newest first. Used when the model is overloaded or its name doesn't exist.
let modelListCache = null;
async function pickFallback(key, current, wantLite = /lite/.test(current)) {
  try {
    if (!modelListCache) {
      const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
        { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      modelListCache = ((await res.json()).models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''));
    }
    const ver = n => parseFloat(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] || 0);
    const ok = modelListCache.filter(n => n !== current && /^gemini-.*flash/.test(n) &&
      !/image|tts|audio|live|embed|vision|thinking/.test(n));
    const family = n => (/lite/.test(n) === wantLite ? 0 : 1);
    ok.sort((a, b) => (family(a) - family(b)) || (/preview|exp/.test(a) - /preview|exp/.test(b)) || ver(b) - ver(a));
    return ok[0] || null;
  } catch { return null; }
}

function friendlyError({ status, msg }, model) {
  if (status === -1) return new Error('ยกเลิกแล้ว');
  if (status === 408) return new Error('Gemini ตอบช้าเกินไป (เซิร์ฟเวอร์อาจยุ่ง) ลองใหม่อีกครั้งในอีกสักครู่');
  if (status === 0) return new Error('เชื่อมต่อ Gemini ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่');
  if (status === 400 && /api key/i.test(msg)) return new Error('API key ไม่ถูกต้อง');
  if (status === 403) return new Error('API key ไม่มีสิทธิ์ใช้งาน (403)');
  if (status === 404 || /no longer available|not found/i.test(msg))
    return new Error(`โมเดล "${model}" ใช้ไม่ได้แล้ว ลองเปลี่ยนชื่อโมเดลในตั้งค่า (ดูรายชื่อใน aistudio.google.com)`);
  if (status === 429) return new Error('ใช้เกินโควตาฟรีชั่วคราว รอประมาณ 1 นาทีแล้วลองใหม่');
  if (status === 503 || status === 500 || status === 502 || status === 504)
    return new Error('เซิร์ฟเวอร์ Gemini มีคนใช้เยอะชั่วคราว ลองใหม่อีกครั้งในอีกสักครู่');
  return new Error(`Gemini ตอบกลับผิดพลาด (${status}) ${msg}`.trim());
}

// Calls Gemini with automatic recovery:
//  - busy/overloaded (503, 429, 5xx): retry with backoff, then try another Flash model once (not saved)
//  - retired model whose error names a replacement: switch to it and remember it
async function generate(key, model, body, opts = {}) {
  model = model || DEFAULT_MODEL;
  const deadline = opts.deadline || Date.now() + FILE_DEADLINE;
  opts = { ...opts, deadline };
  let last = { status: 408, msg: 'timeout' };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (cancelled) return Promise.reject(friendlyError({ status: -1 }, model));
    if (attempt) {
      onStatus(`Gemini ยุ่งอยู่ กำลังลองใหม่ (${attempt + 1}/3)…`);
      await sleep(1000 * 2 ** (attempt - 1) + Math.random() * 400);
    }
    const left = deadline - Date.now();
    if (left < 3000) break;
    const r = await callOnce(key, model, body, Math.min(CALL_TIMEOUT, left));
    if (r.ok) return r.data;
    last = r;
    if (r.status === -1) throw friendlyError(r, model);
    if (r.status === 408 && attempt >= 1 && !opts.fallbackHop) break; // two slow tries: leave time for a backup model
    const suggested = r.msg.match(/use\s+(?:models\/)?(gemini-[\w.-]*\w)/i)?.[1];
    if (!opts.retiredHop && suggested && suggested !== model) {
      onModelChange(suggested);
      return generate(key, suggested, body, { ...opts, retiredHop: true });
    }
    // model name doesn't exist for this key (e.g. a guessed Flash-Lite name): find the real one and remember it
    if (!opts.resolvedHop && (r.status === 404 || /not found|no longer available|is not supported/i.test(r.msg))) {
      onStatus('กำลังหารุ่น Gemini ที่ใช้ได้…');
      const alt = await pickFallback(key, model);
      if (alt) {
        onModelChange(alt);
        return generate(key, alt, body, { ...opts, retiredHop: true, resolvedHop: true });
      }
    }
    if (!BUSY.has(r.status)) break;
  }
  if (BUSY.has(last.status) && last.status !== 0 && !opts.fallbackHop && !cancelled && deadline - Date.now() > 10000) {
    const alt = await pickFallback(key, model);
    if (alt) {
      onFallback(alt);
      onStatus(`รุ่นหลักยุ่ง กำลังลองด้วย ${alt}…`);
      return generate(key, alt, body, { retiredHop: true, fallbackHop: true, deadline });
    }
  }
  throw friendlyError(last, model);
}
