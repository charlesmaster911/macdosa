/**
 * 맥도사 API 서버 — Express + Claude API + 사용량 추적
 * 실행: node server.js
 */

import express from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import https from 'https';

const __dir = dirname(fileURLToPath(import.meta.url));

// .env 로드 (Render 등 배포 환경에서는 환경변수가 직접 주입됨)
const envPath = join(__dir, '.env');
if (existsSync(envPath)) {
  readFileSync(envPath, 'utf-8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length && !process.env[k.trim()]) process.env[k.trim()] = v.join('=').trim();
  });
}
const app = express();
const PORT = process.env.PORT || 3000;
const TOSS_CLIENT_KEY = process.env.TOSS_CLIENT_KEY;
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY;
if (!TOSS_CLIENT_KEY || !TOSS_SECRET_KEY) {
  console.warn('⚠️  TOSS 키 없음 — 결제 기능 비활성화 (베타 모드)');
}
const IS_BETA = !TOSS_SECRET_KEY;

if (!process.env.ADMIN_TOKEN) {
  console.error('❌ ADMIN_TOKEN 환경변수가 없습니다. .env 파일을 확인하세요.');
  process.exit(1);
}
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

app.use(express.json());

// 요청 로그
app.use((req, res, next) => {
  console.log(`${new Date().toISOString().slice(11,19)} ${req.method} ${req.url}`);
  next();
});

// HTML 파일 no-cache (JS 변경 즉시 반영)
app.use((req, res, next) => {
  if (req.url.endsWith('.html') || req.url === '/' || req.url === '/result' || req.url === '/admin') {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
  next();
});

app.use(express.static(__dir));

// CORS — 명시적 도메인만 허용
const ALLOWED_ORIGINS = ['http://localhost:3000', 'https://macdosa.com', 'https://www.macdosa.com', 'http://192.168.219.115:3000'];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 네이버 쇼핑 검색 API — 실시간 최저가 조회
async function searchNaverShopping(query) {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) { console.warn('⚠️ NAVER API 미설정'); return []; }
  try {
    const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(query)}&display=50&sort=lprice`;
    const res = await fetch(url, {
      headers: { 'X-Naver-Client-Id': clientId, 'X-Naver-Client-Secret': clientSecret },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) { console.error(`네이버 API ${res.status}`); return []; }
    const data = await res.json();
    return (data.items || []).map(i => ({
      title: i.title.replace(/<[^>]*>/g, ''),
      price: parseInt(i.lprice),
      link: i.link,
      mall: i.mallName,
      source: 'naver'
    })).filter(i => i.price > 1000).sort((a,b) => a.price - b.price);
  } catch (e) {
    console.error('❌ 네이버 쇼핑 오류:', e.message);
    return [];
  }
}

// 쿠팡 검색 + 직접 URL 처리
async function searchCoupang(query) {
  // 쿠팡 URL 직접 입력 감지
  const coupangUrlMatch = query.match(/coupang\.com\/vp\/products\/(\d+)/);
  if (coupangUrlMatch) {
    const productId = coupangUrlMatch[1];
    try {
      const res = await fetch(`https://www.coupang.com/vp/products/${productId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(5000)
      });
      if (res.ok) {
        const html = await res.text();
        const titleMatch = html.match(/"name"\s*:\s*"([^"]+)"/) || 
                           html.match(/"productName"\s*:\s*"([^"]+)"/) ||
                           html.match(/<h1[^>]*>([^<]+)<\/h1>/) ||
                           html.match(/<h2[^>]*>([^<]+)<\/h2>/);
        const priceMatch = html.match(/"lowestPrice"\s*:\s*(\d+)/) || 
                           html.match(/"price"\s*:\s*(\d+)/) ||
                           html.match(/"originalPrice"\s*:\s*(\d+)/) ||
                           html.match(/"deliveryFee"\s*:\s*(\d+)/);
        if (titleMatch && priceMatch) {
          return [{ title: titleMatch[1], price: parseInt(priceMatch[1]), link: query, mall: '쿠팡', source: 'coupang' }];
        }
      }
    } catch (e) {
      console.warn('⚠️ 쿠팡 직접 URL 파싱 실패:', e.message);
    }
  }

  try {
    const res = await fetch(`https://www.coupang.com/np/search?q=${encodeURIComponent(query)}&channel=search&sorter=scoreDesc`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const items = [];
    const matches = html.match(/"productId"\s*:\s*"?(\d+)"?[^}]*?(?:"displayName"|"name")\s*:\s*"([^"]+)"[^}]*?"(?:lowestPrice|deliveryFee)"\s*:\s*(\d+)/g) || [];
    const priceMatches = html.match(/"productId"\s*:\s*"?(\d+)"?[^}]*?"price"\s*:\s*(\d+)/g) || [];
    matches.slice(0, 5).forEach(m => {
      const [,pid,name,price] = m.match(/"productId"\s*:\s*"?(\d+)"?[^}]*?(?:"displayName"|"name")\s*:\s*"([^"]+)"[^}]*?"(?:lowestPrice|price)"\s*:\s*(\d+)/) || [];
      if (pid && name && price) items.push({
        title: name.slice(0, 80),
        price: parseInt(price),
        link: `https://www.coupang.com/vp/products/${pid}`,
        mall: '쿠팡',
        source: 'coupang'
      });
    });
    return items.filter(i => i.price > 1000);
  } catch (e) {
    console.error('⚠️ 쿠팡 검색 오류:', e.message);
    return [];
  }
}

