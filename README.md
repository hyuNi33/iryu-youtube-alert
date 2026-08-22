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
| `YOUTUBE_HANDLE` | 기본값은 `@2ryoo-world`라 생략 가능 |
| `YOUTUBE_CHANNEL_ID` | 선택. 채널 ID를 직접 넣으면 핸들 조회를 건너뜁니다 |

## 구독 등록

배포 후 아래 주소를 호출합니다.

```txt
https://YOUR_VERCEL_URL/api/youtube/subscribe?token=YOUTUBE_SUBSCRIBE_TOKEN값
```

정상이면 `ok: true`, `status: 202`, `handle: "@2ryoo-world"`가 포함된 JSON이 나옵니다.

YouTube WebSub 구독은 만료되므로 3~4일마다 다시 호출하는 것을 권장합니다.

## 로컬 문법 검사

```bash
npm run check
```

## 주의

- API 키와 토큰은 코드에 직접 넣지 말고 Vercel 환경변수에 넣으세요.
- 별도 DB가 없어서 서버리스 런타임이 바뀌면 중복 알림을 100% 막지는 못합니다.
- 완전한 중복 방지가 필요하면 Vercel KV, Supabase, Neon 같은 저장소를 추가하세요.
