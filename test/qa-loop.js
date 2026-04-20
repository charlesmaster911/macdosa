/**
 * 맥도사 자동 QA 루프
 *
 * Agent 1 (구매자): 네이버 API로 실제 맥북 상품 URL 수집
 * Agent 2 (검증):  서비스 품질 평가 — 고객 관점 7가지 기준
 * Agent 3 (수정):  claude -p로 실패 원인 분석 + 코드 패치 자동 적용
 *
 * 실행: node test/qa-loop.js [최대라운드=3]
 * 예시: node test/qa-loop.js 5
 */

import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const MAX_ROUNDS = parseInt(process.argv[2] || '3');
const PASS_THRESHOLD = 0.75; // 75% 이상 통과 시 찰스에게 최종 보고

// .env 로드
if (existsSync(join(ROOT, '.env'))) {
  readFileSync(join(ROOT, '.env'), 'utf-8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length && !process.env[k.trim()]) process.env[k.trim()] = v.join('=').trim();
  });
}

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const NAVER_ID = process.env.NAVER_CLIENT_ID;
const NAVER_SECRET = process.env.NAVER_CLIENT_SECRET;

// ═══════════════════════════════════════════════════════════
// 정적 테스트 케이스 (항상 실행)
// ═══════════════════════════════════════════════════════════

