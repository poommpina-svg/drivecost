# ขั้นตอน Deploy DriveCost ขึ้น Render

## 1. เตรียม Supabase

1. เปิด Supabase Dashboard
2. เข้า SQL Editor
3. เปิดไฟล์ `supabase/production.sql`
4. คัดลอกทั้งหมดและกด Run
5. ตรวจว่าไม่มี error
6. ไปที่ Authentication > URL Configuration
7. ตั้ง Site URL เป็น URL จริงของ Render หรือโดเมนหลัก
8. เพิ่ม Redirect URL:
   - `https://ชื่อบริการ.onrender.com/**`
   - โดเมนจริงของคุณ เช่น `https://drivecost.example.com/**`

## 2. ตั้งผู้ดูแล

วิธีเริ่มต้นที่ง่ายที่สุด:

- ใส่อีเมลผู้ดูแลใน Render environment variable `ADMIN_EMAILS`
- ตัวอย่าง: `owner@example.com`

วิธีระยะยาวที่แนะนำ:

1. หา UUID ของผู้ดูแลจาก Authentication > Users
2. ใช้คำสั่งตัวอย่างท้ายไฟล์ `supabase/production.sql`
3. เพิ่ม UUID ลง `public.app_admins`
4. หลังตรวจว่าเข้าหน้า `/admin` ได้แล้ว สามารถเอาอีเมลออกจาก `ADMIN_EMAILS`

## 3. เตรียม Repository

1. สร้าง Git repository
2. วางไฟล์ทั้งหมดของโฟลเดอร์นี้ไว้ที่ root
3. ห้าม commit `.env`
4. ตรวจว่าไฟล์ต่อไปนี้อยู่ใน repository:
   - `render.yaml`
   - `package.json`
   - `package-lock.json`
   - `.node-version`
   - `server.js`
   - `supabase/production.sql`

## 4. สร้าง Blueprint ใน Render

1. เปิด Render Dashboard
2. เลือก New > Blueprint
3. เชื่อม repository
4. Render จะอ่าน `render.yaml`
5. กรอกค่าที่มี `sync: false`:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
   - `ADMIN_EMAILS`
   - `ADMIN_USER_IDS` ปล่อยว่างได้
6. Render จะสร้าง `IP_HASH_SALT` แบบสุ่มให้อัตโนมัติ
7. กด Apply

Blueprint ใช้แผน `starter` เพราะ Free web service อาจ sleep เมื่อไม่มี traffic
และมี cold start ซึ่งไม่เหมาะกับระบบที่เปิดให้ผู้ใช้จริง

## 5. ตรวจ Deploy log

Build command คือ:

```bash
npm ci && npm run verify
```

Deploy จะไม่ผ่านหากเกิดข้อผิดพลาดใน:

- JavaScript syntax
- Unit tests
- HTTP smoke test
- Production preflight
- Secret scanning
- RLS/schema checks
- Static asset checks

## 6. ตรวจหลัง Deploy

เปิด URL ต่อไปนี้:

- `/healthz` ต้องตอบ HTTP 200
- `/readyz` ต้องตอบ HTTP 200
- `/api/system/status` ต้องมี `ok: true`
- `/` ต้องเปิด DriveCost ได้
- `/admin` ต้องเข้าสู่ระบบได้เฉพาะผู้ดูแล
- `/server.js` ต้องตอบ 404
- `/supabase/production.sql` ต้องตอบ 404

## 7. ตรวจระบบบัญชีจริง

สร้างบัญชีทดสอบ 2 บัญชี:

1. บัญชี A บันทึกสถานการณ์และประวัติ
2. ออกจากระบบ
3. บัญชี B ต้องไม่เห็นข้อมูล A
4. ล้างประวัติ B และเปิดใหม่ ประวัติต้องไม่กลับมา
5. กลับบัญชี A ข้อมูล A ต้องยังอยู่
6. ตรวจใน `user_sync_state` ว่ามีคนละ `user_id`

## 8. เปิดโดเมนจริง

1. Render > Settings > Custom Domains
2. เพิ่มโดเมน
3. ตั้ง DNS ตามที่ Render แสดง
4. รอ Verify
5. Render จะออกและต่ออายุ TLS ให้อัตโนมัติ
6. อัปเดต Supabase Site URL และ Redirect URLs ให้ตรงโดเมนจริง

## 9. ก่อนประกาศใช้งาน

ทำ `PRODUCTION-CHECKLIST.md` ให้ครบทุกข้อ และเข้า `/admin` กด
“ตรวจสอบทั้งระบบ” จนสถานะไม่มี Critical failure
