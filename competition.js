/**
 * 맥도사 브레인 진화 경연
 * 10라운드 × 3에이전트 병렬 = 30회 Haiku
 * 매 라운드 다른 제품, 3팀 동시 검색 → 최저가 우승 → 브레인 저장
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dir, 'db.json');
const LOG_PATH = join(__dir, 'brain_evolution.log');

export const TOTAL_ROUNDS = 10;

// ── 제품 풀 — Apple + 비애플 혼합 10개 (최종 경연) ─────────────
const PRODUCTS = [
  { name: 'MacBook Pro 14 M4',          url: 'https://www.apple.com/kr/shop/buy-mac/macbook-pro/14형' },
  { name: 'iPhone 16 Pro',              url: 'https://www.apple.com/kr/shop/buy-iphone/iphone-16-pro' },
  { name: 'iPad Pro M4',                url: 'https://www.apple.com/kr/shop/buy-ipad/ipad-pro' },
  { name: 'AirPods Pro 2',              url: 'https://www.apple.com/kr/shop/product/MTJV3KH/A' },
  { name: 'Apple Watch Series 10',      url: 'https://www.apple.com/kr/shop/buy-watch/apple-watch' },
  { name: 'Samsung Galaxy S25 Ultra',   url: 'https://www.samsung.com/kr/smartphones/galaxy-s/galaxy-s25-ultra' },
  { name: 'Sony WH-1000XM6',            url: 'https://www.sony.co.kr/ko/product/WH-1000XM6' },
  { name: 'LG 그램 Pro 16 2025',        url: 'https://www.lge.co.kr/laptops/gram' },
  { name: 'Dyson V15 Detect',           url: 'https://www.dyson.co.kr/vacuum-cleaners/cord-free/dyson-v15-detect' },
  { name: 'Sony PlayStation 5 Pro',     url: 'https://direct.playstation.com/ko-kr/buy-consoles/playstationr5-pro-console' },
];

// ── 3 에이전트 전략 ──────────────────────────────────────────────
export const AGENTS = {
  A: {
    name: '딜헌터',
    strategy: `당신은 "딜헌터" 전략을 사용합니다.
우선순위: ① 롯데하이마트 원데이딜 ② 쿠팡 타임딜 ③ 11번가 슈퍼딜 ④ 네이버 특가
- 오늘 날짜 기준 24시간 한정 딜을 가장 먼저 찾으세요
- 타임딜 없으면 쿠팡 즉시할인 쿠폰 조합을 찾으세요
- 재고 소진 임박 딜도 포함하세요`,
  },
  B: {
    name: '카드마스터',
    strategy: `당신은 "카드마스터" 전략을 사용합니다.
우선순위: ① 카드사 즉시할인 최대 조합 ② 청구할인 ③ 포인트 환급
- 현대카드·삼성카드·신한카드·KB국민카드·카카오뱅크 즉시할인 모두 검색
- 카드 중복 적용 가능 여부 확인
- 통신사 제휴 할인(KT·SKT·LGU+)도 포함`,
  },
  C: {
    name: '할인조합사',
    strategy: `당신은 "할인조합사" 전략을 사용합니다. 신품만 대상으로 합니다.
우선순위: ① 애플 교육할인 ② 애플 공인 리퍼비시 ③ 통신사 제휴 ④ 사업자 부가세 환급
- apple.com/kr/shop/go/product/education 교육할인 현재가 확인
- apple.com/kr/shop/refurbished 리퍼비시 현재 재고·가격 확인
- KT·SKT·LGU+ 단말 구매 제휴 혜택 검색`,
  },
};

// ── rate limit 에러 감지 ─────────────────────────────────────────
export function parseRateLimit(text) {
  // "resets in Xh Ym" 패턴
  const m1 = text.match(/resets?\s+in\s+(\d+)h\s*(\d*)m?/i);
  if (m1) {
    const h = parseInt(m1[1]) || 0;
    const m = parseInt(m1[2]) || 0;
    return (h * 3600 + m * 60) * 1000;
  }
  // "try again after HH:MM:SS" 패턴
  const m2 = text.match(/try again (?:after|in)\s+(\d+):(\d+):(\d+)/i);
  if (m2) {
    const h = parseInt(m2[1]), min = parseInt(m2[2]), s = parseInt(m2[3]);
    return (h * 3600 + min * 60 + s) * 1000;
  }
  // "wait X hours Y minutes" 패턴
  const m3 = text.match(/wait\s+(\d+)\s*hours?\s*(?:and\s*)?(\d*)\s*minutes?/i);
  if (m3) {
    const h = parseInt(m3[1]) || 0;
    const m = parseInt(m3[2]) || 0;
    return (h * 3600 + m * 60) * 1000;
  }
  return null;
}

// ── Claude Haiku 호출 ────────────────────────────────────────────
export async function callHaiku(agentKey, product) {
  const agent = AGENTS[agentKey];
  const today = new Date().toISOString().slice(0, 10);
  const db = readDB();
  const intel = buildIntel(db);

  const prompt = `당신은 맥도사 브레인 경연 참가자입니다.
제품: ${product.name}
URL: ${product.url}
오늘: ${today}

${agent.strategy}

${intel}

웹 검색을 실행해 이 제품의 최저가 구매 경로를 찾으세요.
반드시 아래 JSON만 반환 (마크다운·코드블록 금지):
{
  "agentKey": "${agentKey}",
  "agentName": "${agent.name}",
  "product": "${product.name}",
  "bestStore": "최저가 판매처명",
  "bestDealType": "딜 유형",
  "finalPrice": 숫자(원 단위 최종가),
  "saveAmount": 숫자(정가 대비 절약액),
  "searchPath": "검색한 사이트 순서와 최저가 발견 경로 (예: 다나와→쿠팡 비교→삼성카드 할인 적용)",
  "keyInsight": "판매처+카드+할인율+조건을 포함한 실행 가능 인사이트 (예: 쿠팡 215,960원+삼성카드10%=194,000원, 정가대비47%절감, 월한도100만원 주의)"
}`;

  return new Promise((resolve) => {
    const proc = spawn('/usr/local/bin/claude', [
      '-p', prompt,
      '--model', 'claude-haiku-4-5-20251001',
      '--output-format', 'text',
      '--dangerously-skip-permissions'
    ], { env: process.env, cwd: '/tmp' });

    let out = '';
    let errOut = '';
    proc.stdout.on('data', d => { out += d; });
    proc.stderr.on('data', d => { errOut += d; });

    const timer = setTimeout(() => { proc.kill(); resolve(null); }, 90000);
    proc.on('close', () => {
      clearTimeout(timer);

      // rate limit 감지
      const waitMs = parseRateLimit(out + errOut);
      if (waitMs !== null) {
        resolve({ __rateLimit: true, waitMs, raw: out + errOut });
        return;
      }

      try {
        const s = out.indexOf('{');
        const e = out.lastIndexOf('}');
        if (s === -1 || e === -1) return resolve(null);
        resolve(JSON.parse(out.slice(s, e + 1)));
      } catch { resolve(null); }
    });
    proc.on('error', () => resolve(null));
  });
}

// ── DB 유틸 ─────────────────────────────────────────────────────
export function readDB() {
  if (!existsSync(DB_PATH)) return { deals: [], brain_intel: [], progress: {} };
  const db = JSON.parse(readFileSync(DB_PATH, 'utf-8'));
  if (!db.progress) db.progress = {};
  return db;
}

export function writeDB(data) {
  writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function buildIntel(db) {
  const intel = db.brain_intel || [];
  if (intel.length === 0) return '';
  const last5 = intel.slice(-5);
  return `[브레인 누적 인텔 — 이전 경연 우승 전략 ${intel.length}건]
${last5.map(i => `▸ 라운드${i.round} 우승(${i.winner}): ${i.searchPath} → ${Math.round(i.finalPrice/10000)}만원`).join('\n')}`;
}

export function log(msg) {
  const line = `[${new Date().toISOString().slice(0,19)}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_PATH, line + '\n');
}

// ── 라운드 실행 (3팀 병렬) ────────────────────────────────────────
export async function runRound(roundNum) {
  const product = PRODUCTS[roundNum - 1];
  log(`\n━━━ 라운드 ${roundNum}/${TOTAL_ROUNDS} | 제품: ${product.name} ━━━`);
  log(`  URL: ${product.url}`);
  log(`  A(${AGENTS.A.name}) / B(${AGENTS.B.name}) / C(${AGENTS.C.name}) 병렬 검색 시작...`);

  // 3팀 동시 실행
  const [rA, rB, rC] = await Promise.all([
    callHaiku('A', product),
    callHaiku('B', product),
    callHaiku('C', product),
  ]);

  const results = { A: rA, B: rB, C: rC };

  // rate limit 체크
  for (const [key, r] of Object.entries(results)) {
    if (r?.__rateLimit) {
      return { __rateLimit: true, waitMs: r.waitMs, raw: r.raw };
    }
  }

  // 결과 출력
  for (const [key, r] of Object.entries(results)) {
    if (r) {
      log(`  ${key}(${AGENTS[key].name}): ${r.bestStore} → ${Math.round(r.finalPrice/10000)}만원 [${r.bestDealType}]`);
    } else {
      log(`  ${key}(${AGENTS[key].name}): 검색 실패`);
    }
  }

  // 유효 결과 중 최저가
  const valid = Object.entries(results).filter(([, r]) => r && r.finalPrice > 0 && !r.__rateLimit);
  if (valid.length === 0) {
    log(`  ⚠ 라운드 ${roundNum} 유효 결과 없음`);
    return { roundNum, product: product.name, winner: null, results };
  }

  valid.sort((a, b) => a[1].finalPrice - b[1].finalPrice);
  const [winner, winResult] = valid[0];
  log(`  ★ 우승: ${winner}(${AGENTS[winner].name}) — ${Math.round(winResult.finalPrice/10000)}만원 @ ${winResult.bestStore}`);

  // 브레인에 저장
  const db = readDB();
  if (!db.brain_intel) db.brain_intel = [];
  db.brain_intel.push({
    round: roundNum,
    product: product.name,
    winner: `${winner}(${AGENTS[winner].name})`,
    finalPrice: winResult.finalPrice,
    saveAmount: winResult.saveAmount || 0,
    bestStore: winResult.bestStore,
    dealType: winResult.bestDealType,
    searchPath: winResult.searchPath || '',
    keyInsight: winResult.keyInsight || '',
    allResults: Object.fromEntries(
      Object.entries(results).map(([k, r]) => [k, r ? { store: r.bestStore, price: r.finalPrice } : null])
    ),
    timestamp: new Date().toISOString(),
  });

  // 진행 상황 저장 (재시작 시 이어받기용)
  db.progress.lastCompletedRound = roundNum;
  writeDB(db);

  // 패배팀이 우승 인사이트 흡수 (진화)
  if (winResult.keyInsight) {
    for (const key of ['A', 'B', 'C']) {
      if (key !== winner) {
        AGENTS[key].strategy += `\n[라운드${roundNum} 인사이트] ${winResult.keyInsight}`;
      }
    }
  }

  return { roundNum, product: product.name, winner, winResult, results };
}

// ── 메인 ────────────────────────────────────────────────────────
export async function main(startFrom = 1) {
  log(`\n🏆 맥도사 브레인 경연 시작 — 라운드 ${startFrom}~${TOTAL_ROUNDS} (Haiku 병렬)`);

  const roundSummary = [];
  const wins = { A: 0, B: 0, C: 0 };

  for (let r = startFrom; r <= TOTAL_ROUNDS; r++) {
    const result = await runRound(r);

    if (result.__rateLimit) {
      log(`\n⏸ 크레딧 소진 감지 — 라운드 ${r}에서 중단`);
      return { interrupted: true, waitMs: result.waitMs, resumeFrom: r, raw: result.raw };
    }

    if (result.winner) {
      wins[result.winner]++;
      roundSummary.push(result);
    }
  }

  // 최종 챔피언
  const champion = Object.entries(wins).sort((a, b) => b[1] - a[1])[0][0];

  const db = readDB();
  db.champion = {
    agent: champion,
    name: AGENTS[champion].name,
    totalWins: wins[champion],
    strategy: AGENTS[champion].strategy,
    updatedAt: new Date().toISOString(),
  };
  db.progress.lastCompletedRound = TOTAL_ROUNDS;
  writeDB(db);

  log(`\n🥇 최종 챔피언: ${champion}(${AGENTS[champion].name}) — ${wins[champion]}/${TOTAL_ROUNDS}라운드 우승`);

  return { interrupted: false, wins, champion, roundSummary };
}

// 직접 실행 시
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = readDB();
  const startFrom = (db.progress?.lastCompletedRound || 0) + 1;
  if (startFrom > TOTAL_ROUNDS) {
    console.log('모든 라운드 완료. db.json 초기화 후 재실행하세요.');
    process.exit(0);
  }
  main(startFrom).then(r => {
    if (r.interrupted) {
      console.log(`\n⏸ 중단. runner.js가 자동 재시작 처리합니다.`);
      process.exit(2); // exit code 2 = rate limit
    }
    process.exit(0);
  }).catch(console.error);
}
