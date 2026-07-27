# นำ DriveCost ขึ้น GitHub

## วิธีง่ายบน Windows

1. สร้าง Repository ใหม่ใน GitHub โดยไม่ต้องเพิ่ม README หรือ .gitignore
2. แตก ZIP นี้
3. เปิดโฟลเดอร์ `DriveCost-v3.0.0-GitReady`
4. ดับเบิลคลิก `PUSH-TO-GITHUB.bat`
5. วาง Repository URL เช่น:

```text
https://github.com/USERNAME/drivecost.git
```

6. เข้าสู่ระบบ GitHub เมื่อ Git Credential Manager ขอสิทธิ์
7. เมื่อขึ้น `Push สำเร็จแล้ว` ให้เปิด Repository เพื่อตรวจไฟล์

## คำสั่งด้วยตนเอง

```bash
git remote add origin https://github.com/USERNAME/drivecost.git
git branch -M main
git push -u origin main
```

## ห้ามอัปโหลดค่า Secret

ไฟล์ `.env` ถูกกันด้วย `.gitignore` แล้ว แต่ต้องตรวจอีกครั้งว่าไม่มี:

- `SUPABASE_SECRET_KEY`
- service-role key
- รหัสผ่านผู้ดูแล
- access token

ค่าจริงให้ใส่ใน Render Environment Variables เท่านั้น
