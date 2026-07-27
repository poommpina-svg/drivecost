# Security Architecture

## Public browser

เบราว์เซอร์ได้รับเฉพาะ:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- Supabase user JWT ของผู้ใช้คนนั้น

เบราว์เซอร์ไม่ได้รับ `SUPABASE_SECRET_KEY`

## Render server

Secret key อยู่ใน Render Environment และใช้เฉพาะ:

- ตรวจสมาชิก `app_admins`
- อ่าน Auth Admin API
- อ่านสรุป integrity
- เขียน admin audit log

Secret key ส่งใน `apikey` header เท่านั้นเมื่อเป็น `sb_secret_...`
และไม่ส่งเป็น Bearer token

## Database

- ข้อมูลผู้ใช้ทั่วไปใช้ RLS และ `auth.uid()`
- `profiles` อ่าน/เขียนเฉพาะเจ้าของ
- `user_sync_state` อ่าน/เขียนเฉพาะเจ้าของ
- `app_admins` และ `admin_audit_log` ไม่มี policy สำหรับ authenticated
- Admin endpoint ทุกตัวตรวจ Supabase session ก่อนใช้ secret key

## HTTP

- CSP
- HSTS
- X-Frame-Options DENY
- nosniff
- Permissions-Policy
- same-origin guard สำหรับ Admin POST
- rate limit
- static allowlist
- structured log
- graceful shutdown
- request timeout

## Privacy

หน้าแอดมินไม่โหลด payload ผู้ใช้และ mask อีเมล
Audit log ไม่เก็บ token, password หรือ IP ดิบ
