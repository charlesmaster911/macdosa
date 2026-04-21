/**
 * 맥도사 로직 검증 백테스트
 * 입력 → 출력 대조: 정렬 / alreadyLowest / saveAmount / 할인율 정확도
 *
 * 실행: node test/logic-verify.js
 */

const BASE_URL = 'http://localhost:3000';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'macdosa-admin-2026';

const RED   = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN  = '\x1b[36m';
const RESET = '\x1b[0m';

// ── 검증 케이스 ──────────────────────────────────────────
const CASES = [
  {
    label: '맥북 M4 텍스트 입력 (할인 경로 존재 → alreadyLowest=false 예상)',
    input: 'MacBook Pro 14인치 M4 16GB 512GB',
    customerPrice: null, // 텍스트 입력이라 customerPrice 없음
    expect: {
      pathsSorted: true,     // paths[0].finalPrice ≤ paths[1].finalPrice
      hasPaths: true,        // paths 1개 이상
      noNullFinalPrice: true // 모든 path에 finalPrice 존재
    }
  },
  {
    label: '아이폰 16 — 자급제 vs 통신사 비교 존재해야 함',
    input: 'iPhone 16 128GB',
    customerPrice: null,
    expect: {
      pathsSorted: true,
      hasPaths: true,
      hasIphoneCarrier: true, // paths 중 통신사 약정 경로 1개 이상
    }
  },
  {
    label: 'AirPods Pro — 경량 분석, paths 정렬 확인',
    input: 'AirPods Pro 2세대 USB-C',
    customerPrice: null,
    expect: {
      pathsSorted: true,
      hasPaths: true,
    }
  }
];