// 당근마켓 중고가 검색
async function searchDangn(query) {
  try {
    const res = await fetch(`https://www.daangn.com/search/?keyword=${encodeURIComponent(query)}&type=general`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const items = [];
    const matches = html.match(/href="\/articles\/([^"]+)"[^>]*>([^<]*)[^<]*<[^>]*>([0-9,]+)원/g) || [];
    matches.slice(0, 5).forEach(m => {
      const [,id,title,price] = m.match(/\/articles\/([^"]+)"[^>]*>([^<]*)[^<]*<[^>]*>([0-9,]+)원/) || [];
      if (id && title && price) items.push({
        title: title.slice(0, 80),
        price: parseInt(price.replace(/,/g, '')),
        link: `https://www.daangn.com/articles/${id}`,
        mall: '당근마켓',
        source: 'dangn'
      });
    });
    return items.filter(i => i.price > 1000);
  } catch (e) {
    console.error('⚠️ 당근마켓 검색 오류:', e.message);
    return [];
  }
}

// 시세 분석 및 구매 타이밍 판정
function analyzePricing(items) {
  if (!items || items.length === 0) return null;
  const prices = items.map(i => i.price).filter(p => p > 0);
  const lowest = Math.min(...prices), avg = Math.round(prices.reduce((a,b) => a+b) / prices.length);
  const discount = Math.round((1 - lowest / Math.max(...prices)) * 100);
  const timing = lowest < avg * 0.85 ? '🔥 지금 구매 (최저가 기록)' : lowest < avg * 0.92 ? '✅ 지금 사세요 (평균 대비 8-15% 절감)' : '⏳ 가격 인하 기다리기';
  const malls = [...new Set(items.map(i => i.mall))].slice(0, 3);
  const shippingNote = lowest > 100000 ? '배송비 포함' : '배송비 추가 예상';
  
  const storageMatch = items[0]?.title?.match(/(\d+)gb/i)?.[1];
  const storageRecommendation = storageMatch && parseInt(storageMatch) < 512 
    ? '💡 512GB 이상으로 업그레이드 권장 (대용량 작업에 필수)' 
    : '';
  
  const shoppingPaths = items.length > 0 ? items.slice(0, 3).map((i, idx) => `${idx + 1}. ${i.mall}: ${i.price?.toLocaleString()}원`) : [];
  
  return { lowest, avg, discount, timing, malls, shippingNote, storageRecommendation, shoppingPaths, itemCount: items.length };
}

// 제품 종류 감지
function detectProductType(title) {
  if (!title) return 'mac';
  const t = title.toLowerCase();
  if (/iphone|아이폰/.test(t)) return 'iphone';
  if (/ipad|아이패드/.test(t)) return 'ipad';
  if (/airpods|에어팟/.test(t)) return 'airpods';
  if (/apple watch|애플워치|애플 워치/.test(t)) return 'watch';
  return 'mac';
}

// 제품 제목에서 네이버 검색 쿼리 추출
function extractProductQuery(title) {
  if (!title || title === '스크랩 실패' || title === 'URL 오류' || title === '페이지 오류') return '애플';
  const clean = title.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const type = detectProductType(clean);

  if (type === 'iphone') {
    const model = clean.match(/iphone\s*\d+(\s*(pro\s*max|pro|plus|mini))?/i)?.[0] || 'iPhone';
    const storage = clean.match(/(\d+\s*GB|\d+\s*TB)/i)?.[0] || '';
    const color = clean.match(/(블랙|화이트|블루|핑크|티타늄|내추럴|울트라마린|사막|실버|골드)/i)?.[0] || '';
    return [model, storage, color].filter(Boolean).join(' ').trim();
  }
  if (type === 'ipad') {
    const model = clean.match(/ipad\s*(pro|air|mini)?\s*(\d+[\s]?인치|\d+")?/i)?.[0] || 'iPad';
    const chip = clean.match(/M\d[\s]?(Pro|Max)?/i)?.[0] || '';
    const storage = clean.match(/(\d+\s*GB|\d+\s*TB)/i)?.[0] || '';
    return [model, chip, storage].filter(Boolean).join(' ').trim();
  }
  if (type === 'airpods') {
    const model = clean.match(/airpods\s*(pro|max)?\s*(\d세대)?/i)?.[0] || 'AirPods';
    return model;
  }
  if (type === 'watch') {
    const seriesMatch = clean.match(/series\s*(\d+)/i)?.[1];
    const sizeMatch = clean.match(/(\d{2}mm)/i)?.[0];
    const connectivity = clean.match(/(LTE|GPS|셀룰러|지피에스)/i)?.[0];
    const material = clean.match(/(알루미늄|스테인리스|티타늄)/i)?.[0];
    let query = '애플워치';
    if (seriesMatch) query += ` 시리즈 ${seriesMatch}`;
    if (sizeMatch) query += ` ${sizeMatch}`;
    if (connectivity) query += ` ${connectivity}`;
    if (material) query += ` ${material}`;
    return query.trim();
  }
  // Mac
  const chip = clean.match(/M\d[\s]?(Pro|Max|Ultra)?/i)?.[0] || '';
  const inch = clean.match(/(\d{2}[\s]?인치|\d{2}")/i)?.[0] || '';
  const mem = clean.match(/(\d+GB)/i)?.[0] || '';
  const storage = clean.match(/(\d+TB|\d+GB\s*(SSD)?)/gi)?.slice(-1)?.[0] || '';
  const base = /air/i.test(clean) ? 'MacBook Air' : /pro/i.test(clean) ? 'MacBook Pro' : '맥북';
  return [base, chip, inch, mem, storage].filter(Boolean).join(' ').trim() || '맥북';
}

// URL 스크랩 — 상품 제목/가격/설명 추출 (Claude에 컨텍스트 제공용)
async function scrapeProductInfo(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(10000)
    });
    const html = await res.text();

    const get = (pattern) => html.match(pattern)?.[1]?.trim() || null;

    // og 태그 / 타이틀 / JSON-LD 가격 추출
    const title = get(/property="og:title"\s+content="([^"]+)"/)
      || get(/<title>([^<]+)<\/title>/);
    const description = get(/property="og:description"\s+content="([^"]+)"/)
      || get(/name="description"\s+content="([^"]+)"/);

    // JSON-LD 구조화 데이터에서 가격 추출
    const jsonLdMatch = html.match(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
    let structuredPrice = null;
    if (jsonLdMatch) {
      try {
        const ld = JSON.parse(jsonLdMatch[1]);
        structuredPrice = ld?.offers?.price || ld?.price || null;
      } catch {}
    }

    // 페이지 내 숫자 가격 패턴 (쿠팡/네이버 등)
    const pricePattern = html.match(/["']price["']\s*:\s*["']?(\d{5,8})["']?/)
      || html.match(/(\d{1,3}(?:,\d{3})+)원/);
    const rawPrice = structuredPrice || pricePattern?.[1]?.replace(/,/g, '') || null;

    return {
      title: title?.slice(0, 200) || '제목 없음',
      price: rawPrice ? parseInt(rawPrice) : null,
      description: description?.slice(0, 300) || '',
      url
    };
  } catch (e) {
    console.error(`❌ 스크랩 실패 [${url}]:`, e.message);
    return { title: '스크랩 실패', price: null, description: `오류: ${e.message.slice(0, 50)}`, url, error: true };
  }
}

// Claude 호출 함수 — API (배포) / CLI (로컬 개발)
function callClaudeCLI(prompt) {
  return new Promise((resolve, reject) => {
    const proc = spawn('/usr/local/bin/claude', ['-p', prompt, '--model', 'claude-haiku-4-5-20251001', '--output-format', 'text', '--dangerously-skip-permissions'], {
      env: process.env, cwd: '/tmp', stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '', err = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { proc.kill(); reject(new Error('180s 타임아웃')); }, 180000);
    proc.on('close', code => { clearTimeout(timer); code !== 0 ? reject(new Error(err || 'CLI 오류')) : resolve(out); });
    proc.on('error', reject);
  });
}

function callClaudeAPI(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }]
    });
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.content?.[0]?.text || '');
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    const timer = setTimeout(() => { req.destroy(); reject(new Error('180s 타임아웃')); }, 180000);
    req.on('close', () => clearTimeout(timer));
    req.write(body);
    req.end();
  });
}

// DB — 로컬 JSON (Supabase 연동 전 임시 저장소)
const DB_PATH = join(__dir, 'db.json');
const EMPTY_DB = { users: [], analyses: [], purchases: [], alerts: [], deals: [] };

function readDB() {
  if (!existsSync(DB_PATH)) return { ...EMPTY_DB };
  return JSON.parse(readFileSync(DB_PATH, 'utf-8'));
}

