import puppeteer from "puppeteer";
import cron from "node-cron";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

// GitHub Actions 환경이 아닐 때만 .env 파일 로드
const isGitHubActions = process.env.GITHUB_ACTIONS === "true";
if (!isGitHubActions) {
  dotenv.config();
}

const BASE_URL = "https://wedding.seoulwomen.or.kr";
const INTRO_URL = `${BASE_URL}/intro`;
const FACILITIES_BASE_URL = `${BASE_URL}/facilities/page`;
const EMAIL_RECIPIENTS = ["hiseokseok@gmail.com", "h_____in2@naver.com"];

// 한국 시간대(Asia/Seoul)로 시간 포맷팅
const getKoreanTime = () => {
  return new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
};

// 연도를 4자리 형식으로 통일 (예: "26년" -> "2026년", "2026년" -> "2026년")
const normalizeYear = (yearString) => {
  const yearNum = parseInt(yearString.replace(/[^0-9]/g, ""));
  if (yearNum >= 0 && yearNum <= 99) {
    // 2자리 연도는 2000을 더해서 4자리로 변환
    return `${2000 + yearNum}년`;
  } else {
    // 이미 4자리 연도면 그대로 반환
    return `${yearNum}년`;
  }
};

// 연도 배열을 4자리로 통일하고 정렬
const normalizeYears = (years) => {
  return [...new Set(years.map(normalizeYear))].sort((a, b) => {
    const aNum = parseInt(a.replace(/[^0-9]/g, ""));
    const bNum = parseInt(b.replace(/[^0-9]/g, ""));
    return aNum - bNum;
  });
};

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

// 단일 페이지 크롤링 및 27~29년 텍스트 검색
async function checkPage(page, url, pageName = "") {
  try {
    console.log(
      `[${getKoreanTime()}] 크롤링 중: ${url} ${
        pageName ? `(${pageName})` : ""
      }`
    );

    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // 페이지의 모든 텍스트 가져오기
    const pageContent = await page.evaluate(() => {
      return document.body.innerText || document.body.textContent || "";
    });

    // 빈 페이지 감지: 여러 패턴으로 확인 (404 페이지)
    const emptyPagePatterns = [
      "페이지를 찾을수 없습니다", // 공백 없는 버전 (실제 사이트)
      "페이지를 찾을 수 없습니다", // 공백 있는 버전
      "페이지를 찾을수 없습니다.", // 마침표 포함
      "페이지를 찾을 수 없습니다.", // 마침표 포함
      "요청하신 페이지가 사라졌거나", // 추가 확인용
      "404 not found", // 영어 버전
    ];

    const isEmptyPage = emptyPagePatterns.some((pattern) =>
      pageContent.includes(pattern)
    );

    if (isEmptyPage) {
      return {
        url,
        pageName,
        allYears: [],
        yearsAfter2027: [],
        facilityNames: [],
        hasContent: false,
      };
    }

    // 26년~50년 사이 연도 패턴 검색 (2026~2050 또는 26~50)
    const yearPattern = /(20(2[6-9]|[3-4][0-9]|50)|([2-4][0-9]|50))\s*년/g;
    const matches = pageContent.match(yearPattern);

    // Facilities 페이지인 경우 결혼식장 이름 추출 (27~29년 연도가 있는 카드만)
    let facilityNames = [];
    if (url.includes("/facilities/page/")) {
      facilityNames = await page.evaluate(() => {
        const facilities = [];
        // 27~29년 연도 패턴만 검색 (2027~2029 또는 27~29)
        // 2자리: 27-29
        // 4자리: 2027-2029
        const yearPattern = /(20(2[7-9])|(2[7-9]))\s*년/g;

        // 모든 li 요소 확인 (결혼식장 카드)
        const cards = document.querySelectorAll("li");

        cards.forEach((card) => {
          const text = card.innerText || card.textContent || "";

          // 27~29년 연도 패턴이 포함되어 있는지 확인
          if (yearPattern.test(text)) {
            // 결혼식장 이름 추출 시도
            // 방법 1: 이미지 alt 속성에서 추출
            const img = card.querySelector("img");
            if (img && img.alt) {
              facilities.push(img.alt.trim());
              return;
            }

            // 방법 2: 텍스트에서 추출 (자치구 다음 줄이 결혼식장 이름)
            const lines = text
              .split("\n")
              .map((l) => l.trim())
              .filter((l) => l.length > 0);
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              // 자치구 패턴 (예: "강남구", "광진구" 등으로 끝남)
              if (/구$/.test(line) && i + 1 < lines.length) {
                const nextLine = lines[i + 1];
                // 다음 줄이 결혼식장 이름일 가능성 (공원, 홀, 관, 청사 등 포함)
                if (
                  nextLine &&
                  nextLine.length > 2 &&
                  !nextLine.includes("야외") &&
                  !nextLine.includes("실내") &&
                  !nextLine.includes("명") &&
                  !nextLine.includes("무료") &&
                  !nextLine.includes("가능")
                ) {
                  facilities.push(nextLine);
                  break;
                }
              }
            }
          }
        });

        return [...new Set(facilities)]; // 중복 제거
      });
    }

    if (matches) {
      const uniqueYears = [...new Set(matches)];
      console.log(
        `[${getKoreanTime()}] ${
          pageName || url
        }에서 발견된 연도: ${uniqueYears.join(", ")}`
      );

      // 27~29년만 필터링 (2027~2029 또는 27~29)
      const filteredYears = uniqueYears.filter((year) => {
        const yearNum = parseInt(year.replace(/[^0-9]/g, ""));
        // 4자리 연도는 2027~2029만, 2자리 연도는 27~29만
        return (
          (yearNum >= 2027 && yearNum <= 2029) ||
          (yearNum >= 27 && yearNum <= 29)
        );
      });

      // 필터링된 연도를 4자리로 통일
      const yearsAfter2027 = normalizeYears(filteredYears);

      return {
        url,
        pageName,
        allYears: uniqueYears,
        yearsAfter2027,
        facilityNames: facilityNames,
        hasContent: true,
      };
    }

    return {
      url,
      pageName,
      allYears: [],
      yearsAfter2027: [],
      facilityNames: [],
      hasContent: true,
    };
  } catch (error) {
    // 페이지가 없거나 오류가 발생한 경우
    if (
      error.message.includes("net::ERR_FAILED") ||
      error.message.includes("Navigation failed") ||
      error.message.includes("timeout")
    ) {
      return {
        url,
        pageName,
        allYears: [],
        yearsAfter2027: [],
        facilityNames: [],
        hasContent: false,
      };
    }
    throw error;
  }
}

