# Wedding Checker

서울여성가족재단 예식장 예약 페이지를 매일 오전 9시에 확인하고, 26년 이후 연도가 발견되면 **macOS 시스템 알림**과 **로그 파일**로 알림을 보내는 서비스입니다.

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

## 특징

- ✅ **외부 서비스 불필요** - 완전히 로컬에서 동작
- ✅ **macOS 네이티브 알림** - 시스템 알림 사용
- ✅ **자동 로그 저장** - 모든 발견 기록 보관
- ✅ **매일 오전 9시 자동 확인** - 스케줄링 내장