function writeDB(data) {
  writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function getFreeUsage(ip) {
  const db = readDB();
  const d = today();
  return db.analyses.filter(a => a.ip === ip && a.date === d && a.tier === 'free').length;
}

function issueToken(email) {
  return Buffer.from(`${email}:${Date.now()}`).toString('base64');
}

// 유저 프로필 upsert — 이메일 기준으로 생성/업데이트
function upsertUser(db, { email, ip, source, url, analysisId, purchaseId }) {
  if (!db.users) db.users = [];
  let user = db.users.find(u => u.email === email);
  if (!user) {
    user = { id: Date.now().toString(), email, ip, source, createdAt: new Date().toISOString(), analyses: [], purchases: [], urls: [] };
    db.users.push(user);
  }
  if (ip && !user.ip) user.ip = ip;
  if (analysisId && !user.analyses.includes(analysisId)) user.analyses.push(analysisId);
  if (purchaseId && !user.purchases.includes(purchaseId)) user.purchases.push(purchaseId);
  if (url && !user.urls.includes(url)) user.urls.push(url);
  user.lastSeenAt = new Date().toISOString();
  return user;
}

// 재고 처분 플래시세일 감지 — 동일 업체가 단기간 저가 반복 = 재고 소진 시그널
function detectFlashSales(deals, productType) {
  if (!deals || deals.length < 3) return null;

  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const recent = deals.filter(d => {
    if (!d.finalPrice || !d.store) return false;
    const dealTs = d.ts || (d.date ? new Date(d.date).getTime() : 0);
    if ((now - dealTs) >= sevenDays) return false;
    if (productType) {
      const dealType = d.productType || detectProductType(d.model || '');
      if (dealType !== productType) return false;
    }
    return true;
  });
  if (recent.length < 2) return null;

  // 업체별 최근 7일 등장 횟수 + 평균가 vs 전체 평균 비교
  const allAvg = (() => {
    const filtered = deals.filter(d => {
      if (!d.finalPrice) return false;
      if (productType) {
        const dealType = d.productType || detectProductType(d.model || '');
        return dealType === productType;
      }
      return true;
    });
    if (filtered.length === 0) return 0;
    return filtered.reduce((s, d) => s + d.finalPrice, 0) / filtered.length;
  })();
  if (!allAvg) return null;

  const byStore = {};
  recent.forEach(d => {
    if (!byStore[d.store]) byStore[d.store] = { prices: [], urls: [], conditions: [] };
    byStore[d.store].prices.push(d.finalPrice);
    if (d.storeUrl) byStore[d.store].urls.push(d.storeUrl);
    if (d.condition) byStore[d.store].conditions.push(d.condition);
  });

  const signals = [];
  for (const [store, data] of Object.entries(byStore)) {
    const avgPrice = data.prices.reduce((s, p) => s + p, 0) / data.prices.length;
    const dropRatio = (allAvg - avgPrice) / allAvg;
    const appearCount = data.prices.length;

    if (appearCount >= 2 && dropRatio > 0.05) {
      const latestUrl = data.urls.slice(-1)[0] || null;
      signals.push({
        store,
        dropRatio: Math.round(dropRatio * 100),
        avgPrice: Math.round(avgPrice),
        appearCount,
        latestUrl,
        latestCondition: data.conditions.slice(-1)[0] || null,
      });
    }
  }

  if (signals.length === 0) return null;

  const lines = signals
    .sort((a, b) => b.dropRatio - a.dropRatio)
    .slice(0, 3)
    .map(s => {
      const urlNote = s.latestUrl ? ` (최근 링크: ${s.latestUrl})` : '';
      return `⚡ ${s.store} — 7일간 ${s.appearCount}회 등장, 전체 평균보다 ${s.dropRatio}% 저렴 (${Math.round(s.avgPrice/10000)}만원대)${urlNote}`;
    });

  return `[재고 처분 플래시세일 감지 — 업체 자금흐름 이상 신호]\n` + lines.join('\n');
}

// DB 패턴 분석 — 누적 딜 데이터에서 인텔리전스 추출
function analyzeDealsDB(deals) {
  if (!deals || deals.length < 3) return null;

  // 판매처별 평균 할인율
  const byStore = {};
  deals.forEach(d => {
    if (!d.store) return;
    if (!byStore[d.store]) byStore[d.store] = { count: 0, totalSave: 0, dealTypes: [] };
    byStore[d.store].count++;
    if (d.saveAmount) byStore[d.store].totalSave += d.saveAmount;
    if (d.dealType) byStore[d.store].dealTypes.push(d.dealType);
  });

  const storeStats = Object.entries(byStore)
    .sort((a, b) => (b[1].totalSave / b[1].count) - (a[1].totalSave / a[1].count))
    .slice(0, 5)
    .map(([store, s]) => `${store}: 평균 ${Math.round(s.totalSave / s.count / 10000)}만원 절약, ${s.count}건`)
    .join(' / ');

  // 가장 자주 등장한 카드
  const cardCount = {};
  deals.forEach(d => { if (d.cardName) cardCount[d.cardName] = (cardCount[d.cardName] || 0) + 1; });
  const topCards = Object.entries(cardCount)
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([name, cnt]) => `${name}(${cnt}건)`).join(', ');

  // 딜 타입 분포
  const dealTypeCount = {};
  deals.forEach(d => { if (d.dealType) dealTypeCount[d.dealType] = (dealTypeCount[d.dealType] || 0) + 1; });
  const topDealTypes = Object.entries(dealTypeCount)
    .sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([t, c]) => `${t}(${c}건)`).join(', ');

  // 최대 절약 사례
  const bestDeal = deals.filter(d => d.saveAmount).sort((a, b) => b.saveAmount - a.saveAmount)[0];
  const bestDealStr = bestDeal
    ? `역대 최고 절약: ${bestDeal.store} ${bestDeal.dealType} ${Math.round(bestDeal.saveAmount/10000)}만원 절약 (${bestDeal.date})`
    : null;

  // 중고 시세 학습
  const usedDeals = deals.filter(d => d.isUsed && d.finalPrice);
  const newDeals = deals.filter(d => !d.isUsed && d.finalPrice);
  let usedRatio = null;
  if (usedDeals.length > 0 && newDeals.length > 0) {
    const avgUsed = usedDeals.reduce((s, d) => s + d.finalPrice, 0) / usedDeals.length;
    const avgNew = newDeals.reduce((s, d) => s + d.finalPrice, 0) / newDeals.length;
    usedRatio = `중고 평균 신품의 ${Math.round(avgUsed / avgNew * 100)}% 수준`;
  }

  return [
    `[누적 학습 인텔리전스 — ${deals.length}건 분석 결과]`,
    storeStats ? `▸ 절약 효율 TOP 판매처: ${storeStats}` : null,
    topCards ? `▸ 자주 쓰이는 카드: ${topCards}` : null,
    topDealTypes ? `▸ 많이 발견된 딜 유형: ${topDealTypes}` : null,
    bestDealStr ? `▸ ${bestDealStr}` : null,
    usedRatio ? `▸ 중고 시세: ${usedRatio}` : null,
  ].filter(Boolean).join('\n');
}

// 정적 페이지 라우트
const PAGES = { '/': 'index.html', '/result': 'result.html', '/admin': 'admin.html' };
for (const [route, file] of Object.entries(PAGES)) {
  app.get(route, (req, res) => res.sendFile(join(__dir, file)));
}

