/**
 * 맥도사 고객 경험 시뮬레이터 v2.0
 *
 * 10명의 실제 고객 페르소나가 이메일 등록 후 서비스를 이용하고 리뷰를 남김
 * Agent 1(고객팀) → Agent 2(품질분석+링크검증) → Agent 3(코드개선) → 천계 6문 검증
 *
 * 실행: node test/customer-sim.js [라운드=3]
 */

import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, '..');
const SERVER_URL = 'http://localhost:3000';
const MAX_ROUNDS = parseInt(process.argv[2] || '3');
const REPORT_FILE = join(ROOT, 'test/customer-report.json');

// .env 로드
if (existsSync(join(ROOT, '.env'))) {
  readFileSync(join(ROOT, '.env'), 'utf-8').split('\n').forEach(line => {
    const [k, ...v] = line.split('=');
    if (k && v.length && !process.env[k.trim()]) process.env[k.trim()] = v.join('=').trim();
  });
}
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

// ═══════════════════════════════════════════════════════════
// 10 고객 페르소나 (이메일 추가)
// ═══════════════════════════════════════════════════════════
const CUSTOMERS = [
  {
    id: 'c01',
    name: '김민준',
    email: 'minjun.kim@macdosa-test.com',
    age: 32, job: '스타트업 개발자',
    persona: '맥북 처음 구매, 예산 170만원, M3 Air 고민 중',
    input: { url: 'MacBook Air M3 15인치 8GB 256GB' },
    expectation: ['최저가 쇼핑몰 3곳 이상', '지금 사도 될지 타이밍', '할인 정보'],
    type: 'text',
  },
  {
    id: 'c02',
    name: '이서연',
    email: 'seoyeon.lee@macdosa-test.com',
    age: 25, job: '대학원생',
    persona: '논문 작업용 맥북 프로, 연구실 지원금 200만원',
    input: { url: '맥북프로 M4 14인치 24GB 512GB' },
    expectation: ['정확한 모델 인식', '가성비 최적 구성 추천', '학생할인 정보'],
    type: 'text',
  },
  {
    id: 'c03',
    name: '박지훈',
    email: 'jihun.park@macdosa-test.com',
    age: 41, job: '회사원',
    persona: '중고 맥북 구매 고려, 가격 대비 성능 중시',
    input: { url: 'MacBook Pro M2 Pro 16인치 16GB 512GB 중고' },
    expectation: ['중고 vs 신품 비교', '시세 대비 적정가', 'paths 존재'],
    type: 'text',
  },
  {
    id: 'c04',
    name: '최수아',
    email: 'sua.choi@macdosa-test.com',
    age: 28, job: '프리랜서 디자이너',
    persona: '아이폰 16 프로 구매 계획, 통신사 약정 vs 자급제 고민',
    input: { url: 'iPhone 16 Pro 256GB 블랙 티타늄' },
    expectation: ['자급제 최저가', '통신사 약정 비교', '지금 사야 하나'],
    type: 'text',
  },
  {
    id: 'c05',
    name: '정민호',
    email: 'minho.jung@macdosa-test.com',
    age: 19, job: '대학 신입생',
    persona: '첫 스마트폰 업그레이드, 예산 80만원',
    input: { url: 'iPhone 16 128GB 핑크' },
    expectation: ['80만원 이내 가능한지', '통신사 프로모션', '최저가'],
    type: 'text',
  },
  {
    id: 'c06',
    name: '한예진',
    email: 'yejin.han@macdosa-test.com',
    age: 35, job: '마케팅 매니저',
    persona: '업무용 아이패드 프로, 회사 법인카드 사용',
    input: { url: 'iPad Pro 11인치 M4 256GB WiFi' },
    expectation: ['공식 애플스토어 vs 최저가', '할인 가능한 카드', 'paths 3개 이상'],
    type: 'text',
  },
  {
    id: 'c07',
    name: '오성진',
    email: 'sungjin.oh@macdosa-test.com',
    age: 22, job: '유튜버',
    persona: '에어팟 프로 2세대, 소음차단 중시',
    input: { url: 'AirPods Pro 2세대 USB-C' },
    expectation: ['최저가 쇼핑몰', '정품 보증', '지금 사야 하나'],
    type: 'text',
  },
  {
    id: 'c08',
    name: '강미래',
    email: 'mirae.kang@macdosa-test.com',
    age: 45, job: '의사',
    persona: '애플워치 시리즈 10, 건강 모니터링 중시',
    input: { url: 'Apple Watch Series 10 46mm GPS 알루미늄' },
    expectation: ['최저가', '공식몰 vs 오픈마켓', 'verdict 존재'],
    type: 'text',
  },
  {
    id: 'c09',
    name: '윤준서',
    email: 'junsu.yoon@macdosa-test.com',
    age: 29, job: 'IT 블로거',
    persona: '쿠팡에서 맥북 발견, URL 복사해서 분석 시도',
    input: { url: 'https://www.coupang.com/vp/products/7872063576' },
    expectation: ['URL 분석 or 적절한 에러', 'SCRAPE_FAILED 시 명확한 안내'],
    type: 'url',
  },
  {
    id: 'c10',
    name: '임채원',
    email: 'chaewon.im@macdosa-test.com',
    age: 38, job: '자영업자',
    persona: '3년째 갤럭시북 쓰는데 맥북으로 환승 고민 중. 맥도사 발견하고 비교해보려 했는데 갤럭시북 입력함',
    input: { url: 'Samsung Galaxy Book4 Pro 16인치' },
    expectation: ['NOT_APPLE 에러', '친절한 안내 메시지', '맥북 대안 제품 추천', '서비스 목적 설명'],
    type: 'text',
    expectError: true,
  },
];