const STATIC_CASES = [
  // ─── MacBook ────────────────────────────────────────────
  {
    id: 'mac_m4_16',
    label: '[맥북] M4 16GB 14인치',
    body: { url: '맥북 M4 16GB 14인치' },
    expect: 'success',
    checks: [
      { name: '모델명 인식', fn: r => r.data?.model?.length > 5 },
      { name: 'paths 존재', fn: r => (r.data?.paths?.length || 0) >= 2 },
      { name: 'verdict 존재', fn: r => r.data?.verdict !== undefined },
      { name: '가격 데이터', fn: r => (r.data?.paths?.[0]?.finalPrice || 0) > 0 },
    ]
  },
  {
    id: 'mac_m3pro',
    label: '[맥북] M3 Pro 18GB 14인치',
    body: { url: '맥북 M3 Pro 18GB 14인치' },
    expect: 'success',
    checks: [
      { name: 'paths 존재', fn: r => (r.data?.paths?.length || 0) >= 2 },
      { name: '天 분석', fn: r => r.data?.tian?.body?.length > 0 },
      { name: '가격 데이터', fn: r => (r.data?.paths?.[0]?.finalPrice || 0) > 0 },
    ]
  },
  {
    id: 'mac_air_m3',
    label: '[맥북] MacBook Air M3 8GB',
    body: { url: 'MacBook Air M3 8GB 256GB 스페이스그레이' },
    expect: 'success',
    checks: [
      { name: 'paths 존재', fn: r => (r.data?.paths?.length || 0) >= 2 },
      { name: '天地人 모두', fn: r => r.data?.tian && r.data?.di && r.data?.ren },
    ]
  },
  {
    id: 'mac_price_compare',
    label: '[맥북] M4 Pro 가격비교',
    body: {
      url: 'https://www.apple.com/kr/shop/buy-mac',
      scraped_title: 'Apple MacBook Pro 14인치 M4 Pro 24GB 512GB',
      scraped_price: '4500000',
    },
    expect: 'success',
    checks: [
      { name: 'verdict 존재', fn: r => r.data?.verdict !== undefined },
      { name: '가격 데이터', fn: r => (r.data?.paths?.[0]?.finalPrice || 0) > 0 },
    ]
  },

  // ─── iPhone ─────────────────────────────────────────────
  {
    id: 'iphone_16pro_text',
    label: '[아이폰] iPhone 16 Pro 256GB 텍스트',
    body: { url: 'iPhone 16 Pro 256GB 블랙 티타늄' },
    expect: 'success',
    checks: [
      { name: '모델명 인식', fn: r => /iphone|아이폰/i.test(r.data?.model || '') },
      { name: 'paths 존재', fn: r => (r.data?.paths?.length || 0) >= 2 },
      { name: 'verdict 존재', fn: r => r.data?.verdict !== undefined },
      { name: '가격 데이터', fn: r => (r.data?.paths?.[0]?.finalPrice || 0) > 0 },
    ]
  },
  {
    id: 'iphone_15_text',
    label: '[아이폰] iPhone 15 128GB 텍스트',
    body: { url: 'iPhone 15 128GB 블루' },
    expect: 'success',
    checks: [
      { name: 'paths 존재', fn: r => (r.data?.paths?.length || 0) >= 2 },
      { name: '가격 데이터', fn: r => (r.data?.paths?.[0]?.finalPrice || 0) > 0 },
    ]
  },
  {
    id: 'iphone_scraped',
    label: '[아이폰] iPhone 16 128GB 가격비교',
    body: {
      url: 'https://www.apple.com/kr/shop/buy-iphone',
      scraped_title: 'Apple iPhone 16 128GB 핑크',
      scraped_price: '1250000',
    },
    expect: 'success',
    checks: [
      { name: 'paths 존재', fn: r => (r.data?.paths?.length || 0) >= 2 },
      { name: '가격 데이터', fn: r => (r.data?.paths?.[0]?.finalPrice || 0) > 0 },
    ]
  },

  // ─── iPad ───────────────────────────────────────────────
  {
    id: 'ipad_air_m2',
    label: '[아이패드] iPad Air M2 11인치',
    body: { url: 'iPad Air M2 11인치 256GB Wi-Fi 블루' },
    expect: 'success',
    checks: [
      { name: '모델명 인식', fn: r => /ipad|아이패드/i.test(r.data?.model || '') },
      { name: 'paths 존재', fn: r => (r.data?.paths?.length || 0) >= 2 },
      { name: 'verdict 존재', fn: r => r.data?.verdict !== undefined },
    ]
  },
  {
    id: 'ipad_pro_m4',
    label: '[아이패드] iPad Pro M4 13인치',
    body: { url: 'iPad Pro M4 13인치 256GB Wi-Fi 실버' },
    expect: 'success',
    checks: [
      { name: 'paths 존재', fn: r => (r.data?.paths?.length || 0) >= 2 },
      { name: '가격 데이터', fn: r => (r.data?.paths?.[0]?.finalPrice || 0) > 0 },
    ]
  },

  // ─── 에러 케이스 ────────────────────────────────────────
  {
    id: 'err_naver_catalog',
    label: '[에러] 네이버 카탈로그 URL',
    body: { url: 'https://search.shopping.naver.com/catalog/59153094780' },
    expect: 'error',
    checks: [
      { name: 'SCRAPE_FAILED 코드', fn: r => r.code === 'SCRAPE_FAILED' || r.error?.length > 0 },
    ]
  },
  {
    id: 'err_galaxy',
    label: '[에러] 갤럭시 (NOT_APPLE)',
    body: { url: 'Samsung Galaxy S25 256GB 블랙' },
    expect: 'error',
    checks: [
      { name: 'NOT_APPLE 코드', fn: r => r.code === 'NOT_APPLE' },
    ]
  },
  {
    id: 'err_windows',
    label: '[에러] LG그램 (NOT_APPLE)',
    body: { url: 'LG그램 16인치 i7 16GB 512GB' },
    expect: 'error',
    checks: [
      { name: 'NOT_APPLE 코드', fn: r => r.code === 'NOT_APPLE' },
    ]
  },
];

// ═══════════════════════════════════════════════════════════
// Agent 1: 구매자 — 네이버 API로 실제 상품 URL 수집
// ═══════════════════════════════════════════════════════════