// POST /api/analyze — FREE: 하루 1회, ONE-TIME/PRO: 무제한
app.post('/api/analyze', async (req, res) => {
  const { url, email, token, scraped_title, scraped_price } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!url) return res.status(400).json({ error: 'URL이 필요합니다' });


  const db = readDB();
  const purchase = token ? db.purchases.find(p => p.token === token && (p.status === 'paid' || p.status === 'beta')) : null;
  const tier = purchase ? purchase.tier : 'free';

  const isLocalhost = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const isTestMode = req.headers['x-test-token'] === ADMIN_TOKEN || isLocalhost;
  const freeUsed = getFreeUsage(ip);
  const todayBonus = ((db.bonuses || []).filter(b => b.ip === ip && b.date === today()).reduce((s, b) => s + b.uses, 0));
  const allowedTotal = 3 + todayBonus;
  if (tier === 'free' && freeUsed >= allowedTotal && !isTestMode) {
    return res.status(403).json({
      error: '무료 분석은 하루 1회입니다',
      code: 'FREE_LIMIT',
      upgradeUrl: '/#pricing'
    });
  }

  try {
    // URL 여부 판단 — URL이 아닌 텍스트 스펙 입력 처리
    const isUrl = /^https?:\/\//i.test(url);
    let productInfo;
    if (scraped_title) {
      productInfo = { title: scraped_title, price: scraped_price ? parseInt(scraped_price) : null, description: '', url };
    } else if (!isUrl) {
      // 텍스트 스펙 직접 입력 (예: "맥북 m4 32gb 14")
      productInfo = { title: url, price: null, description: '', url: null };
    } else {
      productInfo = await scrapeProductInfo(url);
    }

    // 비애플 제품 차단 (삼성/LG/윈도우 등)
    const titleKnown = productInfo.title && productInfo.title !== '스크랩 실패' && productInfo.title !== '제목 없음';
    const isNonApple = titleKnown && /galaxy|갤럭시|windows|갤탭|LG그램|삼성노트북|레노버|ThinkPad|XPS|Surface\s|델\s|HP\s/i.test(productInfo.title);
    if (isNonApple) {
      return res.status(400).json({
        error: '맥도사는 애플 제품 전문입니다 🍎\nMacBook · iPhone · iPad · AirPods · Apple Watch\n\n혹시 애플 제품으로 환승을 고민 중이시라면,\n위 제품 모델명이나 링크를 입력해보세요!',
        code: 'NOT_APPLE',
        suggestions: ['MacBook Air M3', 'iPhone 16', 'iPad Pro M4', 'AirPods Pro 2세대', 'Apple Watch Series 10']
      });
    }

    // 검색결과/카탈로그 URL 서버측 차단
    const isSearchOrCatalog = isUrl && /search\.shopping\.naver\.com\/(search|catalog\/)|search\.naver\.com\/search|coupang\.com\/np\/search|danawa\.com\/search\?/i.test(url);
    if (isSearchOrCatalog) {
      return res.status(400).json({
        error: '검색결과 페이지가 아닌 상품 상세 페이지 URL을 입력해주세요.',
        code: 'SCRAPE_FAILED'
      });
    }

    // 스크랩 실패 + 모델 특정 불가 → 에러 반환 (AI 환각 방지)
    const scrapeFailed = !titleKnown || productInfo.title === '스크랩 실패';
    if (scrapeFailed && isUrl) {
      return res.status(400).json({
        error: 'URL에서 상품 정보를 읽지 못했어요.\n스크린샷을 찍어서 업로드하면 AI가 직접 분석해드립니다.',
        code: 'SCRAPE_FAILED'
      });
    }

    const coupangId = url.match(/coupang\.com\/vp\/products\/(\d+)/)?.[1];

    const deals = db.deals || [];

    // 1. 최근 raw 딜 — 같은 제품 타입 우선, 최근 30건
    const recentDeals = [...deals]
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .filter((_, i) => i < 60)
      .filter(d => !d.productType || d.productType === detectProductType(productInfo.title))
      .slice(0, 30)
      .map(d => {
        const urlNote = d.storeUrl ? ` 🔗${d.storeUrl}` : '';
        return `[${d.date}] ${d.store} | ${d.dealType} | ${d.cardName || '-'} ${d.discountRate || ''} | 조건: ${d.condition || '-'} | 최종가: ${d.finalPrice ? Math.round(d.finalPrice/10000)+'만원' : '-'}${urlNote}`;
      })
      .join('\n');

    // 2. DB 패턴 분석 — 누적 학습 지식 추출
    const learnedIntel = analyzeDealsDB(deals);

    // 경연 브레인 인텔 — 승리 횟수 높은 순 정렬, 챔피언 전략 강제 주입
    const champion = db.champion;
    const brainIntel = (() => {
      const intel = db.brain_intel || [];
      if (intel.length === 0 && !champion) return '';

      // 챔피언 전략 풀텍스트
      const championBlock = champion ? [
        `━━━ 챔피언 우승 전략 (반드시 이 경로 먼저 검색) ━━━`,
        `챔피언: ${champion.name} (${champion.totalWins}승)`,
        `핵심 전략: ${champion.strategy}`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ].join('\n') : '';

      // 승리 횟수 높은 인텔 TOP5
      const sorted = [...intel].sort((a, b) => (b.wins || 1) - (a.wins || 1)).slice(0, 5);
      const intelLines = sorted.map(i =>
        `▸ 우승전략(${i.winner}) @ ${i.bestStore} ${i.finalPrice ? Math.round(i.finalPrice/10000)+'만원' : ''} — ${i.keyInsight}`
      );

      return [
        championBlock,
        `[경연 누적 브레인 — ${intel.length}건 학습 완료]`,
        ...intelLines,
      ].filter(Boolean).join('\n');
    })();

    // 챔피언 검색 경로 동적 추출
    const championSearchHints = (() => {
      if (!champion) return [];
      const s = champion.strategy || '';
      const hints = [];
      if (s.includes('다나와')) hints.push(`"다나와 맥북 현금최저가" 검색 (챔피언 전략 핵심)`);
      if (s.includes('삼성카드')) hints.push(`"삼성카드 맥북 즉시할인 ${new Date().toISOString().slice(0,10)}" 검색`);
      if (s.includes('현대카드')) hints.push(`"현대카드 맥북 즉시할인" 검색`);
      if (s.includes('롯데하이마트') || s.includes('원데이딜')) hints.push(`"롯데하이마트 맥북 원데이딜" 검색`);
      if (s.includes('11번가')) hints.push(`"11번가 맥북 슈퍼딜" 검색`);
      if (hints.length === 0) hints.push(`"다나와 맥북 최저가" 검색`, `"삼성카드 맥북 즉시할인" 검색`);
      return hints;
    })();

    // 네이버 쇼핑 API 실시간 가격 조회
    const productType = detectProductType(productInfo.title);
    const modelQuery = extractProductQuery(productInfo.title);
    const naverItems = await searchNaverShopping(modelQuery);

    // 고객 가격 vs 네이버 최저가 비교
    const customerPrice = productInfo.price;
    const naverLowest = naverItems && naverItems.length > 0
      ? Math.min(...naverItems.map(i => parseInt(i.lprice)).filter(p => p > 0))
      : null;
    const isAlreadyLowest = customerPrice && naverLowest && customerPrice <= naverLowest;

    // 네이버 API 없을 때 브레인 데이터로 폴백 paths 생성
    const brainFallbackPaths = (() => {
      if (naverItems && naverItems.length > 0) return [];
      const typedDeals = (db.deals || []).filter(d =>
        d.productType === productType && d.finalPrice && d.store
      ).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 20);
      if (typedDeals.length < 2) return [];
      const byStore = {};
      typedDeals.forEach(d => {
        if (!byStore[d.store] || byStore[d.store].finalPrice > d.finalPrice) byStore[d.store] = d;
      });
      return Object.values(byStore).sort((a, b) => a.finalPrice - b.finalPrice).slice(0, 5).map((d, i) => ({
        rank: i + 1, store: d.store, isUsed: d.isUsed || false, usedGrade: null,
        dealType: d.dealType || '학습 데이터', cardName: d.cardName || null,
        discountRate: d.discountRate || null, couponInfo: d.couponInfo || null,
        condition: (d.condition || '') + ' (브레인 학습 데이터 기반)',
        price: d.price, finalPrice: d.finalPrice, saveAmount: d.saveAmount || 0, url: d.storeUrl || null,
      }));
    })();

    const naverPriceBlock = (() => {
      if (!naverItems || naverItems.length === 0) {
        if (brainFallbackPaths.length > 0) {
          const lines = brainFallbackPaths.map(p =>
            `  - ${p.store} | ${p.finalPrice.toLocaleString()}원 | ${p.dealType} | ${p.condition}`);
          return `━━━ 브레인 학습 데이터 (네이버 API 미응답 시 폴백) ━━━\n${lines.join('\n')}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
        }
        return '네이버 API 데이터 없음 (학습 데이터로 추정)';
      }
      const lines = naverItems.slice(0, 8).map(item => {
        const title = item.title.replace(/<[^>]+>/g, '');
        return `  - ${item.mallName} | ${parseInt(item.lprice).toLocaleString()}원 | ${title} | ${item.link}`;
      });
      const block = `━━━ 네이버 쇼핑 실시간 최저가 (API 직접 조회) ━━━
검색어: "${modelQuery}"
${lines.join('\n')}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
고객 입력 가격: ${customerPrice ? customerPrice.toLocaleString()+'원' : '미확인'}
네이버 최저가: ${naverLowest ? naverLowest.toLocaleString()+'원' : '미확인'}
가격 비교 결과: ${isAlreadyLowest ? '✅ 이미 최저가 (고객이 잘 찾음)' : naverLowest && customerPrice ? `⚡ ${(customerPrice - naverLowest).toLocaleString()}원 더 절약 가능` : '비교 불가'}`;
      return block;
    })();

    const today_str = new Date().toISOString().slice(0,10);
    const productTypeLabel = { mac: '맥북', iphone: '아이폰', ipad: '아이패드', airpods: '에어팟', watch: '애플워치' }[productType] || '애플 제품';
    const productTypeHints = {
      iphone: `※ iPhone 분석 필수 포함사항:
- 자급제 최저가: 쿠팡/11번가/G마켓 가격 기준
- SKT/KT/LGU+ 공시지원금 vs 선택약정 25% 중 유리한 쪽 명시
- 자급제 vs 통신사 약정 24개월 총비용 비교 (요금제 포함)
- 현대카드·삼성카드·KB카드 즉시할인 조건 반드시 paths에 포함
- paths 1위: 자급제 최저가 (카드할인 적용), 2-3위: 통신사 공시지원금 추천 조합
- ★★★ 예산 배려 필수: 분석 제품이 90만원 초과 시, paths 마지막에 반드시 포함:
  • iPhone SE 4세대 (2025 출시, 89만원~, A18칩, 6.1인치, 예산 절약 대안)
  • 중고 iPhone 15 (번개장터/중고나라 70~85만원대, 직전 세대)
  verdict.desc에 예산 맞는 대안 한 줄 언급 필수`,
      ipad: `※ iPad 분석 필수 포함사항:
- Wi-Fi vs Cellular 모델 구분 (가격차 10~15만원)
- 애플 교육할인 적용 여부 (학생·교직원 10% 추가 할인)
- 법인카드·회사카드 할인: 현대카드M 10%·KB국민카드 5%·삼성카드 7% 즉시할인
- 쿠팡/11번가/애플공식/다나와 가격 비교
- paths에 반드시: 1위 최저가, 2위 카드할인 조합, 3위 애플공식(학생/법인)`,
      mac: `※ Mac 분석 주의사항:
- 카드사 즉시할인 (삼성/현대/롯데카드)
- 교육할인 vs 일반가 비교
- 다나와 현금최저가 확인`,
      airpods: `※ AirPods 분석: 정품 vs 리퍼 비교, 쿠팡 로켓배송 최저가 확인`,
      watch: `※ Apple Watch 분석: GPS vs Cellular, 소재(알루미늄/스테인리스) 구분`,
    }[productType] || '';

    const prompt = `애플 제품 최저가 구매 분석입니다. 고객이 준 제품을 네이버 쇼핑 실시간 데이터와 비교해 최적 구매 경로를 JSON으로 반환하세요.

오늘 날짜: ${today_str}
제품 유형: ${productTypeLabel}
분석 URL: ${url}

━━━ 고객 상품 정보 ━━━
제품명: ${productInfo.title}
고객 현재 가격: ${customerPrice ? customerPrice.toLocaleString() + '원' : '미확인'}
━━━━━━━━━━━━━━━━━━━

${naverPriceBlock}

${productTypeHints}
${brainIntel || ''}
${learnedIntel || ''}
${detectFlashSales(db.deals, productType) || ''}
[최근 딜 (30건)]
${recentDeals || '없음'}

━━━ 분석 로직 ━━━
1. 고객 가격 vs 네이버 최저가 비교:
   - 이미 최저가 → verdict.alreadyLowest=true, "잘 찾으셨어요! 현재 최저가입니다" 멘트
   - 더 싼 곳 있음 → 절약 경로 제시, saveAmount = 고객가 - 네이버최저가
2. paths: 네이버 API 실제 데이터 우선. url 필드에 실제 링크 반드시 포함.
3. 데이터 없는 경로는 추정 (condition에 "추정" 명시).
4. paths 최소 3개. 응답은 JSON만.

━━━ JSON 형식으로만 응답 (json 코드블록 포함 가능, 다른 텍스트 금지) ━━━

{
  "model": "정확한 모델명 (예: iPhone 16 Pro 256GB 블랙 / MacBook Pro 14인치 M4 Pro 24GB 1TB)",
  "currentPrice": 숫자(분석 URL 현재 판매가),
  "saveAmount": 숫자(최적 경로 적용 시 신품 정가 대비 총 절약액),
  "tian": {
    "title": "30일 시세 흐름 한 줄",
    "body": "현재 가격이 최근 30일 중 어느 위치인지, 가격이 오르는지 내리는지 2문장",
    "value": "저점/고점/보통",
    "status": "good/warning/normal"
  },
  "di": {
    "title": "오늘 발견된 딜 한 줄",
    "body": "신품·중고 통틀어 오늘 가장 좋은 딜 구체적으로 2문장 (판매처·가격·조건 명시)",
    "value": "원데이딜 발견/중고 추천/딜 없음",
    "status": "good/warning/normal"
  },
  "ren": {
    "title": "지금 살지 기다릴지 판단 한 줄",
    "body": "신모델 출시 일정·시즌·현재 시세 종합해서 2문장",
    "value": "지금 구매 추천/대기 추천/중립",
    "status": "good/warning/normal"
  },
  "verdict": {
    "buy": true또는false,
    "alreadyLowest": true또는false,
    "title": "최종 한 줄 결론 (이미 최저가면 '잘 찾으셨어요! 현재 최저가입니다 🎉')",
    "desc": "이미 최저가면 칭찬 멘트. 아니면 절약 경로 안내 2문장."
  },
  "paths": [
    {
      "rank": 1,
      "store": "판매처명",
      "isUsed": false,
      "usedGrade": null,
      "dealType": "원데이딜/카드할인/쿠폰/교육할인/리퍼/중고",
      "cardName": "카드명 또는 null",
      "discountRate": "할인율 예:7% 또는 null",
      "couponInfo": "쿠폰 조건 또는 null",
      "condition": "구매 조건 구체적으로 (예: 현대카드 30만원 이상 7% 즉시할인, 당일 한정)",
      "price": 숫자(신품 정가),
      "finalPrice": 숫자(모든 할인 적용 후 실제 결제가),
      "saveAmount": 숫자(신품 정가 대비 절약액),
      "url": "해당 판매처 직접 상품 링크 URL (네이버 API 데이터에서 제공된 링크 우선, 없으면 null)"
    }
  ],
  "usedMarket": {
    "macmuseum": "맥뮤지엄 현재 매물 가격대 또는 null",
    "daangn": "당근마켓 최근 실거래가 범위 또는 null",
    "joongna": "중고나라/번개장터 최저가 또는 null",
    "appleRefurb": "애플 공인 리퍼 현재가 또는 null",
    "priceRange": "중고 실거래가 범위 (예: 180~210만원)",
    "vsNewRatio": "신품 대비 % (예: 신품의 73%)",
    "recommendation": "중고 추천 여부와 이유 한 줄"
  },
  "cards": [
    {
      "name": "카드명",
      "discount": "할인율",
      "condition": "조건",
      "benefit": "즉시할인/청구할인/캐시백",
      "color": "#hex색상코드"
    }
  ],
  "timing": {
    "modelAge": "출시 후 몇 개월 (예: 6개월)",
    "nextModelRumor": "M5 출시 예상 시점 또는 null",
    "season": "현재 시즌 (예: 일반/블프/개학)",
    "advice": "타이밍 관점 한 줄 조언"
  },
  "vatRefund": 숫자(사업자 부가세 환급 예상액),
  "priceHistory": [30개 숫자 배열, 만원 단위, 오늘이 마지막]
}`;

    // Claude 호출 — API 키 있으면 Anthropic API, 없으면 CLI (로컬 개발용)
    const stdout = process.env.ANTHROPIC_API_KEY
      ? await callClaudeAPI(prompt)
      : await callClaudeCLI(prompt);

    let analysis;
    try {
      const clean = stdout.replace(/```json\n?|```\n?/g, '');
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      if (start === -1 || end === -1) throw new Error('JSON 없음');
      analysis = JSON.parse(clean.slice(start, end + 1));
    } catch {
      // JSON 파싱 실패 시 기본 구조 반환 (서비스 중단 방지)
      analysis = {
        model: '맥북 (모델 확인 필요)',
        currentPrice: null,
        saveAmount: null,
        tian: { title: '시세 분석 중', body: '잠시 후 다시 시도해주세요.', value: '보통', status: 'normal' },
        di: { title: '딜 확인 중', body: '현재 딜 정보를 불러오는 중입니다.', value: '딜 없음', status: 'normal' },
        ren: { title: '타이밍 분석 중', body: '분석을 완료하지 못했습니다.', value: '중립', status: 'normal' },
        verdict: { buy: false, title: '분석 재시도 필요', desc: stdout?.slice(0, 300) || '응답 없음' },
        paths: [],
        usedMarket: { macmuseum: null, daangn: null, joongna: null, appleRefurb: null, priceRange: null, vsNewRatio: null, recommendation: null },
        cards: [],
        timing: { modelAge: null, nextModelRumor: null, season: '일반', advice: null },
        vatRefund: 0,
        priceHistory: []
      };
    }

    // paths 폴백 — AI가 빈 배열 반환 시 네이버 → 브레인 순으로 채움
    if (!analysis.paths || analysis.paths.length === 0) {
      if (naverItems && naverItems.length > 0) {
        analysis.paths = naverItems.slice(0, 5).map((item, i) => ({
          rank: i + 1, store: item.mallName, isUsed: false, usedGrade: null,
          dealType: '최저가', cardName: null, discountRate: null, couponInfo: null,
          condition: '네이버 쇼핑 최저가 기준',
          price: parseInt(item.lprice), finalPrice: parseInt(item.lprice),
          saveAmount: customerPrice ? Math.max(0, customerPrice - parseInt(item.lprice)) : 0,
          url: item.link,
        }));
      } else if (brainFallbackPaths.length > 0) {
        analysis.paths = brainFallbackPaths;
      }
    }

    // paths finalPrice 보완 — 0이거나 없으면 네이버 데이터로 채움
    if (analysis.paths && naverItems) {
      analysis.paths = analysis.paths.map((p, i) => {
        const fallbackPrice = naverItems[i] ? parseInt(naverItems[i].lprice) : 0;
        return {
          ...p,
          finalPrice: p.finalPrice || p.price || fallbackPrice || null,
          url: p.url || naverItems[i]?.link || null,
        };
      });
    }

    // 딜 정보 DB 누적 저장 (paths 각각)
    if (!db.deals) db.deals = [];
    if (analysis.paths) {
      for (const p of analysis.paths) {
        if (p.finalPrice) {
          db.deals.push({
            date: today(),
            ts: Date.now(),
            model: analysis.model,
            productType: detectProductType(analysis.model),
            store: p.store,
            dealType: p.dealType || '기본가',
            cardName: p.cardName || null,
            discountRate: p.discountRate || null,
            couponInfo: p.couponInfo || null,
            condition: p.condition || null,
            price: p.price,
            finalPrice: p.finalPrice,
            saveAmount: p.saveAmount,
            storeUrl: p.url || null,
            sourceUrl: url
          });
        }
      }
      // deals는 최근 500건만 유지
      if (db.deals.length > 500) db.deals = db.deals.slice(-500);
    }

    const record = {
      id: Date.now().toString(),
      ip, email: email || null, url, tier,
      date: today(),
      model: analysis.model,
      currentPrice: analysis.currentPrice,
      saveAmount: analysis.saveAmount,
      bestStore: analysis.paths?.[0]?.store,
      bestFinalPrice: analysis.paths?.[0]?.finalPrice || analysis.paths?.[0]?.price,
      paths: analysis.paths?.slice(0, 3).map(p => ({ store: p.store, finalPrice: p.finalPrice || p.price, saveAmount: p.saveAmount })),
      createdAt: new Date().toISOString()
    };
    db.analyses.push(record);
    // 이메일 있으면 유저 프로필에 분석 기록 연결
    if (email) upsertUser(db, { email, ip, source: 'analyze', url, analysisId: record.id });
    writeDB(db);

    // FREE: 1위만 부분 공개, 2위 이하와 카드 조합은 잠금
    if (tier === 'free' && analysis.paths) {
      analysis.paths = analysis.paths.map((p, i) => ({ ...p, url: null, locked: i > 0 }));
      analysis.cards = analysis.cards?.map(c => ({ ...c, locked: true })) || [];
    }

    res.json({ success: true, tier, analysisId: record.id, data: analysis });

  } catch (err) {
    console.error('분석 오류:', err.message);
    res.status(500).json({ error: '분석 중 오류 발생: ' + err.message });
  }
});

// POST /api/payment/initiate — 토스페이먼츠 결제 시작
app.post('/api/payment/initiate', async (req, res) => {
  const { email, payType, url: macUrl } = req.body;

  if (!email) return res.status(400).json({ error: '이메일 필요' });

  const PRICE_MAP = {
    ONETIME: 9900,
    SUBSCRIPTION_MONTHLY: 19900,
    SUBSCRIPTION_ANNUAL: 99000
  };
  const NAME_MAP = {
    ONETIME: '맥도사 구매경로 잠금해제',
    SUBSCRIPTION_MONTHLY: '맥도사 Pro 월간',
    SUBSCRIPTION_ANNUAL: '맥도사 Pro 연간'
  };
  const amount = PRICE_MAP[payType] || 9900;
  const orderId = `macdosa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // 베타 기간: 이메일만 수집하고 즉시 해제
  if (IS_BETA) {
    const db = readDB();
    const token = issueToken(email);
    const purchaseRecord = {
      id: orderId, email, payType, amount,
      token, tier: payType === 'ONETIME' ? 'one-time' : 'pro',
      status: 'beta', createdAt: new Date().toISOString()
    };
    db.purchases.push(purchaseRecord);
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    upsertUser(db, { email, ip, source: 'purchase', url: macUrl, purchaseId: orderId });
    writeDB(db);
    return res.json({ betaAccess: true, token });
  }

  const tossParams = new URLSearchParams({
    clientKey: TOSS_CLIENT_KEY,
    amount, orderId,
    orderName: NAME_MAP[payType],
    customerEmail: email,
    successUrl: `${req.protocol}://${req.get('host')}/api/payment/confirm`,
    failUrl: `${req.protocol}://${req.get('host')}/result?error=payment_failed&url=${encodeURIComponent(macUrl)}`
  });

  res.json({
    tossUrl: `https://pay.toss.im/v2/checkout?${tossParams}`,
    orderId
  });
});

// GET /api/payment/confirm — 토스페이먼츠 결제 완료 후 리다이렉트
app.get('/api/payment/confirm', async (req, res) => {
  const { paymentKey, orderId, amount } = req.query;

  try {
    const confirmRes = await fetch('https://api.tosspayments.com/v1/payments/confirm', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(TOSS_SECRET_KEY + ':').toString('base64')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ paymentKey, orderId, amount: parseInt(amount) })
    });

    if (!confirmRes.ok) return res.redirect('/result?error=payment_confirm_failed');

    const payData = await confirmRes.json();
    const db = readDB();
    const token = issueToken(payData.customerEmail);
    db.purchases.push({
      id: orderId, email: payData.customerEmail,
      paymentKey, amount: payData.totalAmount,
      token, tier: payData.totalAmount === 9900 ? 'one-time' : 'pro',
      status: 'paid', createdAt: new Date().toISOString()
    });
    writeDB(db);

    res.redirect(`/result?token=${token}&paid=1`);

  } catch {
    res.redirect('/result?error=server_error');
  }
});

