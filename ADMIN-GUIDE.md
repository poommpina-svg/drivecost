# คู่มือระบบแอดมิน DriveCost

## URL

```text
https://โดเมนของคุณ/admin
```

หน้าแอดมินเป็นหน้า public shell แต่ข้อมูลทุก endpoint ถูกป้องกันด้วย:

1. Supabase user session
2. การตรวจ access token กับ Supabase Auth
3. allowlist จาก `ADMIN_EMAILS` / `ADMIN_USER_IDS`
4. หรือสมาชิกที่ active ใน `public.app_admins`
5. rate limit และ same-origin guard ฝั่ง Render server

## ข้อมูลที่แสดง

- จำนวนผู้ใช้ทั้งหมด
- จำนวนผู้ใช้ยืนยันอีเมลแล้ว/ยังไม่ยืนยัน
- จำนวน profiles
- จำนวน user sync rows
- profiles ที่ยังไม่มีข้อมูลซิงก์
- sync rows ที่ผิดปกติ
- payload รูปแบบผิดหรือใหญ่เกิน 512 KB
- เวลาซิงก์ล่าสุด
- สถานะแคชราคาน้ำมัน
- Render service, commit, branch, Node version และ uptime
- ผู้ใช้ล่าสุดโดยปิดบังอีเมล
- Audit log ของกิจกรรมผู้ดูแล

ระบบไม่แสดง:

- รหัสผ่าน
- access token
- Supabase Secret key
- payload ส่วนตัวของผู้ใช้
- IP address ดิบ

## สิทธิ์ผู้ดูแล

ตาราง `app_admins` รองรับ role:

- `owner`
- `auditor`
- `support`

รุ่นนี้ใช้ทุก role สำหรับงานตรวจสอบแบบ read-only และรีเฟรชราคาน้ำมัน
ไม่มีปุ่มลบผู้ใช้หรือแก้ payload เพื่อลดความเสี่ยงจากการกดผิด

## เพิ่มผู้ดูแล

ใช้ UUID จาก Authentication > Users:

```sql
insert into public.app_admins (user_id, role, note)
values (
  'UUID-ของผู้ดูแล',
  'owner',
  'Primary administrator'
)
on conflict (user_id)
do update set
  active = true,
  role = excluded.role,
  note = excluded.note;
```

## ปิดสิทธิ์

```sql
update public.app_admins
set active = false
where user_id = 'UUID-ของผู้ดูแล';
```

และนำอีเมล/UUID ออกจาก environment variables ของ Render หากเคยใส่ไว้

## Audit log

กิจกรรมต่อไปนี้ถูกบันทึก:

- `run_integrity_check`
- `refresh_fuel_prices`

อีเมลถูก mask และ IP ถูก hash ด้วย `IP_HASH_SALT`
