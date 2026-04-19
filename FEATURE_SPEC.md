# 맥도사 구독별 기능 구현 기획서
> 2026-04-18 | T2 기획

---

## 1. 전체 아키텍처

```
[사용자] → [index.html] → [api.macdosa.kr] → [Claude API + 스크래퍼]
                                ↓
                        [Supabase DB]
                        - users
                        - subscriptions
                        - analyses
                        - price_alerts
                        - card_discounts
```

**스택**
| 레이어 | 기술 |
|--------|------|
| Frontend | 현재 index.html + result.html (새 페이지) |
| Backend | Node.js + Express (Render 배포) |
| DB | Supabase (PostgreSQL + Auth + Realtime) |
| 결제 | 토스페이먼츠 (한국 표준) |
| AI 분석 | Claude API (claude-sonnet-4-6) |
| 스크래핑 | Playwright (이미 deps에 있음) |
| 알림 | 카카오 비즈메시지 or Resend(이메일) |

---

## 2. 구독별 기능 매핑

### FREE (0원 · 베타)
| 기능 | 구현 방법 | 난이도 |
|------|-----------|--------|
| URL 1회 무료 분석 | IP + 이메일로 usage 카운트 (Supabase) | ★★☆ |
| 天地人 요약 결과 | Claude API로 분석 텍스트 생성 | ★★★ |
| 절약 가능 금액 확인 | 최저가 - 현재가 계산해서 표시 | ★☆☆ |
| 구매 경로 **블러** | CSS blur + overlay (이미 구현됨) | ✅ 완료 |

**제한 로직**
```js
// Supabase: analyses 테이블
{ user_ip, email, url, tier: 'free', created_at }
// 조회: 같은 IP에서 분석 횟수 >= 1이면 결제 유도
```

---

### ONE-TIME (9,900원 · 건별)
| 기능 | 구현 방법 | 난이도 |
|------|-----------|--------|
| 구매 경로 전체 공개 | 블러 해제 + 실제 URL 표시 | ★☆☆ |
| 카드 조합 상세 안내 | card_discounts DB 테이블 조회 | ★★☆ |
| 세금계산서 가이드 | 정적 콘텐츠 + PDF 생성 | ★☆☆ |
| 부가세 환급 계산기 | 공급가 × 10% 계산 UI | ★☆☆ |

**카드 조합 DB 구조**
```sql
CREATE TABLE card_discounts (
  id uuid PRIMARY KEY,
  card_name TEXT,          -- '하나카드 원큐'
  discount_type TEXT,      -- 'cashback' | 'discount' | 'installment'
  discount_rate DECIMAL,   -- 0.05 = 5%
  max_discount INT,        -- 최대 할인 금액
  condition TEXT,          -- '30만원 이상'
  valid_until DATE,
  stores TEXT[]            -- ['롯데하이마트', '쿠팡']
);
```

**결제 플로우**
```
사용자 클릭 → 토스페이먼츠 결제창 → webhook → 
Supabase purchases 테이블 insert → 
analysis_id에 tier='one-time' 업데이트 → 
블러 해제 응답
```

---

### PRO 월간 (19,900원/월)
| 기능 | 구현 방법 | 난이도 |
|------|-----------|--------|
| 무제한 분석 | subscription 테이블 active 체크 | ★☆☆ |
| 가격 하락 실시간 알림 | 크론잡 스크래핑 → 가격 변동 감지 → 알림 | ★★★ |
| 원데이딜 선점 알림 | 하이마트/쿠팡 원데이딜 모니터링 | ★★★ |
| 전문가 상담 | 카카오채널 or Calendly 연동 | ★★☆ |

**가격 알림 시스템**
```
[Render Cron - 1시간마다]
  └→ Playwright로 다나와/쿠팡 가격 스크래핑
  └→ price_history 테이블에 저장
  └→ 사용자 알림 기준가 대비 하락 시
      └→ 카카오 비즈메시지 or 이메일 발송
```

**알림 DB 구조**
```sql
CREATE TABLE price_alerts (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users,
  macbook_model TEXT,      -- 'MacBook Pro 14 M4 24GB'
  target_price INT,        -- 사용자가 설정한 목표 가격
  current_price INT,
  last_checked_at TIMESTAMPTZ,
  notified_at TIMESTAMPTZ  -- 마지막 알림 발송 시각
);
```

**원데이딜 모니터링**
```
[Render Cron - 30분마다]
  └→ 롯데하이마트 원데이딜 페이지 스크래핑
  └→ MacBook 관련 딜 감지
  └→ Pro 구독자 전원에게 즉시 알림
```

---

### PRO 연간 (99,000원/년)
- PRO 월간 모든 기능 동일
- 결제: 연간 일괄 결제 (토스페이먼츠 정기결제)
- 구독 테이블에 `billing_cycle: 'annual'` 구분

---

## 3. 구현 순서 (우선순위)

### Phase 1 — MVP (2주) ← 지금 당장 해야 할 것
1. **결제 연동** — 토스페이먼츠 테스트 키로 ONE-TIME 9,900원 결제
2. **분석 엔진** — URL 입력 → Claude API → 天地人 분석 결과 페이지
3. **블러 해제** — 결제 완료 시 purchase_token 발급 → 블러 해제
4. **Supabase 세팅** — users, analyses, purchases 3개 테이블

### Phase 2 — 구독 (2주)
5. **Pro 구독** — 토스페이먼츠 정기결제 API
6. **카드 조합 DB** — 주요 카드사 10개 데이터 수동 입력
7. **부가세 계산기** — 프론트 계산 UI

### Phase 3 — 알림 (3주)
8. **가격 추적 크론** — Playwright 스크래퍼
9. **알림 발송** — 이메일(Resend) 먼저, 이후 카카오
10. **원데이딜 모니터링** — 롯데하이마트 전용 스크래퍼

---

## 4. 결제 흐름 (토스페이먼츠)

```
ONE-TIME:
사용자 → 결제창 → 성공 → /api/payment/confirm → 
DB 저장 → purchase_token(JWT) 발급 → 
프론트 localStorage 저장 → 블러 해제

PRO 구독:
사용자 → 빌링키 발급 → 정기결제 등록 → 
매월/매년 자동 결제 → webhook → 구독 갱신
```

---

## 5. 분석 결과 페이지 구조

```
[result.html]
├── 分析 요약 카드 (天地人)
│   ├── 天: 30일 가격 히스토리 차트
│   ├── 地: 지금 이 모델 최저가 TOP3
│   └── 人: "지금 사세요 / 2주 기다리세요" 판단
├── 절약 금액 강조 ("32만원 절약 가능")
├── 구매 경로 (FREE: 블러, 결제 후: 해제)
│   ├── 🏆 최저가 경로 (blur)
│   ├── 카드 조합 (blur)
│   └── 부가세 환급 시 실질가 (blur)
└── 잠금 해제 CTA → 결제 모달
```

---

## 6. 비용 추정 (월)

| 항목 | 비용 |
|------|------|
| Render (백엔드) | $7/월 |
| Supabase (DB) | 무료 (500MB) |
| Claude API (분석) | 분석 1회당 약 50원 → 100건 = 5,000원 |
| 토스페이먼츠 | 거래액의 3.3% |
| Resend (이메일) | 무료 (3,000건/월) |
| **합계** | **~12,000원 + 결제 수수료** |

---

## 7. 지금 바로 시작할 것

1. `result.html` — 분석 결과 페이지 (블러 포함)
2. `server.js` — Express API 서버 (분석 엔드포인트)
3. `schema.sql` — Supabase 테이블 생성
4. 토스페이먼츠 테스트 결제 연동
