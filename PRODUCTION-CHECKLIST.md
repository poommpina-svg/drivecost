# Production Checklist

## Supabase

- [ ] รัน `supabase/production.sql` สำเร็จ
- [ ] RLS เปิดบน `profiles`
- [ ] RLS เปิดบน `user_sync_state`
- [ ] RLS เปิดบน `app_admins`
- [ ] RLS เปิดบน `admin_audit_log`
- [ ] `save_user_sync_state` execute ได้เฉพาะ authenticated
- [ ] `admin_system_integrity` execute ได้เฉพาะ service_role
- [ ] มีผู้ดูแลอย่างน้อยหนึ่งบัญชี
- [ ] Site URL ถูกต้อง
- [ ] Redirect URLs ถูกต้อง
- [ ] Confirm email/SMTP ตั้งตามนโยบายจริง ไม่ใช้ค่าทดสอบโดยไม่ตั้งใจ

## Render

- [ ] ใช้แผน Starter หรือสูงกว่า
- [ ] `SUPABASE_URL` ถูกต้อง
- [ ] `SUPABASE_PUBLISHABLE_KEY` ถูกต้อง
- [ ] `SUPABASE_SECRET_KEY` ถูกต้องและไม่อยู่ใน Git
- [ ] `ADMIN_EMAILS` หรือ `ADMIN_USER_IDS` ถูกต้อง
- [ ] `IP_HASH_SALT` มีอย่างน้อย 32 ตัวอักษร
- [ ] Build ผ่าน `npm run verify`
- [ ] `/healthz` ตอบ 200
- [ ] `/readyz` ตอบ 200
- [ ] Deploy log ไม่มี restart loop

## Security

- [ ] `/server.js` ตอบ 404
- [ ] `/.env` ตอบ 404
- [ ] `/supabase/production.sql` ตอบ 404
- [ ] Response มี Content-Security-Policy
- [ ] Response มี HSTS
- [ ] หน้า `/admin` มี noindex
- [ ] ผู้ใช้ทั่วไปเข้า Admin API แล้วได้ 403
- [ ] Secret key ไม่ปรากฏใน View Source หรือ runtime-config
- [ ] ทดสอบ rate limit ของ refresh endpoint

## Functional

- [ ] สมัครสมาชิก
- [ ] เข้าสู่ระบบ
- [ ] ออกจากระบบ
- [ ] ลืมรหัสผ่าน
- [ ] บันทึกสถานการณ์
- [ ] ลบสถานการณ์และเปิดใหม่แล้วไม่กลับมา
- [ ] บันทึกประวัติ
- [ ] ล้างประวัติและเปิดใหม่แล้วไม่กลับมา
- [ ] ผู้ใช้ A ไม่เห็นข้อมูลผู้ใช้ B
- [ ] Guest ไม่เห็นข้อมูลบัญชี
- [ ] รูปรถไม่กระพริบตอนบันทึกออนไลน์
- [ ] ปุ่มราคาน้ำมันเลือกผลิตภัณฑ์ตรงรายการ
- [ ] ราคาน้ำมันมีวันที่มีผลและสถานะข้อมูล
- [ ] โหมดมือถือใช้งานเมนูและปุ่มได้

## Admin

- [ ] ผู้ดูแลเข้าสู่ `/admin` ได้
- [ ] ผู้ใช้ทั่วไปถูกปฏิเสธ
- [ ] Overview โหลดสำเร็จ
- [ ] Integrity checks โหลดสำเร็จ
- [ ] Users list แสดงอีเมลแบบ mask
- [ ] Audit log บันทึกการตรวจระบบ
- [ ] Fuel refresh บันทึก audit
- [ ] ไม่มี Critical failure ก่อนประกาศใช้งาน

## Operations

- [ ] ตั้ง custom domain
- [ ] DNS verified
- [ ] HTTPS ทำงาน
- [ ] มีผู้รับผิดชอบดู Render logs
- [ ] มีผู้รับผิดชอบดู Supabase usage/quota
- [ ] กำหนดรอบสำรอง/ส่งออกข้อมูลตามความต้องการธุรกิจ
- [ ] มีช่องทางแจ้งปัญหาและนโยบายความเป็นส่วนตัว
