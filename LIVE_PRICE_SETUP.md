# Live Price Setup

## สถาปัตยกรรม

```text
Browser
  |
  | GET /api/fuel-prices
  v
DriveCost Node Server
  |
  | SOAP CurrentOilPrice
  v
PTT OR OilPrice Web Service
```

หน้าเว็บไม่ติดต่อ SOAP endpoint โดยตรง เซิร์ฟเวอร์จะ:
1. ส่ง SOAP request ไปยัง OR
2. ตรวจขนาดและสถานะ response
3. แปลง XML เป็น JSON
4. จัดกลุ่มผลิตภัณฑ์ให้แอพเข้าใจ
5. แคชผล 15 นาที
6. ส่งข้อมูล JSON กลับให้หน้าเว็บ

## Endpoint

```text
GET /api/fuel-prices
```

บังคับตรวจต้นทางใหม่:

```text
GET /api/fuel-prices?refresh=1
```

ตัวอย่าง response:

```json
{
  "provider": "PTT OR OilPrice Web Service",
  "sourceUrl": "https://orapiweb.pttor.com/oilservice/OilPrice.asmx",
  "fetchedAt": "2026-07-24T06:00:00.000Z",
  "effectiveAt": "2026-07-24T05:00:00+07:00",
  "stale": false,
  "prices": [
    {
      "id": "gasoholE20",
      "label": "แก๊สโซฮอล์ E20",
      "product": "Blue Gasohol E20",
      "price": 33.04,
      "unit": "THB/L"
    }
  ]
}
```

## ความปลอดภัย

- upstream URL ถูกกำหนดตายตัว ป้องกัน SSRF
- จำกัด response จาก upstream ไม่เกิน 1 MB
- timeout 8 วินาที
- rate limit 30 requests ต่อนาทีต่อ IP
- ไม่เก็บ API key หรือข้อมูลผู้ใช้
- ไม่เปิด CORS แบบ wildcard
- ตรวจชนิดข้อมูลและช่วงราคาก่อนนำไปใช้