// GET /api/admin/stats — 어드민 대시보드 통계 (Bearer 인증)
app.get('/api/admin/stats', (req, res) => {
  if (req.headers.authorization !== `Bearer ${ADMIN_TOKEN}`) {
    return res.status(401).json({ error: '인증 필요' });
  }

  const db = readDB();
  const thisMonth = new Date().toISOString().slice(0, 7);
  const paidPurchases = db.purchases.filter(p => p.status === 'paid' || p.status === 'beta');
  const monthly = paidPurchases.filter(p => p.createdAt.startsWith(thisMonth));

  const mrr = paidPurchases
    .filter(p => p.tier === 'pro')
    .reduce((sum, p) => sum + (p.amount === 99000 ? Math.round(99000 / 12) : p.amount), 0);

  const conversionRate = db.analyses.length > 0
    ? ((paidPurchases.length / db.analyses.length) * 100).toFixed(1)
    : 0;

  // 고객 여정 — 이메일 기준으로 분석+구매 연결
  const emailSet = new Set([
    ...paidPurchases.filter(p => p.email).map(p => p.email),
    ...db.analyses.filter(a => a.email).map(a => a.email),
  ]);
  const journeys = [...emailSet].map(email => {
    const ua = db.analyses.filter(a => a.email === email);
    const up = paidPurchases.filter(p => p.email === email);
    const allTimes = [...ua, ...up].map(x => x.createdAt).sort();
    return {
      email,
      analyses: ua.length,
      purchases: up.length,
      totalSpent: up.reduce((s, p) => s + p.amount, 0),
      tier: up.some(p => p.tier === 'pro') ? 'pro' : up.length > 0 ? 'paid' : 'free',
      firstSeen: allTimes[0] || null,
      lastActivity: allTimes[allTimes.length - 1] || null,
      models: [...new Set(ua.map(a => a.model).filter(Boolean))],
    };
  }).sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

  // AI 브레인 학습 현황
  const deals = db.deals || [];
  const modelCounts = {};
  const storeSaves = {};
  deals.forEach(d => {
    if (d.model) modelCounts[d.model] = (modelCounts[d.model] || 0) + 1;
    if (d.store && d.saveAmount) {
      if (!storeSaves[d.store]) storeSaves[d.store] = { total: 0, count: 0 };
      storeSaves[d.store].total += d.saveAmount;
      storeSaves[d.store].count++;
    }
  });
  const brainStats = {
    totalDeals: deals.length,
    topModels: Object.entries(modelCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([model, count]) => ({ model, count })),
    topStores: Object.entries(storeSaves).sort((a, b) => (b[1].total / b[1].count) - (a[1].total / a[1].count)).slice(0, 5).map(([store, v]) => ({ store, avgSave: Math.round(v.total / v.count) })),
    lastUpdated: deals[deals.length - 1]?.date || null,
  };

  res.json({
    totalAnalyses: db.analyses.length,
    totalPurchases: paidPurchases.length,
    monthlyPurchases: monthly.length,
    mrr,
    conversionRate,
    recentPurchases: paidPurchases.slice(-10).reverse(),
    recentAnalyses: db.analyses.slice(-10).reverse(),
    journeys,
    brainStats,
    feedbacks: (db.feedbacks || []).slice(-20).reverse(),
    sessions: (db.sessions || []).slice(-30).reverse().map(s => ({
      id: s.id,
      ip: s.ip,
      email: s.email,
      firstPage: s.firstPage,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      eventCount: s.events.length,
      path: s.events.map(e => e.event).join(' → '),
      converted: s.events.some(e => ['unlock_complete', 'beta_join', 'payment_success'].includes(e.event)),
    })),
  });
});

