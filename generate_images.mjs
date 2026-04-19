/**
 * 맥도사 캐릭터 이미지 생성기
 * 나노바나나(NanoBanana) Playwright 자동화
 *
 * 실행: node generate_images.mjs
 * 필요: npm install playwright
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dir, 'images');
mkdirSync(OUT, { recursive: true });

// ── 생성할 이미지 목록 ──────────────────────────────────────
const IMAGES = [
  {
    filename: 'macdosa_main.png',
    prompt: `A wise Korean sage (도사) in deep forest green hanbok,
sitting cross-legged and holding a glowing MacBook Pro like a sacred scroll.
Golden symbols 天地人 floating around him.
Art style: epic fantasy character art, dramatic lighting, dark atmospheric background with green magical glow.
Like a hero from a dark fantasy manhwa. Full body shot, cinematic. No text.`,
    ratio: '2:3'
  },
  {
    filename: 'macdosa_action.png',
    prompt: `Dynamic Korean sage warrior in dark green armor,
standing and pointing at a holographic price chart floating in the air.
MacBook Pro glowing at his feet. Demon Hunters manhwa art style,
dramatic cinematic lighting, dark fantasy aesthetic, green energy effects. No text.`,
    ratio: '2:3'
  },
  {
    filename: 'macdosa_warning.png',
    prompt: `Korean sage (도사) raising his hand in a "STOP" gesture,
stern expression, dark green robes, warning against buying old MacBooks.
Speech bubble style but no text. Dark fantasy art, epic lighting.
Demon Hunters aesthetic. Dramatic, authoritative pose.`,
    ratio: '2:3'
  },
  {
    filename: 'macdosa_analyze.png',
    prompt: `Korean sage in meditation pose surrounded by three floating orbs:
gold orb (天 history data), green orb (地 current deals), blue orb (人 timing).
MacBook Pro data streams. Dark fantasy epic art style, magical green atmosphere. No text.`,
    ratio: '2:3'
  },
  {
    filename: 'macdosa_celebrate.png',
    prompt: `Korean sage jumping in celebration, MacBook Pro held high above head,
golden coins raining down, "32만원 절약!" energy effect without text.
Joyful expression, dynamic action pose. Dark fantasy manhwa style with celebration lighting.`,
    ratio: '2:3'
  },
  {
    filename: 'macdosa_bg.png',
    prompt: `Epic dark atmospheric background: ancient Korean mountain temple at night,
green magical energy glowing, 天地人 symbols floating in the sky,
MacBook price charts as constellations. No characters, pure background art.
Cinematic wide shot, fantasy aesthetic.`,
    ratio: '16:9'
  }
];

// ── 나노바나나 웹 자동화 ──────────────────────────────────────
async function generateWithNanoBanana(page, prompt, filename, ratio = '2:3') {
  console.log(`\n🎨 생성 중: ${filename}`);
  console.log(`   프롬프트: ${prompt.slice(0, 60)}...`);

  try {
    // 나노바나나 접속 (로그인 상태 유지 필요)
    await page.goto('https://www.nanobananai.com', { waitUntil: 'networkidle', timeout: 30000 });

    // 프롬프트 입력창 찾기 (실제 셀렉터는 사이트에 맞게 조정)
    const promptSelectors = [
      'textarea[placeholder*="describe"]',
      'textarea[placeholder*="Describe"]',
      'textarea[placeholder*="프롬프트"]',
      'textarea[placeholder*="상상"]',
      'textarea',
      '[contenteditable="true"]'
    ];

    let inputEl = null;
    for (const sel of promptSelectors) {
      inputEl = await page.$(sel);
      if (inputEl) break;
    }

    if (!inputEl) {
      console.error('   ❌ 입력창을 찾지 못했습니다. 스크린샷 저장...');
      await page.screenshot({ path: join(OUT, `debug_${filename}`) });
      return false;
    }

    await inputEl.click({ clickCount: 3 });
    await inputEl.fill(prompt);

    // 비율 설정 (있는 경우)
    const ratioBtn = await page.$(`[data-ratio="${ratio}"], button:has-text("${ratio}")`);
    if (ratioBtn) await ratioBtn.click();

    // 생성 버튼 클릭
    const generateSelectors = [
      'button:has-text("Generate")',
      'button:has-text("생성")',
      'button:has-text("Create")',
      'button[type="submit"]',
      'button.generate',
    ];

    let genBtn = null;
    for (const sel of generateSelectors) {
      genBtn = await page.$(sel);
      if (genBtn) break;
    }

    if (!genBtn) {
      console.error('   ❌ 생성 버튼을 찾지 못했습니다.');
      await page.screenshot({ path: join(OUT, `debug_${filename}`) });
      return false;
    }

    await genBtn.click();
    console.log('   ⏳ 생성 대기 중...');

    // 이미지 생성 완료 대기 (최대 90초)
    await page.waitForFunction(() => {
      const imgs = document.querySelectorAll('img[src*="blob:"], img[src*="generated"], canvas');
      return imgs.length > 0;
    }, { timeout: 90000 });

    await page.waitForTimeout(2000);

    // 생성된 이미지 다운로드
    const imgEl = await page.$('img[src*="blob:"], img[src*="generated"], .result-image img, .generated img');
    if (imgEl) {
      const src = await imgEl.getAttribute('src');

      if (src.startsWith('blob:')) {
        // blob URL → base64 변환 후 저장
        const buffer = await page.evaluate(async (blobUrl) => {
          const res = await fetch(blobUrl);
          const buf = await res.arrayBuffer();
          return Array.from(new Uint8Array(buf));
        }, src);
        writeFileSync(join(OUT, filename), Buffer.from(buffer));
      } else {
        // 일반 URL → fetch
        const res = await page.request.get(src);
        writeFileSync(join(OUT, filename), await res.body());
      }

      console.log(`   ✅ 저장 완료: images/${filename}`);
      return true;
    } else {
      // 전체 스크린샷으로 fallback
      await page.screenshot({ path: join(OUT, filename), fullPage: false });
      console.log(`   ⚠️  이미지 엘리먼트 못 찾음. 스크린샷으로 저장: images/${filename}`);
      return false;
    }

  } catch (err) {
    console.error(`   ❌ 오류: ${err.message}`);
    return false;
  }
}

// ── HTML 자동 업데이트 ──────────────────────────────────────
function updateHTML(generated) {
  const htmlPath = join(__dir, 'index.html');
  const { readFileSync } = await import('fs');
  let html = readFileSync(htmlPath, 'utf-8');

  if (generated.includes('macdosa_main.png')) {
    html = html.replace(
      /<!-- 생성 후: <img src="images\/macdosa_main.png"> -->\s*<div class="char-avatar-ph">🧙‍♂️<\/div>/,
      `<img src="images/macdosa_main.png" alt="맥도사" style="width:100%;height:100%;object-fit:cover">`
    );
    console.log('   📄 index.html 히어로 이미지 업데이트됨');
  }

  writeFileSync(htmlPath, html);
}

// ── 메인 실행 ──────────────────────────────────────────────
async function main() {
  console.log('🚀 맥도사 이미지 생성 시작');
  console.log('━'.repeat(50));
  console.log('⚠️  나노바나나에 로그인된 상태여야 합니다.');
  console.log('   브라우저가 열리면 로그인 후 Enter를 눌러주세요.\n');

  const browser = await chromium.launch({
    headless: false,  // 브라우저 직접 보면서 실행
    slowMo: 500
  });

  const context = await browser.newContext({
    // 쿠키/세션 저장 (로그인 유지)
    storageState: 'nanobannana_session.json'
  });

  const page = await context.newPage();

  // 첫 실행 시 로그인 대기
  await page.goto('https://www.nanobananai.com');
  console.log('📌 브라우저에서 로그인 후 콘솔에서 Enter 눌러주세요...');
  await new Promise(r => process.stdin.once('data', r));

  // 세션 저장
  await context.storageState({ path: 'nanobannana_session.json' });
  console.log('✅ 세션 저장됨 (다음 실행부터 자동 로그인)\n');

  const generated = [];

  for (const img of IMAGES) {
    const success = await generateWithNanoBanana(page, img.prompt, img.filename, img.ratio);
    if (success) generated.push(img.filename);

    // 연속 생성 간격 (rate limit 방지)
    await page.waitForTimeout(3000);
  }

  await browser.close();

  console.log('\n━'.repeat(50));
  console.log(`✅ 완료: ${generated.length}/${IMAGES.length}개 생성`);
  generated.forEach(f => console.log(`   • images/${f}`));

  // HTML 자동 업데이트
  if (generated.length > 0) {
    // updateHTML(generated); // 필요 시 주석 해제
    console.log('\n📄 HTML 적용 방법:');
    console.log('   heroCharAvatar 안의 이모지를 아래로 교체:');
    console.log('   <img src="images/macdosa_main.png" style="width:100%;height:100%;object-fit:cover">');
  }
}

main().catch(console.error);
