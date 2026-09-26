# 로그인 동기화 켜기 (Supabase · Google · 카카오)

로그인하지 않아도 napkin은 기기에 저장된다. 아래를 한 번 해두면 Google · 카카오로 로그인해서 여러 기기에서 같은 메모를 쓸 수 있다.

## 1. Supabase 프로젝트

1. <https://supabase.com> 가입 → **New project** (지역: Northeast Asia (Seoul))
2. **SQL Editor** → [`docs/supabase.sql`](supabase.sql) 내용을 붙여넣고 **Run**
3. **Project Settings › API** 에서 두 값을 복사해 둔다
   - Project URL (`https://xxxx.supabase.co`)
   - `anon` `public` 키 — 브라우저에 공개돼도 되는 키다. 데이터는 로그인한 본인만 볼 수 있게 2번에서 막았다.
4. **Authentication › URL Configuration**
   - Site URL: `https://hashblown.github.io/napkin_memo/`
   - Redirect URLs에 추가: `https://hashblown.github.io/napkin_memo/`, `napkin://auth-callback`, (로컬 개발 시) `http://localhost:5173/`

## 2. Google 로그인

1. <https://console.cloud.google.com> › API 및 서비스 › **OAuth 동의 화면** 만들기 (외부, 앱 이름 napkin)
2. **사용자 인증 정보 › OAuth 클라이언트 ID** › 웹 애플리케이션
   - 승인된 리디렉션 URI: `https://<프로젝트>.supabase.co/auth/v1/callback`
3. 받은 클라이언트 ID · 보안 비밀을 Supabase **Authentication › Providers › Google** 에 넣고 켠다

## 3. 카카오 로그인

1. <https://developers.kakao.com> › 내 애플리케이션 › **애플리케이션 추가**
2. **카카오 로그인** 활성화, **Redirect URI**: `https://<프로젝트>.supabase.co/auth/v1/callback`
3. **동의항목**: 닉네임 · 프로필 사진, **카카오계정(이메일)** — Supabase가 이메일을 요구한다.
   이메일 동의항목은 **비즈 앱**이어야 켤 수 있다(개인 개발자도 본인 인증으로 전환 가능).
4. **앱 키 › REST API 키** 와 **보안 › Client Secret**(생성 후 사용함) 을 Supabase **Authentication › Providers › Kakao** 에 넣고 켠다

## 4. 앱에 서버 주소 넣기

GitHub 저장소 **Settings › Secrets and variables › Actions › Variables** 에 추가:

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | anon public 키 |

그다음 배포(Actions › Deploy to GitHub Pages › Run workflow)하면 설정 › **계정 · 동기화** 에 로그인 버튼이 생긴다.
(값을 Claude에게 알려주면 `src/config.ts`에 직접 넣어도 된다 — 공개 키라서 괜찮다.)

## 동기화 규칙

- 로그인 전에도 기기에 저장된다. 처음 로그인한 기기는 가지고 있던 메모를 모두 올린다.
- 같은 메모를 두 기기에서 고치면 **나중에 고친 쪽**이 남는다. 지운 것도 다른 기기에 전해진다.
- 올라가는 것: 메모 · 할 일 · 분류 · 잠근 분류 목록 · 연재 · 고친 분류 기록 · 보관함 잠금 정보(개인키는 잠금 번호로 암호화된 채).
- 올라가지 않는 것: Claude API 키, 글씨체 등 기기 설정.
- 보관함 메모는 암호화된 채로만 올라가서 서버에서도 읽을 수 없다. 짧은 잠금 번호는 추측될 수 있으니 6자리 이상을 권한다.
- 로그아웃해도 이 기기의 메모는 남는다.
