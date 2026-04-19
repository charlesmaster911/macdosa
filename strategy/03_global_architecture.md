# 맥도사 글로벌 확장 아키텍처 설계
> 작성일: 2026-04-19 | 천계 프로토콜 v2.0 기반

---

## 一 (현재 중심)
맥도사의 본질: **"어느 나라에서든, 어떤 Mac을 살 때든, 가장 싸게 살 수 있는 길을 찾아준다"**
기술이 바뀌어도 이 본은 움직이지 않는다.

---

## 현재 상태 스냅샷

| 항목 | 현황 |
|------|------|
| 데이터 | `db.json` — 로컬 JSON (users/analyses/purchases/deals) |
| AI | Claude CLI (`claude -p`) + Anthropic SDK, 한국어 프롬프트 |
| 채널 | 쿠팡, 다나와, 네이버쇼핑, 맥뮤지엄, 당근/번개 |
| 결제 | 토스페이먼츠 (한국 전용) |
| 배포 | Render 예정 |
| 국제화 | 없음 (한국어 하드코딩) |

---

## Phase 0 — 지금 당장, 코드 변경 없이 할 수 있는 것

### 0-1. 도메인 & SEO 다국어 준비
- `macdosa.kr` 유지 + `macdosa.app` 글로벌 도메인 선점 ($12/년)
- `<html lang="ko">` → 배포 시 Accept-Language 헤더 기반으로 자동 전환 준비 (서버 로직 1줄)
- Google Search Console에 국가별 타깃 설정 준비

### 0-2. 데이터 수동 국가 필드 추가
`db.json`의 `analyses` 레코드에 `country` 필드를 수동으로 추가 시작.
아직 스키마 변경 없이, 새 분석 요청 시 URL 패턴으로 자동 감지:
```
coupang.com      → "KR"
amazon.com       → "US"
amazon.co.jp     → "JP"
amazon.co.uk     → "GB"
```
서버 코드 3줄 추가로 완료 (스키마 변경 없음).

### 0-3. 영어 프롬프트 초안 파일 분리 준비
현재 프롬프트는 server.js에 한국어로 하드코딩.
지금 당장: `prompts/` 폴더 만들고 `ko.js` 파일로 추출해두기.
코드 변경 없이 파일 구조만 준비.

---

## Phase 1 — 구조 최소 변경 (1-2주)

### 1-1. 국가별 DB 분리 구조

#### 옵션 1: 단일 JSON + country 필드 (권장 — 지금 바로 적용)
```json
// db.json 확장 스키마
{
  "analyses": [
    {
      "id": "...",
      "country": "KR",          // 추가
      "currency": "KRW",        // 추가
      "channels": ["coupang", "danawa"],  // 추가
      "url": "...",
      "model": "...",
      ...
    }
  ],
  "deals": [
    {
      "country": "US",
      "store": "B&H",
      "currency": "USD",
      "price": 1999,
      ...
    }
  ]
}
```
**장점**: 코드 변경 최소. 지금 db.json 구조 유지하면서 필드만 추가.
**단점**: 100만 건 이상 시 느려짐 (그때 Supabase로 이전).

#### 옵션 2: 국가별 파일 분리 (`db_kr.json`, `db_us.json`)
코드에서 `readDB(country)` 함수 하나만 수정.
파일이 없으면 자동 생성. Supabase 이전 전까지 버틸 수 있음.

**결론**: 옵션 1로 시작 → 일 분석 1,000건 초과 시 옵션 2 → Supabase 이전.

---

### 1-2. 다국어(i18n) 구조 — HTML 수정 최소화 전략

#### 구조 설계
```
/locales/
  ko.json    ← 현재 한국어 (기준)
  en.json    ← 영어
  ja.json    ← 일본어
  zh.json    ← 중국어 (번체/간체 통합)
```

#### 적용 방식: 서버사이드 변수 주입 (HTML 변경 최소)
```js
// server.js — GET / 라우트 수정 (5줄 추가)
app.get('/', (req, res) => {
  const lang = req.query.lang || 
    req.headers['accept-language']?.split(',')[0].slice(0,2) || 'ko';
  const t = JSON.parse(readFileSync(`./locales/${lang}.json`));
  let html = readFileSync('./index.html', 'utf-8');
  // {{TITLE}} 같은 플레이스홀더를 실제 텍스트로 교체
  Object.entries(t).forEach(([k, v]) => {
    html = html.replaceAll(`{{${k}}}`, v);
  });
  res.send(html);
});
```

#### index.html 변경: 텍스트만 플레이스홀더로 교체
```html
<!-- 기존 -->
<h1>맥북 최저가 분석</h1>

<!-- 변경 후 -->
<h1>{{HERO_TITLE}}</h1>
```
HTML 구조, CSS, JS 일절 변경 없음. 텍스트 문자열만 교체.

