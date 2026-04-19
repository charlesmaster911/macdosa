/**
 * 맥도사 경연 자동 러너
 * 크레딧 소진 시 에러 메시지에서 남은 시간 파싱 → 대기 → 자동 재시작
 */

import { main, readDB, writeDB, log, TOTAL_ROUNDS, parseRateLimit } from './competition.js';
import { appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(__dir, 'brain_evolution.log');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatMs(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h}시간 ${m}분 ${s}초`;
}

function printBrainSummary(roundSummary) {
  const db = readDB();
  const intel = db.brain_intel || [];

  console.log('\n' + '═'.repeat(60));
  console.log('📊 브레인 저장 결과 요약');
  console.log('═'.repeat(60));

  for (const r of roundSummary) {
    console.log(`\n라운드 ${r.roundNum} | ${r.product}`);
    console.log(`  🏆 우승: ${r.winner}(${r.winResult.bestStore}) → ${Math.round(r.winResult.finalPrice/10000)}만원`);
    console.log(`  딜유형: ${r.winResult.bestDealType}`);
    console.log(`  인사이트: ${r.winResult.keyInsight}`);

    // 3팀 비교
    for (const [k, v] of Object.entries(r.results)) {
      if (v && !v.__rateLimit) {
        const mark = k === r.winner ? '★' : '  ';
        console.log(`  ${mark} ${k}: ${v.bestStore} ${Math.round(v.finalPrice/10000)}만원`);
      }
    }
  }

  console.log('\n' + '─'.repeat(60));
  console.log(`✅ db.brain_intel 총 누적: ${intel.length}건`);
  if (db.champion) {
    console.log(`🥇 현재 챔피언: ${db.champion.name} (${db.champion.totalWins}/${TOTAL_ROUNDS}라운드)`);
  }
  console.log('─'.repeat(60));
}

async function run() {
  let attempt = 0;

  while (true) {
    attempt++;
    const db = readDB();
    const startFrom = (db.progress?.lastCompletedRound || 0) + 1;

    if (startFrom > TOTAL_ROUNDS) {
      console.log('\n✅ 모든 라운드 완료! 새 경연을 시작하려면 db.json의 progress를 초기화하세요.');
      break;
    }

    console.log(`\n🚀 경연 시도 ${attempt}회차 — 라운드 ${startFrom}부터 시작`);

    const result = await main(startFrom);

    if (!result.interrupted) {
      // 완료
      printBrainSummary(result.roundSummary);
      break;
    }

    // 크레딧 소진 처리
    const waitMs = result.waitMs;
    const raw = result.raw || '';

    if (!waitMs) {
      // 시간 파싱 실패 시 기본 4시간 대기
      const defaultWait = 4 * 60 * 60 * 1000;
      const resumeTime = new Date(Date.now() + defaultWait).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      console.log(`\n⚠️  크레딧 소진 — 남은 시간 파싱 실패`);
      console.log(`📌 기본 4시간 대기 후 재시작`);
      console.log(`⏰ 재시작 예정: ${resumeTime}`);
      const line = `[${new Date().toISOString().slice(0,19)}] ⚠ 크레딧 소진 (시간 파싱 실패) — ${resumeTime} 재시작 예정`;
      appendFileSync(LOG_PATH, line + '\n');
      await sleep(defaultWait);
    } else {
      const resumeTime = new Date(Date.now() + waitMs).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      console.log(`\n⚠️  크레딧 소진`);
      console.log(`⏳ 남은 대기시간: ${formatMs(waitMs)}`);
      console.log(`⏰ 재시작 예정: ${resumeTime} (Korea)`);
      console.log(`📝 에러 원문: ${raw.slice(0, 200)}`);
      const line = `[${new Date().toISOString().slice(0,19)}] ⚠ 크레딧 소진 — 대기 ${formatMs(waitMs)} — ${resumeTime} 재시작 예정`;
      appendFileSync(LOG_PATH, line + '\n');
      await sleep(waitMs + 60000); // 여유 1분 추가
    }

    console.log(`\n🔄 재시작합니다...`);
  }
}

run().catch(err => {
  console.error('Runner 오류:', err);
  process.exit(1);
});
