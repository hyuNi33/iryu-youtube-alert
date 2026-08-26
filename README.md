# iryu-youtube-alert

`https://www.youtube.com/@2ryoo-world` 채널의 YouTube 라이브 시작을 감지해서 Discord 채널 웹훅으로 알림을 보내는 Vercel API 프로젝트입니다.

## 배포

1. 이 폴더를 새 GitHub 저장소에 올립니다.
2. Vercel에서 새 프로젝트로 import 합니다.
3. Framework Preset은 `Other`로 둡니다.
4. 환경변수를 추가한 뒤 Redeploy 합니다.

## 환경변수

| 이름 | 설명 |
|---|---|
| `YOUTUBE_API_KEY` | Google Cloud에서 발급한 YouTube Data API v3 키 |
| `DISCORD_WEBHOOK_URL` | 알림을 보낼 Discord 채널 웹훅 URL |
| `SITE_URL` | 이 알림 API 프로젝트의 Vercel 배포 주소. 예: `https://iryu-youtube-alert.vercel.app` |
| `YOUTUBE_SUBSCRIBE_TOKEN` | `/api/youtube/subscribe` 호출 보호용 임의 문자열 |
| `YOUTUBE_WEBHOOK_VERIFY_TOKEN` | YouTube WebSub 검증용 임의 문자열 |
| `YOUTUBE_WEBHOOK_SECRET` | YouTube WebSub HMAC 서명 검증용 임의 문자열 |
| `CRON_SECRET` | Vercel Cron 호출 보호용 임의 문자열 |
| `YOUTUBE_LIVE_LOOKBACK_MINUTES` | 선택. 폴링 보조 기능이 최근 몇 분 내 시작한 라이브만 알릴지 설정. 기본값 `10` |
| `YOUTUBE_HANDLE` | 기본값은 `@2ryoo-world`라 생략 가능 |
| `YOUTUBE_CHANNEL_ID` | 선택. 채널 ID를 직접 넣으면 핸들 조회를 건너뜁니다 |
| `CHZZK_CHANNEL_ID` | 선택. 치지직 방송 알림에 사용할 채널 ID |
| `CHZZK_LIVE_LOOKBACK_MINUTES` | 선택. 치지직 폴링이 최근 몇 분 내 시작한 라이브만 알릴지 설정. 기본값 `15` |

## 구독 등록

배포 후 아래 주소를 호출합니다.

```txt
https://YOUR_VERCEL_URL/api/youtube/subscribe?token=YOUTUBE_SUBSCRIBE_TOKEN값
```

정상이면 `ok: true`, `status: 202`, `handle: "@2ryoo-world"`가 포함된 JSON이 나옵니다.

YouTube WebSub 구독은 만료되므로 3~4일마다 다시 호출하는 것을 권장합니다.

## 자동 구독 갱신

`vercel.json`에 Vercel Cron이 설정되어 있습니다.

```json
{
  "path": "/api/cron/subscribe-youtube",
  "schedule": "0 0 * * *"
}
```

Vercel이 매일 00:00 UTC에 구독 갱신 API를 호출합니다. Vercel 환경변수에 `CRON_SECRET`을 추가한 뒤 Production으로 다시 배포하세요.

Vercel Cron은 Production 배포에서만 실행됩니다.

## 라이브 폴링 보조

YouTube WebSub가 라이브 시작 상태 변화를 항상 즉시 보내지는 않으므로, 보조 폴링 API를 추가했습니다.

```txt
https://YOUR_VERCEL_URL/api/cron/check-youtube-live?token=CRON_SECRET값
```

정상이면 현재 라이브가 없을 때 `live: false`, 최근 시작한 라이브를 발견해 Discord 전송에 성공하면 `notified: true`가 표시됩니다.

`.github/workflows/check-youtube-live.yml`에는 5분마다 위 URL을 호출하는 GitHub Actions 워크플로가 들어 있습니다. GitHub 저장소 `Settings > Secrets and variables > Actions`에 `CRON_SECRET`을 Vercel의 `CRON_SECRET`과 같은 값으로 등록하세요.

Vercel Pro를 쓰는 경우에는 `vercel.json`에 `/api/cron/check-youtube-live`를 5분 Cron으로 추가해도 됩니다. Vercel Hobby 플랜은 하루 1회 Cron만 허용되므로 기본 `vercel.json`에는 넣지 않았습니다.

## 치지직 라이브 폴링

치지직 방송 알림은 `CHZZK_CHANNEL_ID` 환경변수를 설정한 뒤 아래 URL로 확인할 수 있습니다.

```txt
https://YOUR_VERCEL_URL/api/cron/check-chzzk-live?token=CRON_SECRET값
```

정상이면 현재 라이브가 없을 때 `live: false`, 최근 시작한 라이브를 발견해 Discord 전송에 성공하면 `notified: true`가 표시됩니다.

`.github/workflows/check-chzzk-live.yml`에는 5분마다 위 URL을 호출하는 GitHub Actions 워크플로가 들어 있습니다. GitHub 저장소의 `CRON_SECRET` secret은 유튜브 폴링과 같은 값을 사용합니다.

## Discord 웹훅 테스트

배포 후 아래 주소를 호출하면 Discord 채널에 테스트 메시지를 보냅니다.

```txt
https://YOUR_VERCEL_URL/api/test-discord?token=YOUTUBE_SUBSCRIBE_TOKEN값
```

정상이면 Discord 채널에 `유튜브 방송 알림 테스트입니다` 메시지가 도착하고, 브라우저에는 `ok: true`가 표시됩니다.

## 로컬 문법 검사

```bash
npm run check
```

## 주의

- API 키와 토큰은 코드에 직접 넣지 말고 Vercel 환경변수에 넣으세요.
- 별도 DB가 없어서 서버리스 런타임이 바뀌면 중복 알림을 100% 막지는 못합니다.
- 완전한 중복 방지가 필요하면 Vercel KV, Supabase, Neon 같은 저장소를 추가하세요.