#### URL 구조
```
macdosa.app/          → Accept-Language 자동 감지
macdosa.app/?lang=en  → 영어 강제
macdosa.app/?lang=ja  → 일본어 강제
macdosa.app/en/       → (Phase 2 서브도메인 분리 시)
```

---

### 1-3. 국가별 채널 설정 파일

```js
// config/channels.js
export const CHANNELS = {
  KR: {
    currency: 'KRW',
    locale: 'ko-KR',
    primary: ['coupang', 'danawa', 'naver-shopping'],
    secondary: ['apple-kr-refurb', 'macmuseum', 'bunjang', 'carrot'],
    cardDiscounts: ['hyundai', 'samsung', 'shinhan', 'kb', 'lotte'],
    searchTerms: {
      refurb: '애플 공인 리퍼비시',
      used: '당근마켓 번개장터',
      lowestPrice: '네이버쇼핑 최저가'
    }
  },
  US: {
    currency: 'USD',
    locale: 'en-US',
    primary: ['bhphotovideo', 'bestbuy', 'amazon-us', 'adorama'],
    secondary: ['apple-refurb-us', 'swappa', 'ebay'],
    cardDiscounts: ['amex-blue', 'chase-sapphire', 'citi-double-cash'],
    searchTerms: {
      refurb: 'Apple Certified Refurbished',
      used: 'Swappa MacBook',
      lowestPrice: 'MacBook lowest price'
    }
  },
  JP: {
    currency: 'JPY',
    locale: 'ja-JP',
    primary: ['amazon-jp', 'kakaku', 'yodobashi', 'biccamera'],
    secondary: ['apple-refurb-jp', 'mercari', 'yahoo-auctions'],
    cardDiscounts: ['rakuten', 'softbank', 'jcb'],
    searchTerms: {
      refurb: 'Apple認定整備済製品',
      used: 'メルカリ MacBook',
      lowestPrice: 'MacBook 最安値'
    }
  },
  EU: {
    currency: 'EUR',
    locale: 'en-GB',
    primary: ['amazon-de', 'amazon-fr', 'mediamarkt', 'currys'],
    secondary: ['apple-refurb-eu', 'backmarket', 'rebuy'],
    cardDiscounts: ['revolut', 'n26', 'amex-eu'],
    searchTerms: {
      refurb: 'Apple Refurbished',
      used: 'Back Market MacBook',
      lowestPrice: 'MacBook cheapest'
    }
  }
};
```

---

## Phase 2 — AI 프롬프트 국가별 커스터마이징 (2-4주)

### 현재 구조 문제
프롬프트가 `server.js` 안에 한국어 하드코딩 (약 100줄).
국가 추가 시마다 server.js를 수정해야 함 → 유지보수 불가.

### 해결: 프롬프트 팩토리 패턴

```
/prompts/
  base.js         ← 공통 JSON 출력 스키마 (언어 무관)
  strategies/
    KR.js          ← 한국 채널 전략 (현재 코드 이전)
    US.js          ← 미국 채널 전략
    JP.js          ← 일본 채널 전략
    EU.js          ← 유럽 채널 전략
```

```js
// prompts/strategies/US.js
export function buildUSPrompt({ url, today, recentDeals, championHints }) {
  return `MacBook lowest price analysis task.
  
Target URL: ${url}
Today: ${today}

Search channels IN ORDER:
1. B&H Photo (bhphotovideo.com) — check current price and bundles
2. Best Buy (bestbuy.com) — check student discount, open-box
3. Amazon US (amazon.com) — check Warehouse Deals
4. Apple Refurbished (apple.com/shop/refurbished) — certified refurb
5. Swappa (swappa.com) — used market pricing

Credit card discounts to check:
- Amex Blue Cash Everyday: 3% back at US supermarkets
- Chase Sapphire: travel points
- Apple Card: 3% cash back at Apple

${recentDeals ? `[Recent deals]\n${recentDeals}` : ''}

IMPORTANT: Respond ONLY in this exact JSON format...
${BASE_JSON_SCHEMA}
`;
}
```

```js
// server.js — 변경 후
import { buildKRPrompt } from './prompts/strategies/KR.js';
import { buildUSPrompt } from './prompts/strategies/US.js';

const promptBuilders = { KR: buildKRPrompt, US: buildUSPrompt, JP: buildJPPrompt };

// analyze 라우트에서
const country = detectCountry(url, req);
const buildPrompt = promptBuilders[country] || promptBuilders['KR'];
const prompt = buildPrompt({ url, today, recentDeals, championHints });
```

