#!/bin/bash
# 맥도사 경연 자동 재시작 스크립트
# 매주 금요일 자정(KST) cron 실행용

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_FILE="$SCRIPT_DIR/competition_cron.log"

echo "=== 경연 시작: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG_FILE"

cd "$SCRIPT_DIR"
node runner.js >> "$LOG_FILE" 2>&1

echo "=== 경연 종료: $(date '+%Y-%m-%d %H:%M:%S KST') ===" >> "$LOG_FILE"
