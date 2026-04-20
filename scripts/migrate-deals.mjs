import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dir, '..', 'db.json');

function detectProductType(model) {
  if (!model) return 'mac';
  const t = model.toLowerCase();
  if (/iphone|아이폰/.test(t)) return 'iphone';
  if (/ipad|아이패드/.test(t)) return 'ipad';
  if (/airpods|에어팟/.test(t)) return 'airpods';
  if (/apple watch|애플워치|애플 워치/.test(t)) return 'watch';
  return 'mac';
}

const db = JSON.parse(readFileSync(DB_PATH, 'utf-8'));
let updated = 0;

db.deals = db.deals.map(d => {
  const pt = detectProductType(d.model);
  const needsUpdate = !d.productType || d.productType === '미분류' || !d.ts;
  if (needsUpdate) {
    updated++;
    return {
      ...d,
      productType: d.productType || pt,
      ts: d.ts || new Date(d.date || '2026-04-01').getTime(),
    };
  }
  return d;
});

writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
console.log(`마이그레이션 완료: ${updated}건 업데이트`);

// 결과 검증
const types = {};
db.deals.forEach(d => { types[d.productType] = (types[d.productType]||0)+1; });
console.log('productType 분포:', JSON.stringify(types));
const hasUrl = db.deals.filter(d => d.storeUrl).length;
console.log(`storeUrl 보유: ${hasUrl}/${db.deals.length}건`);