**핵심 효과**: 새 국가 추가 = 새 파일 1개 추가. server.js 수정 없음.

---

## Phase 3 — 결제 수단 글로벌 로드맵

### 현재: 토스페이먼츠 (한국 전용)
```
토스 → 국내 카드/계좌이체/네이버페이/카카오페이
```

### 글로벌 확장 로드맵

| 단계 | 시장 | 결제 수단 | 구현 난이도 |
|------|------|-----------|------------|
| Phase 1 (지금) | 한국 | 토스페이먼츠 유지 | 완료 |
| Phase 2 (1개월) | 글로벌 신규 | Stripe (카드) | 낮음 |
| Phase 2 (1개월) | 일본 | Stripe + PayPay | 중간 |
| Phase 3 (3개월) | 미국 | Stripe + Apple Pay | 낮음 |
| Phase 3 (3개월) | 유럽 | Stripe + SEPA | 중간 |
| Phase 4 (6개월) | 동남아 | Stripe + GrabPay | 중간 |

### Stripe 전환 설계 원칙
```js
// payments/index.js — 결제 추상화 레이어
export async function createPayment({ amount, currency, country, method }) {
  if (country === 'KR') {
    return tossPayments.createPayment({ amount, currency: 'KRW' });
  }
  // 그 외 모든 국가
  return stripe.paymentIntents.create({
    amount: toCents(amount, currency),
    currency: currency.toLowerCase(),
    payment_method_types: getMethodsByCountry(country)
  });
}
```
**핵심**: 결제 로직을 추상화하면 토스/Stripe 동시 운영 가능. 한국은 토스 유지.

### 수익화 다각화 — 광고 레이어
```js
// 결제 외 수익: 카드사·리셀러 제휴 광고
// 국가별 표시 광고 우선순위
const ADS = {
  KR: ['현대카드', '삼성카드', '쿠팡파트너스'],
  US: ['Chase', 'Amex', 'B&H Affiliate'],
  JP: ['楽天カード', 'ヨドバシ'],
};

// 분석 결과 페이지 하단에 "이 카드로 추가 X% 절약" 형태로 노출
// CPA(전환당 비용) 모델 — 노출 광고보다 수익률 3-5배
```

---

## Phase 4 — 인프라 확장 경로

### 현재 → 글로벌 마이그레이션 3단계

```
[현재]                    [Phase 2]                 [Phase 3]
db.json                → Supabase (무료 500MB)   → Supabase Pro or PlanetScale
  |                         |                         |
국가 필드만 추가           국가별 테이블 분리          CDN + 엣지 캐싱
  |                         |                         |
Render (단일)           Render (단일)               Vercel Edge Functions
                                                   (국가별 엣지 라우팅)
```

### Supabase 스키마 설계 (이전 시 바로 쓸 수 있도록)