async function buyerAgent() {
  console.log('\n🤖 [Agent 1 구매자] 실제 상품 URL 수집 중...');
  if (!NAVER_ID || !NAVER_SECRET) {
    console.log('   ⚠️  Naver API 키 없음 → 정적 케이스만 사용');
    return [];
  }

  const queries = [
    { q: '맥북 에어 M4 쿠팡', label: 'M4 Air' },
    { q: '맥북 프로 M3 Pro 14인치', label: 'M3 Pro 14"' },
  ];
  const dynamicCases = [];

  for (const { q, label } of queries) {
    try {
      const apiUrl = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(q)}&display=5&sort=lprice`;
      const res = await fetch(apiUrl, {
        headers: { 'X-Naver-Client-Id': NAVER_ID, 'X-Naver-Client-Secret': NAVER_SECRET },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const { items = [] } = await res.json();

      // 쿠팡 vp/products URL만 사용
      const coupangItem = items.find(i => /coupang\.com\/vp\/products\//.test(i.link));
      if (coupangItem) {
        const cleanTitle = coupangItem.title.replace(/<[^>]+>/g, '').slice(0, 40);
        dynamicCases.push({
          id: `dyn_${label.replace(/\s/g, '_')}`,
          label: `[동적 ${label}] ${cleanTitle}`,
          body: { url: coupangItem.link },
          expect: 'success',
          naverRefPrice: parseInt(coupangItem.lprice),
          checks: [
            { name: 'paths 존재', fn: r => (r.data?.paths?.length || 0) >= 1 },
            { name: 'verdict 존재', fn: r => r.data?.verdict !== undefined },
          ],
        });
        console.log(`   → [${label}] ${cleanTitle} (₩${parseInt(coupangItem.lprice).toLocaleString()})`);
      }
    } catch {
      console.log(`   ⚠️  ${label} 수집 실패`);
    }
  }

  console.log(`   → 동적 케이스 ${dynamicCases.length}개 추가`);
  return dynamicCases;
}

// ═══════════════════════════════════════════════════════════
// Agent 2: 검증 — 서비스 품질 평가
// ═══════════════════════════════════════════════════════════

async function evaluatorAgent(allCases) {
  console.log('\n🤖 [Agent 2 검증] 서비스 품질 평가 중...');
  const results = [];

  for (const tc of allCases) {
    process.stdout.write(`   ${tc.label.slice(0, 45).padEnd(45)} `);

    let passed = false;
    let details = {};

    try {
      const headers = {
        'Content-Type': 'application/json',
        'x-test-token': ADMIN_TOKEN || '',
      };

      const res = await fetch(`${SERVER_URL}/api/analyze`, {
        method: 'POST',
        headers,
        body: JSON.stringify(tc.body),
        signal: AbortSignal.timeout(90000),
      });

      const body = await res.json();
      const gotSuccess = res.ok;
      const expectSuccess = tc.expect === 'success';
      const expectMatch = gotSuccess === expectSuccess;

      // 개별 체크 실행
      const checkData = gotSuccess ? body : body; // 에러 응답도 body에 있음
      const checkResults = tc.checks.map(c => {
        try { return { name: c.name, ok: Boolean(c.fn(checkData)) }; }
        catch { return { name: c.name, ok: false }; }
      });

      const allChecks = checkResults.every(c => c.ok);
      passed = expectMatch && allChecks;

      details = {
        status: res.status,
        gotSuccess,
        expectMatch,
        checkResults,
        failedChecks: checkResults.filter(c => !c.ok).map(c => c.name),
        data: body,
      };

      if (passed) {
        console.log('✅');
      } else {
        const why = !expectMatch
          ? `기댓값=${tc.expect} 실제=${gotSuccess ? 'success' : 'error'}(${res.status})`
          : `체크실패: ${details.failedChecks.join(', ')}`;
        console.log(`❌  ${why}`);
      }
    } catch (e) {
      details = { error: e.message };
      console.log(`❌  연결오류: ${e.message}`);
    }

    results.push({ ...tc, passed, details });
    await new Promise(r => setTimeout(r, 400)); // 서버 부하 방지
  }

  const passCount = results.filter(r => r.passed).length;
  const total = results.length;
  const score = passCount / total;

  console.log(`\n   📊 ${passCount}/${total} 통과 (${Math.round(score * 100)}%)`);
  return { results, score, passCount, total };
}

// ═══════════════════════════════════════════════════════════
// Agent 3: 수정 — 실패 분석 + 코드 패치
// ═══════════════════════════════════════════════════════════

async function fixerAgent(evalReport, round) {
  console.log('\n🤖 [Agent 3 수정] 실패 케이스 분석 + 패치 생성...');

  const failures = evalReport.results.filter(r => !r.passed);
  if (failures.length === 0) {
    console.log('   수정 불필요');
    return false;
  }

  const failureSummary = failures.map(f => {
    const d = f.details;
    const info = d.error
      ? `연결오류: ${d.error}`
      : `HTTP ${d.status}, error="${d.data?.error || ''}", code="${d.data?.code || ''}", 실패체크: ${d.failedChecks?.join(', ') || '기댓값불일치'}`;
    return `- [${f.id}] ${f.label}\n  입력: ${JSON.stringify(f.body)}\n  결과: ${info}`;
  }).join('\n\n');

  const serverCode = readFileSync(join(ROOT, 'server.js'), 'utf-8');
  // analyze 엔드포인트 핵심 부분만 추출 (너무 길면 claude 토큰 낭비)
  const startIdx = serverCode.indexOf('// POST /api/analyze');
  const endIdx = serverCode.indexOf('// POST /api/payment');
  const analyzeSection = startIdx > -1 && endIdx > -1
    ? serverCode.slice(startIdx, endIdx).slice(0, 4000)
    : serverCode.slice(0, 4000);

  const prompt = `당신은 맥도사(MacBook 최저가 서비스) 서버 개발자입니다.
라운드 ${round} 테스트 실패 케이스를 분석하고 최소한의 수정만 제안해주세요.

## 실패 케이스
${failureSummary}

## 현재 server.js (analyze 엔드포인트)
\`\`\`javascript
${analyzeSection}
\`\`\`

## 응답 형식 (JSON만, 다른 텍스트 없이)
{
  "analysis": "실패 원인 요약 (2문장 이내)",
  "needsFix": true또는false,
  "patches": [
    {
      "file": "server.js",
      "find": "정확히 일치하는 원본 텍스트 (최소한만)",
      "replace": "수정된 텍스트"
    }
  ]
}`;

  console.log('   claude -p 호출 중 (최대 60초)...');
  const result = spawnSync('/usr/local/bin/claude', [
    '-p', prompt,
    '--output-format', 'text',
    '--dangerously-skip-permissions',
  ], { encoding: 'utf-8', timeout: 60000, env: { ...process.env } });

  if (result.status !== 0 || !result.stdout?.trim()) {
    console.log('   ⚠️  Claude 응답 없음');
    return false;
  }

  let fixData;
  try {
    const raw = result.stdout.replace(/```json\n?|```\n?/g, '').trim();
    fixData = JSON.parse(raw);
  } catch {
    console.log('   ⚠️  JSON 파싱 실패');
    console.log('   원문:', result.stdout.slice(0, 200));
    return false;
  }

  console.log(`   분석: ${fixData.analysis}`);

  if (!fixData.needsFix || !fixData.patches?.length) {
    console.log('   → 코드 수정 불필요 (로직/데이터 문제)');
    return false;
  }

  // 패치 적용
  let applied = 0;
  for (const patch of fixData.patches) {
    const filePath = join(ROOT, patch.file);
    if (!existsSync(filePath)) { console.log(`   ⚠️  파일 없음: ${patch.file}`); continue; }
    let content = readFileSync(filePath, 'utf-8');
    if (!content.includes(patch.find)) {
      console.log(`   ⚠️  패턴 미발견: "${patch.find.slice(0, 60)}..."`);
      continue;
    }
    content = content.replace(patch.find, patch.replace);
    writeFileSync(filePath, content, 'utf-8');
    applied++;
    console.log(`   ✅ 패치 적용: ${patch.file}`);
  }

  if (applied > 0) {
    console.log(`\n   ⚡ ${applied}개 패치 완료. 서버 재시작 필요:`);
    console.log('   kill $(lsof -t -i:3000) && node server.js &');
  }
  return applied > 0;
}

// ═══════════════════════════════════════════════════════════
// 서버 헬스 체크
// ═══════════════════════════════════════════════════════════

async function checkHealth() {
  try {
    const res = await fetch(`${SERVER_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════════
// 메인 루프
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║    맥도사 자동 QA 루프 — 3-에이전트 시스템    ║');
  console.log(`║    최대 ${MAX_ROUNDS}라운드 | 합격 기준 ${Math.round(PASS_THRESHOLD * 100)}%          ║`);
  console.log('╚═══════════════════════════════════════════╝');

  if (!(await checkHealth())) {
    console.log('\n❌ 서버 연결 실패. 먼저 실행하세요:');
    console.log('   cd macdosa && node server.js');
    process.exit(1);
  }
  console.log(`\n✅ 서버 연결 확인 (${SERVER_URL})`);

  const history = [];
  let lastEval = null;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    console.log(`\n\n${'─'.repeat(47)}`);
    console.log(`  라운드 ${round} / ${MAX_ROUNDS}`);
    console.log('─'.repeat(47));

    // Agent 1: 구매자
    const dynamicCases = await buyerAgent();
    const allCases = [...STATIC_CASES, ...dynamicCases];

    // Agent 2: 검증
    lastEval = await evaluatorAgent(allCases);
    history.push({ round, ...lastEval });

    // 합격 판정
    if (lastEval.score >= PASS_THRESHOLD) {
      printFinalReport(history, lastEval, true);
      process.exit(0);
    }

    // 마지막 라운드가 아니면 Agent 3 실행
    if (round < MAX_ROUNDS) {
      const patched = await fixerAgent(lastEval, round);
      if (patched) {
        console.log('\n   다음 라운드는 서버 재시작 후 진행됩니다.');
        console.log('   30초 대기 후 재시도...');
        await new Promise(r => setTimeout(r, 30000));
      }
    }
  }

  printFinalReport(history, lastEval, false);
}

function printFinalReport(history, lastEval, passed) {
  console.log('\n\n╔═══════════════════════════════════════════╗');
  console.log('║             찰스에게 최종 보고              ║');
  console.log('╚═══════════════════════════════════════════╝');

  history.forEach(h => {
    const filled = Math.round(h.score * 10);
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
    console.log(`  라운드 ${h.round}: [${bar}] ${h.passCount}/${h.total} (${Math.round(h.score * 100)}%)`);
  });

  if (lastEval) {
    const failures = lastEval.results.filter(r => !r.passed);
    if (failures.length) {
      console.log('\n  남은 실패:');
      failures.forEach(f => {
        const why = f.details?.failedChecks?.length
          ? f.details.failedChecks.join(', ')
          : f.details?.data?.code || f.details?.error || '기댓값 불일치';
        console.log(`  ❌ ${f.label} → ${why}`);
      });
    }
  }

  const last = history[history.length - 1];
  console.log('');
  if (passed) {
    console.log(`✅ 결론: 서비스 품질 합격! (${Math.round(last.score * 100)}%)`);
    console.log('   고객이 유용한 결과를 받을 수 있습니다.');
    console.log('   → 결제 연동 및 배포 진행 가능');
  } else {
    console.log(`❌ 결론: 추가 수정 필요 (현재 ${Math.round(last.score * 100)}% / 기준 ${Math.round(PASS_THRESHOLD * 100)}%)`);
    console.log('   위 실패 케이스들을 수동으로 검토해주세요.');
  }
  console.log('═'.repeat(47));
}

main().catch(e => {
  console.error('\n루프 오류:', e.message);
  process.exit(1);
});