// POST /api/feedback — 개선 제안 수집 + 보너스 분석 지급
app.post('/api/feedback', (req, res) => {
  const { content, email } = req.body;
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  if (!content || content.trim().length < 10) {
    return res.status(400).json({ error: '10자 이상 작성해주세요' });
  }

  const db = readDB();
  if (!db.feedbacks) db.feedbacks = [];
  if (!db.bonuses) db.bonuses = [];

  db.feedbacks.push({
    id: Date.now().toString(),
    ip, email: email || null,
    content: content.trim(),
    createdAt: new Date().toISOString()
  });

  // 하루 1회 보너스만 지급 (중복 방지)
  const alreadyToday = db.bonuses.some(b => b.ip === ip && b.date === today());
  let bonusGranted = 0;
  if (!alreadyToday) {
    bonusGranted = 2;
    db.bonuses.push({ ip, date: today(), uses: 2, createdAt: new Date().toISOString() });
  }

  writeDB(db);
  res.json({ success: true, bonusGranted, message: bonusGranted > 0 ? `감사합니다! 오늘 ${bonusGranted}회 추가 분석권이 생겼습니다 🎁` : '소중한 의견 감사합니다!' });
});

// GET /api/bonus — 현재 IP 보너스 잔여 횟수
app.get('/api/bonus', (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const db = readDB();
  const todayBonus = (db.bonuses || []).filter(b => b.ip === ip && b.date === today());
  const totalGranted = todayBonus.reduce((s, b) => s + b.uses, 0);
  const usedFree = (db.analyses || []).filter(a => a.ip === ip && a.date === today() && a.tier === 'free').length;
  const freeLimit = 3;
  const bonusRemaining = Math.max(0, totalGranted - Math.max(0, usedFree - freeLimit));
  res.json({ bonusRemaining, totalGranted });
});