// ═══════════════════════════════════════════════════════════
// 베타 가입 (이메일 게이트)
// ═══════════════════════════════════════════════════════════
async function betaJoin(email) {
  try {
    const res = await fetch(`${SERVER_URL}/api/beta-join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json();
    return json.token || null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// API 호출
// ═══════════════════════════════════════════════════════════
async function callAnalyze(body, token) {
  try {
    const res = await fetch(`${SERVER_URL}/api/analyze`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-test-token': ADMIN_TOKEN,
      },
      body: JSON.stringify({ ...body, token: token || undefined }),
      signal: AbortSignal.timeout(120000),
    });
    const json = await res.json();
    return { status: res.status, data: json };
  } catch (e) {
    return { status: 0, data: { error: e.message, code: 'NETWORK_ERROR' } };
  }
}

// ═══════════════════════════════════════════════════════════
// 링크 검증 모듈
// ═══════════════════════════════════════════════════════════
async function fetchStatus(url) {
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }
    });
    return res.status;
  } catch {
    return 0;
  }
}

// 403/418 = bot 탐지 (브라우저 접근 가능), 0 = 진짜 접근 불가
function isLinkOk(status) {
  return status >= 200 && status < 500 && status !== 404 && status !== 410;
}

async function checkLinks(paths, modelQuery) {
  const checks = [];

  // 1. paths 구매 링크 (실제 쇼핑몰 URL)
  for (const p of (paths || [])) {
    if (p.url) {
      const status = await fetchStatus(p.url);
      checks.push({ type: 'path', store: p.store, url: p.url, status, ok: isLinkOk(status) });
    }
  }

  // 2. usedMarket 5채널 고정 링크
  const q = encodeURIComponent(modelQuery || 'MacBook');
  const usedLinks = [
    { name: '맥뮤지엄',   url: `https://www.macmuseum.co.kr/search?q=${q}` },
    { name: '당근마켓',   url: `https://www.daangn.com/kr/buy-sell/?search=${q}` },
    { name: '중고나라',   url: `https://web.joongna.com/search/${q}` },
    { name: '번개장터',   url: `https://m.bunjang.co.kr/search/products?q=${q}` },
    { name: '애플리퍼',  url: 'https://www.apple.com/kr/shop/refurbished/mac' },
  ];
  for (const l of usedLinks) {
    const status = await fetchStatus(l.url);
    checks.push({ type: 'used', name: l.name, url: l.url, status, ok: isLinkOk(status) });
  }

  return checks;
}

// ═══════════════════════════════════════════════════════════
// Agent 1: 고객 경험 수행 (이메일 게이트 포함)
// ═══════════════════════════════════════════════════════════
async function runCustomerExperience(customer) {
  console.log(`\n  👤 ${customer.name}(${customer.age}세, ${customer.job}) — 이메일 등록 중...`);

  // 이메일 게이트: beta-join 먼저
  const token = await betaJoin(customer.email);
  if (token) {
    console.log(`  ✉️  ${customer.email} 베타 등록 완료`);
  } else {
    console.log(`  ⚠️  베타 등록 실패 (x-test-token으로 계속)`);
  }

  console.log(`  🔍 입력: "${customer.input.url.slice(0, 50)}" 분석 중...`);
  const start = Date.now();
  const result = await callAnalyze(customer.input, token);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  // API 응답 구조: { success, tier, analysisId, data: { model, paths, ... } }
  const d = result.data?.data || result.data;
  const isSuccess = result.status === 200 && d?.paths;
  const errorCode = result.data?.code || d?.code;
  const isExpectedError = customer.expectError && (errorCode === 'NOT_APPLE' || errorCode === 'SCRAPE_FAILED');
  const isScrapeFailed = errorCode === 'SCRAPE_FAILED';

  // 고객 관점 평가 (1-5점)
  let score = 0;
  const scoreDetails = [];

  if (customer.expectError) {
    if (isExpectedError) {
      score = 5;
      scoreDetails.push('에러 케이스 정확 처리 ✅');
    } else if (result.status === 200) {
      score = 1;
      scoreDetails.push('에러여야 하는데 성공 반환 ❌');
    } else {
      score = 3;
      scoreDetails.push('에러 처리됐지만 예상과 다름 ⚠️');
    }
  } else if (isScrapeFailed) {
    score = 2;
    scoreDetails.push('URL 스크랩 실패 — 스크린샷 안내 표시됐는지 중요 ⚠️');
  } else if (isSuccess) {
    const pathCount = d.paths?.length || 0;
    const hasFinalPrice = (d.paths?.[0]?.finalPrice || 0) > 0;
    const hasModel = (d.model?.length || 0) > 3;
    const hasVerdict = d.verdict !== undefined;
    const hasAnalysis = d.tian?.body?.length > 0;

    if (pathCount >= 3) { score += 1; scoreDetails.push(`쇼핑 경로 ${pathCount}개 ✅`); }
    else if (pathCount >= 1) { score += 0.5; scoreDetails.push(`쇼핑 경로 ${pathCount}개 (적음) ⚠️`); }
    else { scoreDetails.push('쇼핑 경로 0개 ❌'); }

    if (hasFinalPrice) { score += 1; scoreDetails.push('가격 정보 있음 ✅'); }
    else { scoreDetails.push('가격 없음 ❌'); }

    if (hasModel) { score += 1; scoreDetails.push('모델 인식 ✅'); }
    else { scoreDetails.push('모델 인식 실패 ❌'); }

    if (hasVerdict) { score += 1; scoreDetails.push('구매 판정 있음 ✅'); }
    else { scoreDetails.push('판정 없음 ❌'); }

    if (hasAnalysis) { score += 1; scoreDetails.push('시세 분석 있음 ✅'); }
    else { scoreDetails.push('시세 분석 없음 ❌'); }
  } else {
    score = 0;
    scoreDetails.push(`실패: ${d?.error || '알 수 없는 오류'} ❌`);
  }

  // 구매 링크 검증
  let linkChecks = [];
  if (isSuccess && d?.paths?.length > 0) {
    const modelName = d.model || customer.input.url.split(' ').slice(0, 3).join(' ');
    console.log(`  🔗 구매링크 검증 중 (${(d.paths?.filter(p => p.url)?.length || 0)}개 경로 + 중고 5채널)...`);
    linkChecks = await checkLinks(d.paths, modelName);
    const pathOk = linkChecks.filter(l => l.type === 'path' && l.ok).length;
    const pathTotal = linkChecks.filter(l => l.type === 'path').length;
    const usedOk = linkChecks.filter(l => l.type === 'used' && l.ok).length;
    console.log(`  📊 링크: 구매경로 ${pathOk}/${pathTotal} ✅ | 중고채널 ${usedOk}/5 ✅`);
  }

  // 고객 리뷰 생성 (Claude CLI로)
  let review = '';
  let improvements = [];

  try {
    const reviewPrompt = `당신은 ${customer.name}(${customer.age}세, ${customer.job})입니다.
페르소나: ${customer.persona}
기대: ${customer.expectation.join(', ')}

맥도사 서비스에서 "${customer.input.url}"을 분석한 결과입니다:
- 응답 코드: ${result.status}
- 오류 코드: ${d?.code || '없음'}
- 오류 메시지: ${d?.error ? d.error.slice(0,80) : '없음'}
- 추천 대안: ${d?.suggestions ? d.suggestions.join(', ') : '없음'}
- 모델명: ${d?.model || '없음'}
- 쇼핑 경로 수: ${d?.paths?.length || 0}개
- 최저가: ${d?.paths?.[0]?.finalPrice ? d.paths[0].finalPrice.toLocaleString() + '원' : '없음'}
- 시세 분석: ${d?.tian?.body ? '있음' : '없음'}
- 구매 판정: ${d?.verdict?.title || (d?.verdict?.buy !== undefined ? '있음' : '없음')}
- 소요시간: ${elapsed}초

다음 형식으로 정확히 JSON만 출력하세요 (다른 텍스트 없이):
{
  "stars": 1~5,
  "review": "50자 내외 실제 한국어 리뷰 (진짜 사람처럼)",
  "willPay": true/false,
  "improvements": ["개선점1", "개선점2"]
}`;

    const claudeResult = spawnSync('/usr/local/bin/claude', [
      '-p', reviewPrompt,
      '--model', 'claude-haiku-4-5-20251001',
      '--output-format', 'text',
      '--dangerously-skip-permissions'
    ], { encoding: 'utf-8', timeout: 30000, env: process.env, cwd: '/tmp' });

    if (claudeResult.status === 0) {
      const text = claudeResult.stdout.trim();
      const jsonMatch = text.match(/\{[\s\S]+\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        review = parsed.review || '';
        improvements = parsed.improvements || [];
        score = parsed.stars || score;
      }
    }
  } catch {
    review = score >= 4 ? '유용한 서비스네요' : score >= 2 ? '아직 개선이 필요해요' : '실망스러워요';
  }

  const result_summary = {
    customerId: customer.id,
    name: customer.name,
    email: customer.email,
    input: customer.input.url.slice(0, 50),
    status: result.status,
    code: errorCode,
    model: d?.model,
    pathCount: d?.paths?.length || 0,
    lowestPrice: d?.paths?.[0]?.finalPrice || 0,
    hasVerdict: !!d?.verdict,
    elapsed: parseFloat(elapsed),
    score,
    scoreDetails,
    review,
    improvements,
    willPay: score >= 4,
    linkChecks,
    raw: { paths: d?.paths?.slice(0, 2), verdict: d?.verdict, tian: d?.tian }
  };

  const emoji = score >= 4 ? '⭐⭐⭐⭐⭐' : score >= 3 ? '⭐⭐⭐' : score >= 2 ? '⭐⭐' : '⭐';
  console.log(`  ${emoji} ${customer.name}: ${score}점 — "${review}" (${elapsed}초)`);

  return result_summary;
}

// ═══════════════════════════════════════════════════════════
// Agent 2: 품질 분석 + 링크 검증 집계
// ═══════════════════════════════════════════════════════════
function analyzeQuality(results) {
  const total = results.length;
  const avgScore = (results.reduce((s, r) => s + r.score, 0) / total).toFixed(1);
  const willPay = results.filter(r => r.willPay).length;
  const failures = results.filter(r => r.score < 3 && !CUSTOMERS.find(c => c.id === r.customerId)?.expectError);

  // 링크 검증 집계
  const allLinkChecks = results.flatMap(r => r.linkChecks || []);
  const pathChecks = allLinkChecks.filter(l => l.type === 'path');
  const usedChecks = allLinkChecks.filter(l => l.type === 'used');
  const pathPassRate = pathChecks.length > 0 ? pathChecks.filter(l => l.ok).length / pathChecks.length : null;
  const usedPassRate = usedChecks.length > 0 ? usedChecks.filter(l => l.ok).length / usedChecks.length : null;
  const failedLinks = allLinkChecks.filter(l => !l.ok && l.status !== 0);
  const deadLinks = allLinkChecks.filter(l => l.status === 0);

  // 공통 개선점 집계
  const improvementCounts = {};
  results.forEach(r => {
    (r.improvements || []).forEach(imp => {
      improvementCounts[imp] = (improvementCounts[imp] || 0) + 1;
    });
  });
  const topImprovements = Object.entries(improvementCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  console.log(`\n  📊 품질 분석:`);
  console.log(`  - 평균 점수: ${avgScore}/5.0`);
  console.log(`  - 결제 의향: ${willPay}/${total}명 (${Math.round(willPay/total*100)}%)`);
  console.log(`  - 실패 케이스: ${failures.length}개`);
  if (pathChecks.length > 0) console.log(`  - 구매링크 통과율: ${pathChecks.filter(l => l.ok).length}/${pathChecks.length} (${Math.round((pathPassRate||0)*100)}%)`);
  if (usedChecks.length > 0) console.log(`  - 중고채널 통과율: ${usedChecks.filter(l => l.ok).length}/${usedChecks.length} (${Math.round((usedPassRate||0)*100)}%)`);
  if (deadLinks.length > 0) console.log(`  - 접근 불가 링크: ${deadLinks.map(l => l.name || l.store).join(', ')}`);
  console.log(`  - 주요 개선점: ${topImprovements.slice(0, 3).join(' / ')}`);

  return {
    avgScore: parseFloat(avgScore),
    willPayRate: willPay / total,
    failCount: failures.length,
    failures: failures.map(f => ({ name: f.name, input: f.input, score: f.score, details: f.scoreDetails })),
    topImprovements,
    linkStats: {
      pathPassRate,
      usedPassRate,
      failedLinks: failedLinks.map(l => ({ name: l.name || l.store, url: l.url, status: l.status })),
      deadLinks: deadLinks.map(l => ({ name: l.name || l.store, url: l.url })),
    },
    isReady: parseFloat(avgScore) >= 4.0 && willPay / total >= 0.7,
  };
}

// ═══════════════════════════════════════════════════════════
// Agent 3: 코드 개선 (Claude CLI 활용)
// ═══════════════════════════════════════════════════════════
function applyCodeFix(analysis, round) {
  if (analysis.isReady) {
    console.log('\n  ✅ 출시 기준 달성! 코드 수정 불필요.');
    return false;
  }

  const serverCode = readFileSync(join(ROOT, 'server.js'), 'utf-8');

  const failureDesc = analysis.failures.map(f =>
    `- ${f.name}: ${f.input} → 점수 ${f.score} (${f.details.join(', ')})`
  ).join('\n');

  const linkIssues = [
    ...(analysis.linkStats.deadLinks || []).map(l => `- ${l.name || l.store}: 접근 불가 (curl 000)`),
    ...(analysis.linkStats.failedLinks || []).map(l => `- ${l.name || l.store}: HTTP ${l.status}`),
  ].join('\n') || '없음';

  const prompt = `맥도사 서비스 코드 개선 요청 (라운드 ${round})

## 현재 품질 지표
- 평균 고객 점수: ${analysis.avgScore}/5.0
- 결제 의향률: ${Math.round(analysis.willPayRate * 100)}%
- 실패 케이스: ${analysis.failCount}개
- 구매링크 통과율: ${analysis.linkStats.pathPassRate !== null ? Math.round((analysis.linkStats.pathPassRate||0)*100)+'%' : '데이터 없음'}
- 중고채널 통과율: ${analysis.linkStats.usedPassRate !== null ? Math.round((analysis.linkStats.usedPassRate||0)*100)+'%' : '데이터 없음'}

## 실패한 고객들
${failureDesc || '없음'}

## 링크 문제
${linkIssues}

## 고객 주요 개선 요구사항
${analysis.topImprovements.map((t, i) => `${i+1}. ${t}`).join('\n')}

## server.js 핵심 부분 (앞 8000자)
\`\`\`javascript
${serverCode.slice(0, 8000)}
\`\`\`

## 할 일
위 실패 케이스를 분석하고, server.js에서 수정할 수 있는 구체적인 코드 변경사항을 JSON으로 출력하세요.
각 패치는 old_str을 new_str로 교체하는 형식입니다.

정확히 이 JSON 형식만 출력 (설명 없이):
{
  "patches": [
    {
      "file": "server.js",
      "description": "패치 설명",
      "old_str": "교체할 정확한 코드 (파일에 실제로 존재해야 함)",
      "new_str": "새 코드"
    }
  ],
  "summary": "이번 라운드 개선 내용 요약"
}`;

  console.log('\n  🔧 Agent 3: 코드 개선 분석 중...');

  const claudeResult = spawnSync('/usr/local/bin/claude', [
    '-p', prompt,
    '--model', 'claude-haiku-4-5-20251001',
    '--output-format', 'text',
    '--dangerously-skip-permissions'
  ], { encoding: 'utf-8', timeout: 60000, env: process.env, cwd: '/tmp' });

  if (claudeResult.status !== 0) {
    console.log('  ⚠️ Agent 3 실패:', claudeResult.stderr?.slice(0, 100));
    return false;
  }

  const text = claudeResult.stdout.trim();
  const jsonMatch = text.match(/\{[\s\S]+\}/);
  if (!jsonMatch) {
    console.log('  ⚠️ Agent 3: JSON 파싱 실패');
    return false;
  }

  let patches;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    patches = parsed.patches || [];
    console.log(`  💡 개선 내용: ${parsed.summary || '없음'}`);
  } catch {
    console.log('  ⚠️ JSON 파싱 오류');
    return false;
  }

  let applied = 0;
  for (const patch of patches) {
    if (patch.file !== 'server.js') continue;
    if (!patch.old_str || !patch.new_str) continue;
    try {
      const file = readFileSync(join(ROOT, patch.file), 'utf-8');
      if (!file.includes(patch.old_str)) {
        console.log(`  ⚠️ 패치 건너뜀 (old_str 없음): ${patch.description}`);
        continue;
      }
      const updated = file.replace(patch.old_str, patch.new_str);
      writeFileSync(join(ROOT, patch.file), updated, 'utf-8');
      console.log(`  ✅ 패치 적용: ${patch.description}`);
      applied++;
    } catch (e) {
      console.log(`  ❌ 패치 실패: ${patch.description} — ${e.message}`);
    }
  }

  if (applied > 0) {
    console.log(`  🔄 서버 재시작 필요 (${applied}개 패치 적용됨)`);
    writeFileSync(join(ROOT, 'test/.restart-needed'), new Date().toISOString());
  }

  return applied > 0;
}

// ═══════════════════════════════════════════════════════════
// 천계 6문 검증 (작업 완료 전 필수)
// ═══════════════════════════════════════════════════════════
function cheongye6munCheck(quality, allRounds) {
  const latest = allRounds[allRounds.length - 1];
  const results = latest.results;

  const checks = {
    一: quality.avgScore >= 4.0,
    三: results.some(r => r.pathCount > 0) && results.some(r => r.hasVerdict) && results.some(r => r.review),
    合: allRounds.length > 1 || quality.isReady,
    本: results.some(r => r.customerId === 'c10' && r.code === 'NOT_APPLE'),
    人: quality.willPayRate >= 0.7,
    次一: quality.topImprovements.length > 0,
  };

  const labels = { 一: '중심(최저가 정확도)', 三: '삼축(경로·판정·리뷰)', 合: '개선 적용', 本: 'NOT_APPLE 처리', 人: '결제 의향 70%+', 次一: '다음 씨앗 존재' };
  const failCount = Object.values(checks).filter(v => !v).length;

  console.log('\n' + '═'.repeat(60));
  console.log('⚡ 천계 6문 검증');
  console.log('─'.repeat(60));
  Object.entries(checks).forEach(([k, v]) => {
    console.log(`  ${v ? '✅' : '❌'} ${k} — ${labels[k]}`);
  });
  console.log('─'.repeat(60));

  if (failCount >= 2) {
    console.log(`  ⚠️ ${failCount}개 검증 실패 → 재정렬 필요`);
  } else {
    console.log('  ✅ 천계 통과 (실패 1개 이하)');
  }

  return { checks, failCount, passed: failCount < 2 };
}

// ═══════════════════════════════════════════════════════════
// 서버 헬스체크
// ═══════════════════════════════════════════════════════════
async function checkServer() {
  try {
    const res = await fetch(`${SERVER_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) return true;
  } catch {}
  return false;
}

// ═══════════════════════════════════════════════════════════
// 최종 보고서 생성
// ═══════════════════════════════════════════════════════════
function generateFinalReport(allRounds, cheongyeResult) {
  const latest = allRounds[allRounds.length - 1];
  const first = allRounds[0];

  const allLinkChecks = latest.results.flatMap(r => r.linkChecks || []);
  const totalLinks = allLinkChecks.length;
  const passedLinks = allLinkChecks.filter(l => l.ok).length;

  const report = {
    generatedAt: new Date().toISOString(),
    rounds: allRounds.length,
    improvement: {
      avgScore: `${first.quality.avgScore} → ${latest.quality.avgScore}`,
      willPayRate: `${Math.round(first.quality.willPayRate*100)}% → ${Math.round(latest.quality.willPayRate*100)}%`,
    },
    finalQuality: latest.quality,
    linkVerification: {
      total: totalLinks,
      passed: passedLinks,
      passRate: totalLinks > 0 ? Math.round(passedLinks / totalLinks * 100) + '%' : 'N/A',
      failed: allLinkChecks.filter(l => !l.ok).map(l => ({ name: l.name || l.store, status: l.status, url: l.url })),
    },
    cheongyeVerification: cheongyeResult,
    customerReviews: latest.results.map(r => ({
      name: r.name,
      email: r.email,
      input: r.input,
      stars: r.score,
      review: r.review,
      willPay: r.willPay,
    })),
    topPositives: latest.results
      .filter(r => r.score >= 4)
      .map(r => `${r.name}: "${r.review}"`),
    topIssues: latest.quality.topImprovements,
    recommendation: latest.quality.isReady
      ? '✅ 출시 준비 완료 — 고객이 돈을 낼 만한 서비스입니다.'
      : `⚠️ 추가 개선 필요 — 평균 ${latest.quality.avgScore}점, 결제 의향 ${Math.round(latest.quality.willPayRate*100)}%`,
  };

  writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf-8');
  return report;
}

// ═══════════════════════════════════════════════════════════
// 메인 루프
// ═══════════════════════════════════════════════════════════
async function main() {
  console.log('\n' + '═'.repeat(60));
  console.log('🎯 맥도사 고객 경험 시뮬레이션 v2.0');
  console.log(`   10명 고객 × 최대 ${MAX_ROUNDS}라운드`);
  console.log('   이메일 게이트 + 링크 검증 + 천계 6문');
  console.log('═'.repeat(60));

  const alive = await checkServer();
  if (!alive) {
    console.error('\n❌ 서버가 실행 중이지 않습니다. 먼저 npm start로 서버를 시작하세요.');
    process.exit(1);
  }
  console.log('✅ 서버 연결 확인\n');

  const allRounds = [];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`🔄 라운드 ${round}/${MAX_ROUNDS}`);
    console.log('─'.repeat(60));

    // Agent 1: 모든 고객 경험 병렬 실행
    console.log('\n👥 Agent 1: 10명 고객 경험 병렬 시작...');
    const results = await Promise.all(CUSTOMERS.map(c => runCustomerExperience(c)));

    // Agent 2: 품질 분석 + 링크 검증
    console.log('\n📊 Agent 2: 품질 분석 + 링크 검증 집계...');
    const quality = analyzeQuality(results);

    allRounds.push({ round, results, quality });

    if (quality.isReady) {
      console.log('\n🎉 출시 기준 달성!');
      console.log(`   평균 점수: ${quality.avgScore}/5.0`);
      console.log(`   결제 의향: ${Math.round(quality.willPayRate*100)}%`);
      break;
    }

    if (round === MAX_ROUNDS) break;

    // Agent 3: 코드 개선
    console.log('\n🔧 Agent 3: 코드 개선 시도...');
    const fixed = applyCodeFix(quality, round);

    if (fixed) {
      console.log('\n  ⏳ 서버 재시작 대기 중 (10초)...');
      await new Promise(res => setTimeout(res, 10000));

      let attempts = 0;
      while (attempts < 6) {
        const ok = await checkServer();
        if (ok) { console.log('  ✅ 서버 준비됨'); break; }
        await new Promise(res => setTimeout(res, 5000));
        attempts++;
      }
    }
  }

  // 천계 6문 검증
  const latest = allRounds[allRounds.length - 1];
  const cheongyeResult = cheongye6munCheck(latest.quality, allRounds);

  // 최종 보고서
  console.log('\n' + '═'.repeat(60));
  console.log('📋 최종 보고서');
  console.log('═'.repeat(60));

  const report = generateFinalReport(allRounds, cheongyeResult);

  console.log(`\n개선 추이: ${report.improvement.avgScore} (평균 점수)`);
  console.log(`결제 의향: ${report.improvement.willPayRate}`);
  console.log(`링크 통과율: ${report.linkVerification.passRate}`);
  console.log(`천계 검증: ${cheongyeResult.passed ? '✅ 통과' : '❌ 실패 ' + cheongyeResult.failCount + '개'}`);
  console.log(`\n${report.recommendation}`);

  console.log('\n⭐ 고객 리뷰:');
  report.customerReviews.forEach(r => {
    const stars = '⭐'.repeat(Math.round(r.stars));
    console.log(`  ${stars} ${r.name}: "${r.review}" ${r.willPay ? '💳' : ''}`);
  });

  console.log('\n🔧 주요 개선 요구:');
  report.topIssues.forEach((issue, i) => console.log(`  ${i+1}. ${issue}`));

  if (report.linkVerification.failed.length > 0) {
    console.log('\n🔗 링크 실패 목록:');
    report.linkVerification.failed.forEach(l => console.log(`  - ${l.name}: HTTP ${l.status}`));
  }

  console.log(`\n📄 상세 보고서: test/customer-report.json`);
  console.log('\n보고 완료 ✅');
}

main().catch(e => {
  console.error('❌ 오류:', e);
  process.exit(1);
});
