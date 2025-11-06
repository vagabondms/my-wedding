import puppeteer from "puppeteer";
import cron from "node-cron";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

// GitHub Actions 환경이 아닐 때만 .env 파일 로드
const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
if (!isGitHubActions) {
  dotenv.config();
}

const TARGET_URL = "https://wedding.seoulwomen.or.kr/intro";
const EMAIL_RECIPIENTS = ["hiseokseok@gmail.com", "h_____in2@naver.com"];

// Gmail 전송 설정
const createTransporter = () => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    const envHint = isGitHubActions
      ? "GitHub Secrets에 EMAIL_USER와 EMAIL_PASS를 설정해주세요."
      : ".env 파일에 EMAIL_USER와 EMAIL_PASS를 설정해주세요.";
    throw new Error(`이메일 전송을 위해 ${envHint}`);
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

// 웹페이지 크롤링 및 27년 이후 텍스트 검색
async function checkWebsite() {
  let browser;
  try {
    console.log(`[${new Date().toLocaleString("ko-KR")}] 크롤링 시작...`);

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // 페이지 로드 대기
    await page.goto(TARGET_URL, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // 페이지의 모든 텍스트 가져오기
    const pageContent = await page.evaluate(() => {
      return document.body.innerText || document.body.textContent || "";
    });

    // 26년~50년 사이 연도 패턴 검색 (2026~2050 또는 26~50)
    const yearPattern = /(20(2[6-9]|[3-4][0-9]|50)|([2-4][0-9]|50))\s*년/g;
    const matches = pageContent.match(yearPattern);

    if (matches) {
      const uniqueYears = [...new Set(matches)];
      console.log(
        `[${new Date().toLocaleString(
          "ko-KR"
        )}] 발견된 연도: ${uniqueYears.join(", ")}`
      );

      // 2027년 이후 또는 27년 이후만 필터링 (2026년, 26년 제외)
      const yearsAfter2027 = uniqueYears.filter((year) => {
        const yearNum = parseInt(year.replace(/[^0-9]/g, ""));
        // 4자리 연도는 2027 이상, 2자리 연도는 27 이상
        return (
          (yearNum >= 2027 && yearNum <= 2050) ||
          (yearNum >= 27 && yearNum <= 50)
        );
      });

      if (yearsAfter2027.length > 0) {
        await sendEmail(yearsAfter2027, true);
        return true;
      }
    }

    console.log(
      `[${new Date().toLocaleString(
        "ko-KR"
      )}] 27년 이후 연도가 발견되지 않았습니다.`
    );

    // 발견되지 않았을 때도 이메일 전송
    await sendEmail([], false);
    return false;
  } catch (error) {
    console.error(
      `[${new Date().toLocaleString("ko-KR")}] 크롤링 오류:`,
      error
    );
    return false;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// 이메일 전송
async function sendEmail(years, found = true) {
  try {
    const transporter = createTransporter();

    let mailOptions;

    if (found && years.length > 0) {
      // 발견된 경우
      mailOptions = {
        from: process.env.EMAIL_USER,
        to: EMAIL_RECIPIENTS.join(", "),
        subject: `🎉 마이웨딩 웨딩홀 일정 상태 확인 - 27년 이후 일정 공개!`,
        text: `
📊 마이웨딩 웨딩홀 일정 상태 확인

🎉 27년 이후 일정 정보가 공개되었습니다!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

발견된 연도: ${years.join(", ")}

확인 시간: ${new Date().toLocaleString("ko-KR")}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 크롤러가 27년 이후 일정을 발견했습니다!
즉시 예약 페이지를 확인해주세요.

🔗 확인하기: ${TARGET_URL}

        `,
      };
    } else {
      // 발견되지 않은 경우
      mailOptions = {
        from: process.env.EMAIL_USER,
        to: EMAIL_RECIPIENTS.join(", "),
        subject: `마이웨딩 웨딩홀 일정 상태 확인 - 27년 이후 미공개`,
        text: `
📊 마이웨딩 웨딩홀 일정 상태 확인

ℹ️  아직 27년 이후 일정 정보가 공개되지 않았습니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

현재 상태: 26년까지만 일정이 공개되어 있습니다.

확인 시간: ${new Date().toLocaleString("ko-KR")}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 크롤러는 정상 작동 중입니다. 일정이 공개되면 즉시 알림을 보내드리겠습니다.

🔗 확인하기: ${TARGET_URL}

        `,
      };
    }

    await transporter.sendMail(mailOptions);
    console.log(
      `[${new Date().toLocaleString(
        "ko-KR"
      )}] 이메일 전송 완료: ${EMAIL_RECIPIENTS.join(", ")}`
    );
  } catch (error) {
    console.error(
      `[${new Date().toLocaleString("ko-KR")}] 이메일 전송 오류:`,
      error.message
    );
    if (error.message.includes("이메일 전송을 위해")) {
      console.error("\n" + "=".repeat(60));
      console.error("⚠️  Gmail 계정 설정이 필요합니다!");
      console.error("=".repeat(60));

      if (isGitHubActions) {
        console.error("\nGitHub Secrets에 다음을 설정하세요:");
        console.error("  EMAIL_USER: your-email@gmail.com");
        console.error("  EMAIL_PASS: your-app-password");
        console.error("\n설정 방법:");
        console.error(
          "  1. GitHub 저장소 → Settings → Secrets and variables → Actions"
        );
        console.error("  2. New repository secret 클릭");
        console.error("  3. 위의 두 개의 Secret 추가");
      } else {
        console.error("\n.env 파일을 생성하고 다음을 추가하세요:");
        console.error("  EMAIL_USER=your-email@gmail.com");
        console.error("  EMAIL_PASS=your-app-password");
      }

      console.error("\nGmail 앱 비밀번호 생성 방법:");
      console.error("  1. Google 계정 관리 페이지 접속");
      console.error("  2. 보안 설정으로 이동");
      console.error("  3. 2단계 인증 활성화 (필수)");
      console.error("  4. 앱 비밀번호 생성");
      console.error("  5. 생성된 비밀번호를 설정에 입력");
      console.error("=".repeat(60) + "\n");
    }
  }
}

if (isGitHubActions) {
  // GitHub Actions 환경: 한 번만 실행하고 종료
  console.log("GitHub Actions 환경에서 실행 중...");
  console.log("서울여성가족재단 예식장 체커를 실행합니다.");
  await checkWebsite();
  process.exit(0);
} else {
  // 로컬 환경: cron 스케줄러 사용
  // 스케줄러 설정 (매일 오전 9시 실행)
  // cron 표현식: '0 9 * * *' = 매일 오전 9시 0분
  cron.schedule(
    "0 9 * * *",
    async () => {
      console.log(`[${new Date().toLocaleString("ko-KR")}] 스케줄된 작업 시작`);
      await checkWebsite();
    },
    {
      timezone: "Asia/Seoul",
    }
  );

  // 시작 시 한 번 실행 (테스트용)
  console.log("서울여성가족재단 예식장 체커가 시작되었습니다.");
  console.log("매일 오전 9시에 자동으로 확인합니다.");
  console.log("테스트를 위해 지금 한 번 실행합니다...");

  await checkWebsite();

  // 프로세스가 종료되지 않도록 유지
  process.on("SIGINT", () => {
    console.log("\n프로그램을 종료합니다...");
    process.exit(0);
  });
}