// GET /api/stats/public — 공개 통계
app.get('/api/stats/public', (req, res) => {
  const db = readDB();
  const totalSaved = (db.deals || []).reduce((s, d) => s + (d.saveAmount || 0), 0);
  const totalAnalyses = db.analyses?.length || 0;
  const totalReviews = (db.reviews || []).length;
  res.json({ totalSaved, totalAnalyses, totalReviews });
});

// POST /api/review — 구매 후기 저장
app.post('/api/review', (req, res) => {
  const { model, savedAmount, store, comment, tier } = req.body;
  if (!model || !comment || comment.length < 5) return res.status(400).json({ error: '필수값 누락' });
  const db = readDB();
  if (!db.reviews) db.reviews = [];
  db.reviews.push({
    id: Date.now().toString(),
    model, savedAmount, store, comment,
    tier: tier || 'free',
    createdAt: new Date().toISOString()
  });
  writeDB(db);
  res.json({ success: true });
});

// GET /api/reviews — 후기 목록
app.get('/api/reviews', (req, res) => {
  const db = readDB();
  const reviews = (db.reviews || []).slice(-20).reverse();
  res.json({ reviews });
});

// POST /api/subscribe — 이메일 수집 (가격 알림 신청, 뉴스레터, 무료분석 후 등록)
app.post('/api/subscribe', (req, res) => {
  const { email, source, url } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: '이메일 형식 오류' });
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const db = readDB();
  const user = upsertUser(db, { email, ip, source: source || 'subscribe', url });
  // alerts에도 저장 (가격 알림 요청으로 활용)
  if (!db.alerts) db.alerts = [];
  const alreadyAlerted = db.alerts.find(a => a.email === email && a.url === url);
  if (!alreadyAlerted && url) {
    db.alerts.push({ email, url, ip, source: source || 'subscribe', createdAt: new Date().toISOString() });
  }
  writeDB(db);
  const isNew = !db.users.find(u => u.email === email && u.createdAt !== user.createdAt);
  res.json({ success: true, isNew });
});

