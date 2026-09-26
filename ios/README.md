# napkin iOS 앱

배포된 웹앱(`https://hashblown.github.io/napkin_memo/`)을 앱 안에 띄우고, 아이폰에서만 되는 것들을 붙인 껍데기 앱이다.

| 기능 | 위치 |
|---|---|
| **바로 적기 위젯** (홈 화면 · 잠금 화면) | 탭하면 앱이 열리자마자 입력창 + 키보드 |
| **챙길 것 위젯** (홈 화면 · 잠금 화면) | 기한 된 할 일 · 리마인드 링크 · 미뤄둔 할 일을 하나씩. 위젯 안에서 **완료 / 내일 다시 / 다른 거** |
| **냅킨에 적기** (단축어 · 액션 버튼 · Siri) | 앱을 열지 않고 시스템 입력창으로 적기 |
| **공유 메뉴 › 냅킨** | 사파리 · 인스타 · 유튜브 등에서 링크/글 바로 담기 |
| **알림** | 기한 있는 할 일 · 리마인드 링크를 앱이 꺼져 있어도 알림 |
| **📅 캘린더** | 할 일을 기본 캘린더 편집 화면으로 |

앱 밖에서 적은 메모와 위젯에서 누른 동작은 App Group(`group.com.hashblown.napkin`)에 쌓였다가, 앱을 열면 웹앱이 가져가 분류한다.

## 내 아이폰에 설치하기 (Mac)

1. Xcode(15 이상)를 설치하고 한 번 실행한다. **Xcode › Settings › Accounts**에 Apple ID를 추가한다.
2. XcodeGen 설치 후 프로젝트 만들기
   ```sh
   brew install xcodegen
   cd ios
   xcodegen
   open Napkin.xcodeproj
   ```
3. 왼쪽에서 프로젝트 선택 → 타깃 **Napkin, NapkinWidgets, NapkinShare** 각각 **Signing & Capabilities › Team**에서 내 팀을 고른다.
   (매번 고르기 싫으면 `project.yml`의 `DEVELOPMENT_TEAM`에 Team ID를 넣고 `xcodegen` 다시 실행)
   - 번들 ID가 이미 쓰이고 있다는 오류가 나면 `project.yml`의 `com.hashblown` 부분과 App Group ID를 내 것으로 바꾼다
     (App Group ID는 `Shared/SharedStore.swift`의 `groupID`도 같이 바꿔야 한다).
4. 아이폰을 케이블로 연결 → 아이폰 **설정 › 개인정보 보호 및 보안 › 개발자 모드** 켜기(재시동).
5. Xcode 위쪽에서 기기로 내 아이폰, 스킴 **Napkin**을 고르고 ▶︎ 실행.
   - 처음엔 아이폰 **설정 › 일반 › VPN 및 기기 관리**에서 개발자 앱을 신뢰해야 할 수 있다.

### 설치 후

- **위젯**: 홈 화면 길게 누르기 → 왼쪽 위 **+** → **냅킨** → *바로 적기* / *챙길 것*. 잠금 화면도 같은 방법으로 추가.
- **액션 버튼**(15 Pro 이상): 설정 › 액션 버튼 › 단축어 › **냅킨에 적기**
- **공유 메뉴**: 공유 → 앱 줄 맨 끝 **더 보기** → 냅킨 켜기
- 웹 관리자(디버깅): 맥 사파리 › 개발 › 내 아이폰 › 냅킨 (Debug 빌드일 때)

## 무료 계정 / 유료 계정

- **무료 Apple ID**: 설치한 앱이 **7일 뒤 만료**된다(다시 ▶︎ 실행하면 됨). App Group 같은 기능이 무료 팀에서 제한되면 서명 단계에서 오류가 난다.
- **Apple Developer Program(연 $99)**: 만료 걱정 없이 쓰려면 **Product › Archive → Distribute App → TestFlight**. 앱스토어 공개가 아니라 나만 설치한다.

## 로그인 동기화

설정 › 계정 · 동기화의 Google · 카카오 로그인은 앱 안 웹 화면 대신 **아이폰 시스템 로그인 창**으로 열리고, `napkin://auth-callback` 으로 돌아온다.
Supabase의 Redirect URLs에 `napkin://auth-callback` 이 있어야 한다([`docs/sync-setup.md`](../docs/sync-setup.md)).

## 알아둘 점

- 앱 안 데이터는 **이 앱의 저장소**에 있다. 사파리/홈 화면 웹앱에 적어둔 게 있다면 거기서 **설정 › 내보내기** → 앱에서 **가져오기**.
- 앱은 웹앱을 인터넷에서 불러온다. 처음 실행할 땐 인터넷이 필요하다.
- 위젯의 완료 · 내일 다시는 위젯에서 바로 반영되고, 앱을 열면 웹앱 데이터에도 반영된다.
