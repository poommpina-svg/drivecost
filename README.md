# DriveCost v3.1.0 — Render Production

รุ่น Production สำหรับเปิดให้ผู้ใช้จริงผ่าน Render พร้อมระบบบัญชี Supabase,
พื้นที่ข้อมูลแยกตามผู้ใช้, ราคาน้ำมันจาก PTT OR, และศูนย์ตรวจสอบระบบสำหรับผู้ดูแล

## สิ่งที่เพิ่มในรุ่นนี้

- Render Blueprint (`render.yaml`)
- Production server ที่ bind `0.0.0.0` และใช้ `PORT` จาก Render
- `/healthz` สำหรับ Render health check
- `/readyz` สำหรับตรวจการตั้งค่าก่อนรับผู้ใช้
- Security headers: CSP, HSTS, frame protection, permissions policy
- Static-file allowlist ป้องกันการเปิดเผย `server.js`, `.env`, SQL และไฟล์หลังบ้าน
- Runtime config ส่งเฉพาะ Supabase URL และ Publishable key
- Supabase Secret key อยู่บนเซิร์ฟเวอร์เท่านั้น
- Admin dashboard ที่ `/admin`
- Admin API ตรวจ Supabase access token และสิทธิ์ฝั่งเซิร์ฟเวอร์
- รายงานความสมบูรณ์ของ Auth, profiles, sync rows และ payload
- อีเมลผู้ใช้ในหน้าผู้ดูแลถูกปิดบัง
- Audit log สำหรับการตรวจระบบและรีเฟรชราคาต้นทาง
- Service Worker แบบ versioned และไม่แคชหน้าแอดมิน/API
- ชุดทดสอบ syntax, unit, HTTP smoke และ production preflight
- ภาพรถย้ายออกจาก Base64 ทำให้ `index.html` เล็กลงมาก

## คำสั่งสำคัญ

```bash
npm ci
npm run verify
npm run audit:prod
npm start
```

## เอกสาร

- `DEPLOY-RENDER.md` — ขั้นตอนขึ้น Render
- `PRODUCTION-CHECKLIST.md` — รายการตรวจเปิดระบบจริง
- `ADMIN-GUIDE.md` — วิธีตั้งและใช้ผู้ดูแล
- `SECURITY.md` — โครงสร้างความปลอดภัย
- `supabase/production.sql` — Migration ที่ต้องรันก่อน Deploy
- `reports/PRODUCTION_AUDIT_REPORT.md` — ผลตรวจอัตโนมัติล่าสุด


## เครื่องคำนวณ Real Drive

รุ่น 3.1.0 มีสามโหมดที่ไม่ปนกัน:

- **เติมจริง:** เลขไมล์และยอดน้ำมัน/แก๊ส/ไฟฟ้าที่จ่ายจริง
- **ประมาณก่อนเดินทาง:** ระยะทาง อัตราสิ้นเปลือง ราคา และพฤติกรรมผู้ขับ
- **เส้นทางภูเขา:** ความสูงสะสม น้ำหนัก ความชัน รถติด แอร์ และผิวทาง

ไม่มีการหารค่าเชื้อเพลิงตามผู้โดยสาร และทุกปัจจัยประมาณการแสดงเป็นรายการแยก
ข้อมูลเติมเต็มถังถูกใช้สร้างโปรไฟล์ผู้ขับเฉพาะรถและบัญชีนั้น
