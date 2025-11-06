# Wedding Checker

서울여성가족재단 예식장 예약 페이지를 매일 5회(오전 8시, 정오 12시, 오후 4시, 오후 8시, 자정 12시) 확인하고, 26년 이후 연도가 발견되면 **macOS 시스템 알림**과 **로그 파일**로 알림을 보내는 서비스입니다.

**외부 서비스 불필요!** 완전히 로컬에서만 동작합니다. 🎉

## 설치 방법

```bash
npm install
```

## 실행 방법

```bash
npm start
```

## 알림 방법

프로그램이 26년 이후 연도를 발견하면:

1. **macOS 시스템 알림** - 화면 우측 상단에 알림 팝업 표시
2. **로그 파일 저장** - `logs/wedding-alerts.log` 파일에 기록
3. **로컬 이메일** (선택사항) - macOS Mail 앱 설정 시 자동 전송

## 백그라운드 실행 (선택사항)

### pm2 사용

```bash
npm install -g pm2
pm2 start index.js --name wedding-checker
pm2 save
pm2 startup
```

### macOS launchd 사용

`~/Library/LaunchAgents/com.wedding.checker.plist` 파일 생성 후 실행:

```bash
launchctl load ~/Library/LaunchAgents/com.wedding.checker.plist
```

## 로그 확인

알림 기록은 `logs/wedding-alerts.log` 파일에서 확인할 수 있습니다:

```bash
cat logs/wedding-alerts.log
```

## GitHub Actions를 사용한 자동 실행

프로젝트에는 GitHub Actions 워크플로우가 포함되어 있어, 매일 한국시간 오전 8시, 정오 12시, 오후 4시, 오후 8시, 자정 12시에 자동으로 실행됩니다.

### 설정 방법

1. **GitHub Secrets 설정**

   이메일 알림을 받으려면 GitHub 저장소의 Secrets에 다음 값을 설정해야 합니다:

   - 저장소 페이지로 이동
   - Settings → Secrets and variables → Actions
   - New repository secret 클릭
   - 다음 두 개의 Secret 추가:
     - `EMAIL_USER`: Gmail 주소 (예: `your-email@gmail.com`)
     - `EMAIL_PASS`: Gmail 앱 비밀번호

2. **Gmail 앱 비밀번호 생성 방법**

   - Google 계정 관리 페이지 접속
   - 보안 설정으로 이동
   - 2단계 인증 활성화 (필수)
   - 앱 비밀번호 생성
   - 생성된 비밀번호를 `EMAIL_PASS`에 입력

3. **워크플로우 확인**

   - Actions 탭에서 워크플로우 실행 상태 확인 가능
   - 매일 한국시간 오전 8시, 정오 12시, 오후 4시, 오후 8시, 자정 12시에 자동 실행
   - 수동 실행도 가능 (Actions 탭 → Wedding Checker Scheduled Run → Run workflow)

### 로컬 실행 vs GitHub Actions

- **로컬 실행**: `npm start`로 실행하면 cron 스케줄러가 활성화되어 매일 오전 8시, 정오 12시, 오후 4시, 오후 8시, 자정 12시에 자동 실행
- **GitHub Actions**: 워크플로우가 자동으로 실행되며, 별도 서버 없이 GitHub에서 관리

## 특징

- ✅ **로컬 및 클라우드 지원** - 로컬 실행 또는 GitHub Actions 사용 가능
- ✅ **자동 스케줄링** - 매일 오전 8시, 정오 12시, 오후 4시, 오후 8시, 자정 12시 자동 확인
- ✅ **이메일 알림** - 27년 이후 일정 발견 시 즉시 알림
- ✅ **macOS 네이티브 알림** - 로컬 실행 시 시스템 알림 사용 (선택사항)
- ✅ **자동 로그 저장** - 모든 발견 기록 보관 (로컬 실행 시)