// 모든 페이지 크롤링 및 27~29년 텍스트 검색
async function checkWebsite() {
  let browser;
  try {
    console.log(`[${getKoreanTime()}] 크롤링 시작...`);

    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    const allResults = [];

    // 1. Intro 페이지 크롤링 (공지사항)
    console.log("\n" + "=".repeat(60));
    console.log(`[${getKoreanTime()}] 공지사항 페이지 크롤링 시작...`);
    console.log("=".repeat(60));
    const introResult = await checkPage(page, INTRO_URL, "공지사항");
    allResults.push(introResult);

    // Intro 페이지에서 27~29년이 발견되었는지 확인
    const hasTargetYears = introResult.yearsAfter2027.length > 0;

    if (hasTargetYears) {
      console.log(
        `[${getKoreanTime()}] ✅ 공지사항에서 27~29년 연도 발견: ${introResult.yearsAfter2027.join(
          ", "
        )}`
      );
    } else {
      console.log(
        `[${getKoreanTime()}] 공지사항에서 27~29년 연도가 발견되지 않아 Facilities 크롤링을 건너뜁니다.`
      );
    }

    // 페이지 간 짧은 대기 시간 (서버 부하 방지)
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // 2. Facilities 페이지들 크롤링 (Intro에서 27~29년이 발견된 경우에만 실행)
    if (hasTargetYears) {
      console.log("\n" + "=".repeat(60));
      console.log(`[${getKoreanTime()}] 시설 정보 페이지 크롤링 시작...`);
      console.log("=".repeat(60));

      let pageNumber = 1;

      while (true) {
        const url = `${FACILITIES_BASE_URL}/${pageNumber}`;
        const result = await checkPage(
          page,
          url,
          `시설 정보 페이지 ${pageNumber}`
        );

        if (!result.hasContent) {
          // 첫 번째 없는 페이지가 나오면 즉시 중단
          console.log(
            `[${getKoreanTime()}] 시설 정보 페이지 ${pageNumber}는 존재하지 않습니다. 크롤링을 종료합니다.`
          );
          break;
        }

        allResults.push(result);

        // 27~29년 연도가 발견된 페이지 출력
        if (result.yearsAfter2027.length > 0) {
          console.log(
            `[${getKoreanTime()}] ✅ 시설 정보 페이지 ${pageNumber}에서 27~29년 연도 발견: ${result.yearsAfter2027.join(
              ", "
            )}`
          );
        } else {
          // 연도가 없는 첫 번째 페이지에서 중단 (페이지는 존재하지만 27~29년 연도가 없음)
          console.log(
            `[${getKoreanTime()}] 시설 정보 페이지 ${pageNumber}에는 27~29년 연도가 없습니다. 크롤링을 종료합니다.`
          );
          break;
        }

        pageNumber++;

        // 페이지 간 짧은 대기 시간 (서버 부하 방지)
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // 결과 요약
    const allYearsAfter2027 = [];
    const pagesWith27Years = [];
    const introYears = []; // 공지사항에서 발견된 연도
    const facilitiesWithYears = []; // 시설 정보 페이지에서 발견된 결혼식장들

    allResults.forEach((result) => {
      if (result.yearsAfter2027.length > 0) {
        allYearsAfter2027.push(...result.yearsAfter2027);

        if (result.pageName === "공지사항") {
          // 공지사항에서 발견된 연도
          introYears.push(...result.yearsAfter2027);
        } else if (result.pageName.includes("시설 정보")) {
          // 시설 정보 페이지에서 발견된 결혼식장들
          pagesWith27Years.push(result.pageName || result.url);
          if (result.facilityNames && result.facilityNames.length > 0) {
            // 페이지 번호 추출 (예: "시설 정보 페이지 1" -> 1)
            const pageNumberMatch = result.pageName.match(/(\d+)/);
            const pageNumber = pageNumberMatch
              ? parseInt(pageNumberMatch[1])
              : null;

            facilitiesWithYears.push({
              page: result.pageName,
              pageNumber: pageNumber,
              facilities: result.facilityNames,
              years: result.yearsAfter2027,
            });
          }
        }
      }
    });

    const uniqueYearsAfter2027 = normalizeYears(allYearsAfter2027);

    console.log("\n" + "=".repeat(60));
    console.log(`[${getKoreanTime()}] 크롤링 완료!`);
    console.log(`총 확인한 페이지 수: ${allResults.length}개`);
    if (introYears.length > 0) {
      const normalizedIntroYears = normalizeYears(introYears);
      console.log(
        `✅ 공지사항에서 발견된 연도: ${normalizedIntroYears.join(", ")}`
      );
    }
    if (facilitiesWithYears.length > 0) {
      const normalizedFacilitiesYears = normalizeYears(
        uniqueYearsAfter2027.filter((y) => !introYears.includes(y))
      );
      console.log(
        `✅ 시설 정보 페이지에서 발견된 연도: ${
          normalizedFacilitiesYears.length > 0
            ? normalizedFacilitiesYears.join(", ")
            : "없음"
        }`
      );
      facilitiesWithYears.forEach((facility) => {
        console.log(`  - ${facility.page}: ${facility.facilities.join(", ")}`);
      });
    }
    console.log(
      `발견된 연도: ${
        uniqueYearsAfter2027.length > 0
          ? uniqueYearsAfter2027.join(", ")
          : "없음"
      }`
    );
    console.log("=".repeat(60) + "\n");

    if (uniqueYearsAfter2027.length > 0) {
      const normalizedIntroYears =
        introYears.length > 0 ? normalizeYears(introYears) : [];
      await sendEmail(
        uniqueYearsAfter2027,
        true,
        normalizedIntroYears,
        facilitiesWithYears,
        allResults.length
      );
      return true;
    }

    console.log(`[${getKoreanTime()}] 27~29년 연도가 발견되지 않았습니다.`);

    // 발견되지 않았을 때도 이메일 전송
    await sendEmail([], false, [], [], allResults.length);
    return false;
  } catch (error) {
    console.error(`[${getKoreanTime()}] 크롤링 오류:`, error);
    return false;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// 이메일 전송
async function sendEmail(
  years,
  found = true,
  introYears = [],
  facilitiesWithYears = [],
  totalPages = 0
) {
  try {
    const transporter = createTransporter();

    let mailOptions;

    if (found && years.length > 0) {
      // 발견된 경우
      const normalizedYears = normalizeYears(years);

      // HTML 이메일 본문 생성
      let htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .header { background-color: #f4f4f4; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
    .section { margin: 20px 0; }
    table { border-collapse: collapse; width: 100%; margin: 20px 0; }
    th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
    th { background-color: #4CAF50; color: white; font-weight: bold; }
    tr:nth-child(even) { background-color: #f2f2f2; }
    tr:hover { background-color: #e8f5e9; }
    .info { background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 10px 0; }
    .link { color: #1976d2; text-decoration: none; }
  </style>
</head>
<body>
  <div class="header">
    <h2>📊 마이웨딩 웨딩홀 일정 상태 확인</h2>
    <h3>🎉 27~29년 일정 정보가 공개되었습니다!</h3>
  </div>

  <div class="section">
    <p><strong>발견된 연도:</strong> ${normalizedYears.join(", ")}</p>
  </div>`;

      // 공지사항에서 발견된 경우
      if (introYears.length > 0) {
        const normalizedIntroYears = normalizeYears(introYears);
        htmlBody += `
  <div class="info">
    <p><strong>✅ 공지사항에서 발견된 연도:</strong> ${normalizedIntroYears.join(
      ", "
    )}</p>
  </div>`;
      }

      // 시설 정보 페이지에서 발견된 결혼식장들
      if (facilitiesWithYears.length > 0) {
        htmlBody += `
  <div class="section">
    <h3>✅ 시설 정보에서 발견된 결혼식장:</h3>
    <table>
      <thead>
        <tr>
          <th>이름</th>
          <th>연도</th>
          <th>페이지</th>
        </tr>
      </thead>
      <tbody>`;

        facilitiesWithYears.forEach((facility) => {
          const normalizedFacilityYears = normalizeYears(facility.years);
          facility.facilities.forEach((facilityName) => {
            const pageNum =
              facility.pageNumber !== null ? facility.pageNumber : "";
            const yearsList = normalizedFacilityYears.join(", ");
            htmlBody += `
        <tr>
          <td>${facilityName}</td>
          <td>${yearsList}</td>
          <td>${pageNum}</td>
        </tr>`;
          });
        });

        htmlBody += `
      </tbody>
    </table>
  </div>`;
      }

      htmlBody += `
  <div class="info">
    <p><strong>총 확인한 페이지 수:</strong> ${totalPages}개</p>
    <p><strong>확인 시간:</strong> ${getKoreanTime()}</p>
  </div>

  <div class="section">
    <p><strong>✅ 크롤러가 27~29년 일정을 발견했습니다!</strong></p>
    <p>즉시 예약 페이지를 확인해주세요.</p>
    <p><a href="${INTRO_URL}" class="link">🔗 확인하기: ${INTRO_URL}</a></p>
  </div>
</body>
</html>`;

      // 텍스트 버전도 생성 (HTML을 지원하지 않는 이메일 클라이언트용)
      let textBody = `
📊 마이웨딩 웨딩홀 일정 상태 확인

🎉 27~29년 일정 정보가 공개되었습니다!

발견된 연도: ${normalizedYears.join(", ")}

`;

      if (introYears.length > 0) {
        const normalizedIntroYears = normalizeYears(introYears);
        textBody += `✅ 공지사항에서 발견된 연도: ${normalizedIntroYears.join(
          ", "
        )}

`;
      }

      if (facilitiesWithYears.length > 0) {
        textBody += `✅ 시설 정보에서 발견된 결혼식장:

이름 | 연도 | 페이지
${"-".repeat(50)}
`;
        facilitiesWithYears.forEach((facility) => {
          const normalizedFacilityYears = normalizeYears(facility.years);
          facility.facilities.forEach((facilityName) => {
            const pageNum =
              facility.pageNumber !== null ? facility.pageNumber : "";
            const yearsList = normalizedFacilityYears.join(", ");
            textBody += `${facilityName} | ${yearsList} | ${pageNum}
`;
          });
        });
      }

      textBody += `
총 확인한 페이지 수: ${totalPages}개
확인 시간: ${getKoreanTime()}

✅ 크롤러가 27~29년 일정을 발견했습니다!
즉시 예약 페이지를 확인해주세요.

🔗 확인하기: ${INTRO_URL}
`;

      mailOptions = {
        from: process.env.EMAIL_USER,
        to: EMAIL_RECIPIENTS.join(", "),
        subject: `🎉 마이웨딩 웨딩홀 일정 상태 확인 - 27~29년 일정 공개!`,
        html: htmlBody,
        text: textBody,
      };
    } else {
      // 발견되지 않은 경우
      mailOptions = {
        from: process.env.EMAIL_USER,
        to: EMAIL_RECIPIENTS.join(", "),
        subject: `마이웨딩 웨딩홀 일정 상태 확인 - 27~29년 미공개`,
        text: `
📊 마이웨딩 웨딩홀 일정 상태 확인

ℹ️  아직 27~29년 일정 정보가 공개되지 않았습니다.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

현재 상태: 26년까지만 일정이 공개되어 있습니다.

총 확인한 페이지 수: ${totalPages}개

확인 시간: ${getKoreanTime()}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 크롤러는 정상 작동 중입니다. 일정이 공개되면 즉시 알림을 보내드리겠습니다.

🔗 확인하기: ${INTRO_URL}

        `,
      };
    }

    await transporter.sendMail(mailOptions);
    console.log(
      `[${getKoreanTime()}] 이메일 전송 완료: ${EMAIL_RECIPIENTS.join(", ")}`
    );
  } catch (error) {
    console.error(`[${getKoreanTime()}] 이메일 전송 오류:`, error.message);
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
  // 스케줄러 설정 (매일 오전 8시 실행)
  cron.schedule(
    "0 8 * * *",
    async () => {
      console.log(`[${getKoreanTime()}] 스케줄된 작업 시작 (오전 8시)`);
      await checkWebsite();
    },
    {
      timezone: "Asia/Seoul",
    }
  );

  // 스케줄러 설정 (매일 정오 12시 실행)
  cron.schedule(
    "0 12 * * *",
    async () => {
      console.log(`[${getKoreanTime()}] 스케줄된 작업 시작 (정오 12시)`);
      await checkWebsite();
    },
    {
      timezone: "Asia/Seoul",
    }
  );

  // 스케줄러 설정 (매일 오후 4시 실행)
  cron.schedule(
    "0 16 * * *",
    async () => {
      console.log(`[${getKoreanTime()}] 스케줄된 작업 시작 (오후 4시)`);
      await checkWebsite();
    },
    {
      timezone: "Asia/Seoul",
    }
  );

  // 스케줄러 설정 (매일 오후 8시 실행)
  cron.schedule(
    "0 20 * * *",
    async () => {
      console.log(`[${getKoreanTime()}] 스케줄된 작업 시작 (오후 8시)`);
      await checkWebsite();
    },
    {
      timezone: "Asia/Seoul",
    }
  );

  // 스케줄러 설정 (매일 자정 12시 실행)
  cron.schedule(
    "0 0 * * *",
    async () => {
      console.log(`[${getKoreanTime()}] 스케줄된 작업 시작 (자정 12시)`);
      await checkWebsite();
    },
    {
      timezone: "Asia/Seoul",
    }
  );

  // 시작 시 한 번 실행 (테스트용)
  console.log("서울여성가족재단 예식장 체커가 시작되었습니다.");
  console.log(
    "매일 오전 8시, 정오 12시, 오후 4시, 오후 8시, 자정 12시에 자동으로 확인합니다."
  );
  console.log("테스트를 위해 지금 한 번 실행합니다...");

  await checkWebsite();

  // 프로세스가 종료되지 않도록 유지
  process.on("SIGINT", () => {
    console.log("\n프로그램을 종료합니다...");
    process.exit(0);
  });
}
