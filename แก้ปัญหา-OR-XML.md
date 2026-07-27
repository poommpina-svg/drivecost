# แก้ปัญหา “PTT response did not contain price records”

ข้อความนี้เกิดจากแอพเวอร์ชันเก่ารอชื่อแถว XML เฉพาะ `DataAccess` หรือ `Table`
แต่บริการต้นทางอาจส่งชื่อแถวหรือ namespace ต่างออกไป

เวอร์ชัน 2.3.2 แก้แล้วโดย:
- อ่านข้อมูลจากแท็ก PRODUCT และ PRICE โดยไม่ผูกกับชื่อแถว
- รองรับ CDATA, XML ที่ถูก escape และ namespace
- มี fallback ไปยังภาษาไทยและ GetOilPrice

## ขั้นตอนเปลี่ยนเวอร์ชัน

1. ปิด Node server เดิม
2. แตก ZIP v2.3.2 เป็นโฟลเดอร์ใหม่
3. ดับเบิลคลิก `เปิดแอพ.bat`
4. เปิด `http://127.0.0.1:8080`
5. กด Ctrl + F5 เพื่อข้าม Service Worker cache เดิม

อย่านำเฉพาะ `index.html` ใหม่ไปทับ เพราะตัวแก้อยู่ใน `server.js`