```sql
-- 국가별 데이터 분리 — Row Level Security 활용
CREATE TABLE analyses (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  country     CHAR(2) NOT NULL DEFAULT 'KR',  -- ISO 3166-1 alpha-2
  currency    CHAR(3) NOT NULL DEFAULT 'KRW', -- ISO 4217
  url         TEXT NOT NULL,
  model       TEXT,
  tier        TEXT DEFAULT 'free',
  ip_hash     TEXT,  -- 개인정보: IP는 해시로만 저장
  save_amount INTEGER,
  best_store  TEXT,
  result_json JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 국가 인덱스 (국가별 필터링 성능)
CREATE INDEX idx_analyses_country ON analyses(country, created_at DESC);

CREATE TABLE deals (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  country     CHAR(2) NOT NULL,
  store       TEXT NOT NULL,
  model       TEXT,
  price       INTEGER,
  currency    CHAR(3),
  deal_type   TEXT,  -- 'new' | 'used' | 'refurb' | 'open-box'
  card_name   TEXT,
  save_amount INTEGER,
  source_url  TEXT,
  valid_until DATE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE purchases (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  country     CHAR(2) NOT NULL DEFAULT 'KR',
  email       TEXT,
  tier        TEXT,  -- 'one-time' | 'pro'
  token       TEXT UNIQUE,
  payment_provider TEXT DEFAULT 'toss',  -- 'toss' | 'stripe'
  amount      INTEGER,
  currency    CHAR(3) DEFAULT 'KRW',
  status      TEXT DEFAULT 'pending',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### db.json → Supabase 이전 트리거 기준
| 조건 | 권장 이전 시점 |
|------|--------------|
| 일 분석 건수 > 500건 | Supabase 무료 플랜으로 이전 |
| 동시 접속 > 50명 | Render → Supabase 커넥션 풀 필요 |
| 국가 2개 이상 서비스 | 반드시 이전 (JSON 구조로 다국가 운영 불가) |
| db.json 크기 > 10MB | 즉시 이전 |

---

## 마이그레이션 우선순위 매트릭스

### 지금 당장 (코드 변경 없음)
| 항목 | 작업 | 소요시간 |
|------|------|---------|
| 글로벌 도메인 선점 | macdosa.app 구매 | 10분 |
| `country` 필드 규칙 정의 | URL 패턴 → 국가 매핑 문서화 | 30분 |
| `locales/ko.json` 추출 | 현재 index.html 텍스트 파악 | 1시간 |
| `prompts/` 폴더 구조 생성 | 빈 파일 생성 | 10분 |
| `config/channels.js` KR 작성 | 현재 프롬프트에서 채널 추출 | 1시간 |

### 1주 이내 (최소 코드 변경)
| 항목 | 작업 | 소요시간 |
|------|------|---------|
| URL 기반 country 자동 감지 | server.js 함수 1개 추가 | 2시간 |
| db.json `country` 필드 적용 | writeDB() 시 자동 주입 | 1시간 |
| 프롬프트 KR.js 분리 | server.js에서 파일로 이동 | 2시간 |
| i18n 플레이스홀더 적용 | index.html 텍스트 → `{{KEY}}` | 3시간 |
| `locales/en.json` 초안 | Claude로 번역 | 30분 |

### 1개월 이내 (구조 변경)
| 항목 | 작업 | 우선도 |
|------|------|--------|
| Stripe 결제 통합 | 글로벌 카드 결제 | ★★★ |
| Supabase 이전 | db.json → 실DB | ★★★ |
| US 채널 프롬프트 | B&H/BestBuy/Swappa | ★★☆ |
| JP 채널 프롬프트 | Amazon JP/価格.com | ★★☆ |
| `locales/ja.json` | 일본어 번역 | ★★☆ |

### 3개월 이내 (플랫폼화)
| 항목 | 작업 | 비고 |
|------|------|------|
| 카드사 제휴 광고 API | 국가별 카드 CPA | 수익화 핵심 |
| 커뮤니티 기능 | 딜 제보, 리뷰 | AI 시대 차별점 |
| 가격 알림 자동화 | 목표가 도달 시 이메일/카카오 | 재방문율 3배 |
| 다기기 확장 | MacBook → iPad, iPhone | 시장 확대 |

---

## 글로벌 확장 위험 요소 & 대응

| 위험 | 발생 조건 | 대응 |
|------|-----------|------|
| 국가별 스크래핑 차단 | 각국 쇼핑몰 봇 감지 | Playwright 헤드리스 → 공개 API 우선 전환 |
| Claude API 비용 급증 | 글로벌 사용자 증가 | Haiku로 1차 분석 → 이상 시 Sonnet 재분석 |
| 환율 변동 | USD/JPY 급변 | 결제 시 실시간 환율 API (exchangerate-api.com 무료) |
| GDPR (유럽) | EU 사용자 서비스 | IP 해시화 필수, 쿠키 동의 배너 추가 |
| 일본 개인정보 (APPI) | JP 서비스 | 메일 수집 시 명시적 동의 필요 |

---

## 天地人 요약

```
天 (AI층): 프롬프트 팩토리 → 국가별 채널 전략 자동화
地 (운영층): db.json → Supabase → 국가별 데이터 분리
人 (판단층): 어느 나라 사용자든 "지금 사야 하나?" 하나의 판단 제공
```

**用變不動本**: 채널이 바뀌고, 언어가 바뀌고, 결제가 바뀌어도
"가장 싸게 Mac을 사는 법을 알려준다"는 본은 움직이지 않는다.

---

## 다음 시작 씨앗 (歸一)

**중심 한 문장**: 국가 추가 = 채널 설정 파일 1개 + 프롬프트 파일 1개 + 번역 파일 1개.

**다음 질문**: 미국 시장 첫 진출 시 B&H/Swappa 채널이 충분한가, 아니면 Reddit r/appledeals 커뮤니티 연동이 더 효과적인가?

**다음 실행**: `locales/ko.json` 추출 + `config/channels.js` KR 작성 (2시간, 코드 변경 없음)

---

## ✅ 구현 완료 (2026-04-19)
- locales/ko.json — 한국어 텍스트 키 정의
- config/channels.js — 국가별 검색 채널 설정 (KR/US/JP)
- 다음 단계: server.js에서 getCountryFromRequest() import 후 analyze 프롬프트에 주입

---

*맥도사 글로벌 아키텍처 v1.0 | 2026-04-19 | 천계 프로토콜 v2.0*