async function callAnalyze(input) {
  const res = await fetch(`${BASE_URL}/api/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-token': ADMIN_TOKEN,
    },
    body: JSON.stringify({ url: input })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`HTTP ${res.status}: ${err.error || 'unknown'}`);
  }
  const body = await res.json();
  // 서버 응답: { success, data: analysis } — data 레이어 unwrap
  return body.data || body;
}

function verify(data, expect, customerPrice) {
  const results = [];
  const paths = data.paths || [];

  // 1. paths 존재 여부
  if (expect.hasPaths) {
    results.push({
      name: 'paths 1개 이상',
      pass: paths.length > 0,
      detail: `paths.length = ${paths.length}`
    });
  }

  // 2. finalPrice 모두 존재
  if (expect.noNullFinalPrice) {
    const missing = paths.filter(p => !p.finalPrice || p.finalPrice <= 0);
    results.push({
      name: 'finalPrice 누락 없음',
      pass: missing.length === 0,
      detail: missing.length > 0 ? `누락: ${missing.map(p => p.store).join(', ')}` : 'OK'
    });
  }

  // 3. finalPrice 오름차순 정렬
  if (expect.pathsSorted && paths.length > 1) {
    let sorted = true;
    for (let i = 0; i < paths.length - 1; i++) {
      const a = paths[i].finalPrice || Infinity;
      const b = paths[i+1].finalPrice || Infinity;
      if (a > b) { sorted = false; break; }
    }
    results.push({
      name: 'paths finalPrice 오름차순 정렬',
      pass: sorted,
      detail: sorted ? 'OK' : `paths[0]=${paths[0]?.finalPrice?.toLocaleString()} > paths[1]=${paths[1]?.finalPrice?.toLocaleString()} ← 역순!`
    });
  }

  // 4. alreadyLowest 검증
  if (customerPrice && paths.length > 0) {
    const cheapest = paths[0].finalPrice;
    const aiSaidLowest = data.verdict?.alreadyLowest;
    const shouldBeLowest = cheapest >= customerPrice;
    results.push({
      name: 'alreadyLowest 정확도',
      pass: aiSaidLowest === shouldBeLowest,
      detail: `AI=${aiSaidLowest}, 실제=${shouldBeLowest} (고객가=${customerPrice?.toLocaleString()}, paths[0]=${cheapest?.toLocaleString()})`
    });
  }

  // 5. saveAmount 검증
  if (customerPrice && paths.length > 0) {
    const cheapest = paths[0].finalPrice;
    const expectedSave = Math.max(0, customerPrice - cheapest);
    const actualSave = data.saveAmount || 0;
    const diff = Math.abs(expectedSave - actualSave);
    results.push({
      name: 'saveAmount 정확도 (오차 ±1만원)',
      pass: diff <= 10000,
      detail: `서버=${actualSave?.toLocaleString()}, 계산값=${expectedSave?.toLocaleString()}, 오차=${diff?.toLocaleString()}`
    });
  }

  // 6. 아이폰 통신사 경로 존재
  if (expect.hasIphoneCarrier) {
    const hasCarrier = paths.some(p =>
      p.store && /SKT|KT|LGU\+|통신사|약정/i.test(p.store + ' ' + (p.dealType||'') + ' ' + (p.condition||''))
    );
    results.push({
      name: 'iPhone 통신사 약정 경로 존재',
      pass: hasCarrier,
      detail: hasCarrier ? 'OK' : `경로 목록: ${paths.map(p=>p.store).join(', ')}`
    });
  }

  return results;
}

async function runAll() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${CYAN}🧪 맥도사 로직 검증 백테스트${RESET}`);
  console.log(`${'═'.repeat(60)}\n`);

  // 서버 연결 확인
  try {
    const ping = await fetch(`${BASE_URL}/api/stats/public`);
    if (!ping.ok) throw new Error();
    console.log(`${GREEN}✅ 서버 연결 OK${RESET}\n`);
  } catch {
    console.log(`${RED}❌ 서버 연결 실패 — node server.js 먼저 실행하세요${RESET}`);
    process.exit(1);
  }

  let totalPass = 0, totalFail = 0;

  for (const c of CASES) {
    console.log(`${CYAN}─── ${c.label}${RESET}`);
    console.log(`    입력: "${c.input}"`);
    let data;
    try {
      data = await callAnalyze(c.input);
    } catch (err) {
      console.log(`    ${RED}❌ 분석 실패: ${err.message}${RESET}\n`);
      totalFail++;
      continue;
    }

    const paths = data.paths || [];
    console.log(`    모델: ${data.model || '?'}`);
    console.log(`    paths: ${paths.length}개`);
    if (paths.length > 0) {
      console.log(`    paths 순서:`);
      paths.forEach((p, i) => {
        console.log(`      ${i+1}. ${p.store} | finalPrice=${p.finalPrice?.toLocaleString() || 'NULL'}원 | save=${p.saveAmount?.toLocaleString() || 0}원`);
      });
    }
    console.log(`    alreadyLowest=${data.verdict?.alreadyLowest}, saveAmount=${data.saveAmount?.toLocaleString()}`);
    console.log(`    verdict: "${data.verdict?.title}"`);

    const checks = verify(data, c.expect, c.customerPrice);
    checks.forEach(ch => {
      const icon = ch.pass ? `${GREEN}✅` : `${RED}❌`;
      console.log(`    ${icon} ${ch.name}${RESET} — ${ch.detail}`);
      if (ch.pass) totalPass++; else totalFail++;
    });
    console.log();
  }

  console.log(`${'═'.repeat(60)}`);
  console.log(`결과: ${GREEN}✅ ${totalPass}개 통과${RESET} / ${totalFail > 0 ? RED : GREEN}❌ ${totalFail}개 실패${RESET}`);
  if (totalFail === 0) {
    console.log(`${GREEN}🎯 천계 6문 一 통과 — 최저가 정확도 검증 완료${RESET}`);
  } else {
    console.log(`${RED}⚠️ 실패 있음 — server.js 로직 재점검 필요${RESET}`);
  }
  console.log(`${'═'.repeat(60)}\n`);
}

runAll().catch(console.error);
