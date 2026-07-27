
"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");
const { config } = require("./config");

const ROOT = path.resolve(__dirname, "..");
const UPSTREAM = config.fuelUpstream;
const CACHE_TTL_MS = config.fuelCacheTtlMs;
const STALE_TTL_MS = config.fuelStaleTtlMs;
const MAX_UPSTREAM_BYTES = 1_000_000;

let memoryCache = null;
let upstreamRequestInFlight = null;

const labels = {
  gasoline95: "เบนซิน 95",
  gasoline91: "เบนซิน 91",
  gasohol95: "แก๊สโซฮอล์ 95",
  premiumGasohol95: "แก๊สโซฮอล์ 95 พรีเมียม",
  gasohol91: "แก๊สโซฮอล์ 91",
  gasoholE20: "แก๊สโซฮอล์ E20",
  gasoholE85: "แก๊สโซฮอล์ E85",
  diesel: "ดีเซล",
  dieselB7: "ดีเซล B7",
  dieselB10: "ดีเซล B10",
  dieselB20: "ดีเซล B20",
  premiumDiesel: "ดีเซลพรีเมียม",
  ngv: "NGV"
};

function decodeXmlEntities(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tagValue(block, tag) {
  const match = String(block).match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXmlEntities(match[1]).trim() : "";
}

function normalizeProductId(product) {
  const text = String(product || "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return null;
  if (/\bngv\b|เอ็นจีวี/.test(text)) return "ngv";
  if (/\be85\b/.test(text)) return "gasoholE85";
  if (/\be20\b/.test(text)) return "gasoholE20";
  if (/gasohol|แก๊สโซฮอล์/.test(text) && /\b91\b/.test(text)) return "gasohol91";
  if (/gasohol|แก๊สโซฮอล์/.test(text) && /\b95\b/.test(text) && /premium|super|supreme|พรีเมียม/.test(text)) return "premiumGasohol95";
  if (/gasohol|แก๊สโซฮอล์/.test(text) && /\b95\b/.test(text)) return "gasohol95";
  if (/gasoline|เบนซิน/.test(text) && /\b91\b/.test(text)) return "gasoline91";
  if (/gasoline|เบนซิน/.test(text) && /\b95\b/.test(text)) return "gasoline95";
  if (/diesel|ดีเซล/.test(text) && /premium|supreme|พรีเมียม/.test(text)) return "premiumDiesel";
  if (/diesel|ดีเซล/.test(text) && /\bb20\b/.test(text)) return "dieselB20";
  if (/diesel|ดีเซล/.test(text) && /\bb10\b/.test(text)) return "dieselB10";
  if (/diesel|ดีเซล/.test(text) && /\bb7\b/.test(text)) return "dieselB7";
  if (/diesel|ดีเซล/.test(text)) return "diesel";
  return null;
}

function stripMarkup(value) {
  return decodeXmlEntities(
    String(value || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function decodeEmbeddedXml(value) {
  let current = String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  for (let i = 0; i < 4; i += 1) {
    const decoded = decodeXmlEntities(current);
    if (decoded === current) break;
    current = decoded;
  }
  return current;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function allTagValues(xml, tagNames) {
  for (const tagName of tagNames) {
    const escaped = escapeRegex(tagName);
    const regex = new RegExp(
      `<(?:[A-Za-z_][\\w.-]*:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${escaped}>`,
      "gi"
    );
    const values = [];
    let match;
    while ((match = regex.exec(xml))) {
      const value = stripMarkup(match[1]);
      if (value) values.push(value);
    }
    if (values.length) return values;
  }
  return [];
}

function parseNumericPrice(value) {
  const cleaned = String(value || "")
    .replace(/,/g, "")
    .replace(/[^\d.+-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function extractSoapResult(outerXml) {
  const resultMatch = String(outerXml || "").match(
    /<(?:[A-Za-z_][\w.-]*:)?(?:CurrentOilPrice|GetOilPrice)Result(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?(?:CurrentOilPrice|GetOilPrice)Result>/i
  );
  if (!resultMatch) {
    throw new Error("OR ไม่ได้ส่ง CurrentOilPriceResult หรือ GetOilPriceResult กลับมา");
  }
  return decodeEmbeddedXml(resultMatch[1]);
}

function rowsFromKnownBlocks(inner) {
  const wrapperNames = [
    "DataAccess", "Table", "OilPrice", "OilPriceData", "PriceData",
    "Row", "ROW", "Item", "Record", "Data"
  ];
  const rows = [];

  for (const wrapper of wrapperNames) {
    const escaped = escapeRegex(wrapper);
    const regex = new RegExp(
      `<(?:[A-Za-z_][\\w.-]*:)?${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z_][\\w.-]*:)?${escaped}>`,
      "gi"
    );
    let match;
    while ((match = regex.exec(inner))) {
      const block = match[1];
      const product = allTagValues(block, ["PRODUCT", "PRODUCT_NAME", "OIL_NAME"])[0] || "";
      const priceText = allTagValues(block, ["PRICE", "OIL_PRICE", "PRICE_VALUE"])[0] || "";
      const effectiveAt = allTagValues(block, ["PRICE_DATE", "EFFECTIVE_DATE", "UPDATE_DATE", "DATE"])[0] || "";
      if (product && priceText) {
        rows.push({ product, price: parseNumericPrice(priceText), effectiveAt });
      }
    }
    if (rows.length) break;
  }

  return rows;
}

function rowsFromParallelTags(inner) {
  const products = allTagValues(inner, ["PRODUCT", "PRODUCT_NAME", "OIL_NAME"]);
  const prices = allTagValues(inner, ["PRICE", "OIL_PRICE", "PRICE_VALUE"]);
  const dates = allTagValues(inner, ["PRICE_DATE", "EFFECTIVE_DATE", "UPDATE_DATE"]);

  if (!products.length || !prices.length) return [];

  const count = Math.min(products.length, prices.length);
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      product: products[i],
      price: parseNumericPrice(prices[i]),
      effectiveAt: dates.length === 1 ? dates[0] : (dates[i] || "")
    });
  }
  return rows;
}

function parseSoapResponse(xmlText) {
  const inner = extractSoapResult(xmlText);

  let rawRows = rowsFromKnownBlocks(inner);
  if (!rawRows.length) rawRows = rowsFromParallelTags(inner);

  if (!rawRows.length) {
    const availableTags = [...inner.matchAll(/<([A-Za-z_][\w:.-]*)(?:\s[^>]*)?>/g)]
      .map(match => match[1].split(":").pop())
      .filter((value, index, list) => list.indexOf(value) === index)
      .slice(0, 12);

    throw new Error(
      `OR ส่ง XML กลับมาแต่ไม่พบฟิลด์ PRODUCT/PRICE` +
      (availableTags.length ? ` (พบแท็ก: ${availableTags.join(", ")})` : "")
    );
  }

  const rows = rawRows.map(row => {
    const product = row.product;
    const price = row.price;
    const effectiveAt = row.effectiveAt;
    const id = normalizeProductId(product);
    if (!id || !Number.isFinite(price) || price <= 0 || price >= 200) return null;
    return {
      id,
      label: labels[id] || product,
      product,
      price,
      unit: id === "ngv" ? "THB/KG" : "THB/L",
      effectiveAt: effectiveAt || null
    };
  }).filter(Boolean);

  if (!rows.length) {
    throw new Error("OR ส่งรายการราคากลับมา แต่ไม่มีผลิตภัณฑ์ที่แอพรองรับ");
  }

  const rank = row => {
    const text = row.product.toLowerCase();
    let score = 0;
    if (/premium|super|supreme|พรีเมียม/.test(text)) score -= 2;
    if (/b7/.test(text)) score += 1;
    if (/gasohol|แก๊สโซฮอล์/.test(text)) score += 1;
    if (row.effectiveAt) score += 1;
    return score;
  };

  const deduped = new Map();
  for (const row of rows) {
    const existing = deduped.get(row.id);
    if (!existing || rank(row) > rank(existing)) deduped.set(row.id, row);
  }

  const prices = [...deduped.values()].sort((a, b) => a.label.localeCompare(b.label, "th"));
  const dates = prices.map(item => Date.parse(item.effectiveAt)).filter(Number.isFinite);
  const effectiveAt = dates.length ? new Date(Math.max(...dates)).toISOString() : null;

  return { prices, effectiveAt };
}

async function readFixture() {
  const fixture = process.env.FUEL_PRICE_FIXTURE;
  if (!fixture) return null;
  const absolute = path.resolve(ROOT, fixture);
  const xml = await fsp.readFile(absolute, "utf8");
  return parseSoapResponse(xml);
}

function thailandDateParts() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date())
      .filter(part => part.type !== "literal")
      .map(part => [part.type, part.value])
  );
  return {
    DD: Number(parts.day),
    MM: Number(parts.month),
    YYYY: Number(parts.year)
  };
}

function soapRequestBody(operation, language) {
  if (operation === "GetOilPrice") {
    const { DD, MM, YYYY } = thailandDateParts();
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetOilPrice xmlns="http://www.pttor.com">
      <Language>${language}</Language>
      <DD>${DD}</DD>
      <MM>${MM}</MM>
      <YYYY>${YYYY}</YYYY>
    </GetOilPrice>
  </soap:Body>
</soap:Envelope>`;
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
               xmlns:xsd="http://www.w3.org/2001/XMLSchema"
               xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <CurrentOilPrice xmlns="http://www.pttor.com">
      <Language>${language}</Language>
    </CurrentOilPrice>
  </soap:Body>
</soap:Envelope>`;
}

async function requestPttSoap(operation, language) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    const response = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": `"https://orapiweb.pttor.com/${operation}"`,
        "User-Agent": "DriveCost/3.1.0 (+Render production)"
      },
      body: soapRequestBody(operation, language),
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`OR ตอบกลับ HTTP ${response.status}`);

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_UPSTREAM_BYTES) throw new Error("ข้อมูลจาก OR มีขนาดใหญ่เกินกำหนด");

    const xml = await response.text();
    if (Buffer.byteLength(xml) > MAX_UPSTREAM_BYTES) {
      throw new Error("ข้อมูลจาก OR มีขนาดใหญ่เกินกำหนด");
    }

    return parseSoapResponse(xml);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFromPtt() {
  const fixtureResult = await readFixture();
  if (fixtureResult) return fixtureResult;

  const attempts = [
    ["CurrentOilPrice", "EN"],
    ["CurrentOilPrice", "thai"],
    ["GetOilPrice", "EN"]
  ];
  const errors = [];

  for (const [operation, language] of attempts) {
    try {
      return await requestPttSoap(operation, language);
    } catch (error) {
      errors.push(`${operation}/${language}: ${error.message}`);
    }
  }

  throw new Error(`อ่านราคาจาก OR ไม่สำเร็จ — ${errors.join(" | ")}`);
}

async function getFuelPrices(force = false) {
  const now = Date.now();
  if (!force && memoryCache && now - memoryCache.cachedAt < CACHE_TTL_MS) {
    return { ...memoryCache.payload, cache: "fresh" };
  }

  if (upstreamRequestInFlight) {
    return upstreamRequestInFlight;
  }

  upstreamRequestInFlight = (async () => {
    try {
      const parsed = await fetchFromPtt();
      const payload = {
        provider: "PTT OR OilPrice Web Service",
        sourceUrl: UPSTREAM,
        fetchedAt: new Date().toISOString(),
        effectiveAt: parsed.effectiveAt,
        stale: false,
        prices: parsed.prices,
        disclaimer: "ราคาขายปลีกอ้างอิงจากผู้ให้บริการ อาจแตกต่างตามพื้นที่ ภาษีท้องถิ่น และสถานีบริการ"
      };
      memoryCache = { cachedAt: Date.now(), payload };
      return { ...payload, cache: force ? "refresh" : "miss" };
    } catch (error) {
      if (memoryCache && Date.now() - memoryCache.cachedAt < STALE_TTL_MS) {
        return {
          ...memoryCache.payload,
          stale: true,
          cache: "stale",
          warning: `Live update failed: ${error.message}`
        };
      }
      throw error;
    } finally {
      upstreamRequestInFlight = null;
    }
  })();

  return upstreamRequestInFlight;
}


function getFuelStatus() {
  return {
    cached: Boolean(memoryCache),
    cachedAt: memoryCache?.cachedAt
      ? new Date(memoryCache.cachedAt).toISOString()
      : null,
    ageMs: memoryCache?.cachedAt
      ? Date.now() - memoryCache.cachedAt
      : null,
    stale: memoryCache?.cachedAt
      ? Date.now() - memoryCache.cachedAt > CACHE_TTL_MS
      : null,
    inFlight: Boolean(upstreamRequestInFlight),
    upstream: UPSTREAM
  };
}

module.exports = {
  getFuelPrices,
  getFuelStatus,
  parseSoapResponse,
  normalizeProductId
};
