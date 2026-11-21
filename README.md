# 🐣 TSK-MoneyNote

แอปจดรายรับรายจ่ายส่วนตัว อ่านสลิปและใบแจ้งยอดบัตรเครดิตด้วย Gemini ซิงก์ทุกเครื่องด้วย Firebase
ไม่ต้องติดตั้งอะไรบนคอม ไม่ต้องผ่าน App Store — เปิดผ่านเว็บแล้ว "เพิ่มไปยังหน้าจอโฮม" ใช้ได้เหมือนแอปจริง

| ฟีเจอร์ | |
|---|---|
| จดเอง (เงินสด/โอน/บัตร) | ✅ |
| อ่านสลิปทุกธนาคาร เลือกหลายรูปพร้อมกัน กันบันทึกซ้ำ | ✅ |
| อ่านใบแจ้งยอดบัตรเครดิต PDF (แยกดอกเบี้ย/เงินคืน) | ✅ |
| สรุปรายวัน/รายเดือน/ตามหมวด/ช่องทาง | ✅ |
| งบรายเดือน + บอกว่าใช้ได้วันละเท่าไหร่ | ✅ |
| เก็บรูปสลิปคู่กับรายการ แนบ/เปลี่ยนสลิปภายหลังได้ | ✅ |
| ซิงก์มือถือ/แท็บเล็ตทุกเครื่อง ใช้ออฟไลน์ได้ | ✅ (ต้องตั้งค่า Firebase) |
| แอปส่วนตัว ใช้ได้เฉพาะบัญชีเจ้าของ | ✅ |
| สำรอง JSON / ส่งออก CSV (เปิดใน Excel ได้) | ✅ |
| โหมดมืด | ✅ |

---

## ขั้นที่ 1 — เอาขึ้น GitHub Pages (ได้ลิงก์ใช้งาน)

1. ไปที่ github.com › ปุ่ม **New** (สร้าง repository) › ตั้งชื่อ `TSK-MoneyNote` › เลือก **Public** › Create
2. ในหน้า repo กด **uploading an existing file** › ลากไฟล์ทั้งหมดในโฟลเดอร์นี้ (รวมโฟลเดอร์ `icons`) ใส่ › **Commit changes**
3. ไปที่ **Settings › Pages** › Source: **Deploy from a branch** › Branch: `main` / `(root)` › Save
4. รอ 1–2 นาที จะได้ลิงก์ `https://<ชื่อผู้ใช้>.github.io/TSK-MoneyNote/`
5. เปิดลิงก์บนมือถือ
   - **iPhone/iPad:** Safari › ปุ่มแชร์ › *เพิ่มไปยังหน้าจอโฮม*
   - **Android:** Chrome › ⋮ › *ติดตั้งแอป*

> แอปต้องล็อกอินก่อนใช้งาน ทำขั้นที่ 2–3 ให้ครบ

## ขั้นที่ 2 — Gemini API key (สำหรับอ่านสลิป, ฟรี)

1. เข้า **aistudio.google.com/apikey** ด้วยบัญชี Google › **Create API key**
2. คัดลอก key › ในแอปไปที่ **ตั้งค่า › Gemini** › วาง › กด **ทดสอบ key**
3. ทำซ้ำในแต่ละเครื่อง (key เก็บในเครื่องเท่านั้น ไม่ขึ้น GitHub)

> แพ็กเกจ Gemini Pro ที่จ่ายรายเดือนใช้ในแชท ส่วนแอปใช้ API key แยก ซึ่งมีโควตาฟรีพอสำหรับใช้ส่วนตัว
> ค่าเริ่มต้นคือรุ่น **Flash-Lite** (`gemini-3.8-flash-lite`) เร็วและเบา ถ้าชื่อรุ่นนี้ไม่มีใน key ของคุณ
> หรือ Google เลิกใช้ แอปจะหารุ่นที่ใช้ได้แล้วเปลี่ยนให้อัตโนมัติ
> หรือเปลี่ยนเองได้ในตั้งค่า โดยดูชื่อรุ่นจากหน้า AI Studio

## ขั้นที่ 3 — Firebase (ซิงก์ทุกเครื่อง, ฟรี)

1. เข้า **console.firebase.google.com** › **Create a project** › ตั้งชื่อ `tsk-moneynote` (ปิด Google Analytics ได้)
2. **Build › Authentication › Get started** › แท็บ Sign-in method › เปิด **Email/Password** และ **Google**
3. Authentication › **Settings › Authorized domains** › Add domain › ใส่ `<ชื่อผู้ใช้>.github.io`
4. **Build › Firestore Database › Create database** › เลือก location `asia-southeast1` (สิงคโปร์) › Production mode
5. แท็บ **Rules** › ลบของเดิม แล้ววางเนื้อหาจากไฟล์ `firestore.rules` › **Publish**
   (กฎนี้ทำให้แต่ละบัญชีเห็นเฉพาะข้อมูลของตัวเอง)
6. ⚙️ **Project settings › General › Your apps** › กดไอคอน `</>` (Web) › ตั้งชื่อ › Register
   จะได้ก้อน `firebaseConfig = { apiKey: ..., ... }`
7. แก้ไฟล์ `firebase-config.js` ใส่ก้อน config นั้นใน `firebaseConfig` › Commit
8. สร้างบัญชีเจ้าของใน **Authentication › Users** (หรือล็อกอินด้วย Google ครั้งแรก) แล้วคัดลอก **User UID**
   ใส่ใน `ownerUid` ของ `firebase-config.js` และใน `firestore.rules` (แล้ว Publish rules อีกครั้ง)
   → แอปใช้ได้เฉพาะบัญชีนี้ ทุกเครื่องล็อกอินบัญชีเดียวกัน

> ค่าใน firebase-config.js ไม่ใช่รหัสลับ เปิดเผยบน GitHub ได้ ความปลอดภัยมาจาก Rules ในข้อ 5
> หมายเหตุ iPhone: ถ้า "เข้าสู่ระบบด้วย Google" ไม่ขึ้นตอนเปิดจากหน้าจอโฮม ให้ใช้อีเมล/รหัสผ่านแทน

---

## ไฟล์ในโปรเจกต์

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | หน้าหลักของแอป |
| `guide.html` | คู่มือวิธีใช้งานและวิธีติดตั้ง |
| `styles.css` | ธีมสีเหลืองลูกเจี๊ยบ + โหมดมืด |
| `app.js` | หน้าจอทั้งหมด (หน้าหลัก, สรุป, อ่านสลิป, ตั้งค่า) |
| `store.js` | เก็บข้อมูลและรูปสลิปใน Firebase (ซิงก์ทุกเครื่อง) |
| `gemini.js` | ส่งสลิป/PDF ให้ Gemini อ่าน |
| `charts.js` | กราฟรายวันและแยกหมวด |
| `qr.js` | อ่าน QR บนสลิปในเครื่อง (เลขอ้างอิงธนาคาร กันสลิปซ้ำ) |
| `firebase-config.js` | ค่า Firebase ของคุณ |
| `firestore.rules` | กฎความปลอดภัยฐานข้อมูล |
| `sw.js`, `manifest.webmanifest`, `icons/` | ทำให้ติดตั้งเป็นแอปและใช้ออฟไลน์ได้ |

## อัปเดตแอปภายหลัง
แก้ไฟล์บน GitHub แล้ว Commit — ภายในไม่กี่นาทีทุกเครื่องจะได้เวอร์ชันใหม่ (ปิดแล้วเปิดแอปใหม่)