// GET /api/bookmarklet — 북마클릿 JS 파일 제공
app.get('/api/bookmarklet', (req, res) => {
  const host = `${req.protocol}://${req.get('host')}`;
  const js = `(function(){
  var u=location.href;
  if(!u.includes('coupang.com')){alert('쿠팡 상품 페이지에서 클릭해주세요!');return;}
  var title=document.querySelector('.prod-buy-header__title')?.innerText
    ||document.querySelector('[class*="prod-title"]')?.innerText
    ||document.title||'';
  var price=document.querySelector('.prod-buy-header__price-num')?.innerText
    ||document.querySelector('[class*="price-num"]')?.innerText
    ||document.querySelector('[class*="final-price"]')?.innerText||'';
  price=price.replace(/[^0-9]/g,'');
  if(!title){alert('상품 정보를 읽을 수 없습니다. 상품 페이지가 맞는지 확인해주세요.');return;}
  var params=new URLSearchParams({url:u,scraped_title:title.trim(),scraped_price:price});
  location.href='${host}/result?'+params;
})();`;
  res.type('application/javascript').send(js);
});

// POST /api/track — 클라이언트 행동 이벤트 서버 저장
app.post('/api/track', (req, res) => {
  const { sessionId, event, data, page } = req.body;
  if (!sessionId || !event) return res.sendStatus(204);

  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const db = readDB();
  if (!db.sessions) db.sessions = [];

  let session = db.sessions.find(s => s.id === sessionId);
  if (!session) {
    session = { id: sessionId, ip, email: null, firstPage: page || 'unknown', createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), events: [] };
    db.sessions.push(session);
  }

  session.events.push({ event, data: data || {}, page: page || 'unknown', time: new Date().toISOString() });
  session.lastSeenAt = new Date().toISOString();
  if (data?.email && !session.email) session.email = data.email;

  // 세션당 이벤트 최대 200개, 전체 세션 최대 2000개
  if (session.events.length > 200) session.events = session.events.slice(-200);
  if (db.sessions.length > 2000) db.sessions = db.sessions.slice(-2000);

  writeDB(db);
  res.sendStatus(204);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// POST /api/extract-screenshot — 스크린샷 이미지에서 상품명·가격 추출 (Claude Vision)
app.post('/api/extract-screenshot', async (req, res) => {
  const { image_base64, media_type = 'image/jpeg' } = req.body;
  if (!image_base64) return res.status(400).json({ error: '이미지 데이터가 없습니다' });

  const prompt = `이 스크린샷은 쇼핑몰 상품 페이지입니다. 다음 정보를 JSON으로 추출해주세요:
- title: 정확한 상품명 (Apple 제품이면 영문 모델명 포함, 예: "Apple MacBook Air 13인치 M3 8GB 256GB 미드나이트")
- price: 현재 판매가 숫자만 (원 단위, 예: 1390000)
- store: 판매처 (쿠팡/애플/다나와/네이버 등)

JSON만 출력:
{"title":"...","price":숫자또는null,"store":"..."}`;

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY 없음 — Render 환경변수 확인' });

    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type, data: image_base64 } },
          { type: 'text', text: prompt }
        ]
      }]
    });

    const apiRes = await new Promise((resolve, reject) => {
      const req2 = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body)
        }
      }, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => resolve({ status: r.statusCode, body: d }));
      });
      req2.on('error', reject);
      req2.write(body);
      req2.end();
    });

    const parsed = JSON.parse(apiRes.body);
    const text = parsed.content?.[0]?.text || '{}';
    const clean = text.replace(/```json\n?|```\n?/g, '').trim();
    const extracted = JSON.parse(clean.slice(clean.indexOf('{'), clean.lastIndexOf('}') + 1));
    res.json({ success: true, ...extracted });
  } catch (e) {
    console.error('스크린샷 추출 오류:', e.message);
    res.status(500).json({ error: '이미지 분석 실패: ' + e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🧙‍♂️ 맥도사 서버 실행 중`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   분석: POST /api/analyze`);
  console.log(`   결제: POST /api/payment/initiate`);
  console.log(`   어드민: GET /admin (Bearer 토큰 필요)\n`);
});
