# 종이결

iPad와 Android 태블릿을 위한, 종이에 쓰는 느낌의 필기 노트입니다. PWA로도 설치할 수 있고, Capacitor로 감싼 네이티브 앱(Android APK / iOS IPA)으로도 실행할 수 있습니다.

종이 태블릿의 필기 경험에서 영감을 받아 처음부터 새로 만든 독립 앱이며, reMarkable을 비롯한 어떤 제품과도 제휴하거나 연관되어 있지 않습니다. 특정 제품의 코드, 상표, 디자인, 이미지 자산을 사용하지 않았습니다.

## 주요 기능

- **필압 필기** — Apple Pencil·S Pen의 필압과 속도에 따라 굵기가 변하는 펜, 연필, 형광펜
- **종이 질감** — 줄노트, 모눈, 점 격자, 빈 페이지 템플릿과 따뜻한 종이 배경
- **노트와 페이지** — 노트 만들기, 표지 선택, 페이지 추가·복제·이동·삭제, 페이지 썸네일
- **PDF 필기** — PDF를 노트로 가져와 각 페이지 위에 직접 필기, PDF·이미지 페이지 추가
- **태블릿 제스처** — 두 손가락 확대·축소, 손가락 한 개로 이동, 손바닥 무시
- **지우개와 되돌리기** — 획 단위 지우개, 최대 60단계 실행 취소·다시 실행
- **내보내기** — 현재 페이지 PNG, 노트 전체 PDF, 전체 데이터 JSON 백업
- **오프라인** — IndexedDB 로컬 저장, 서비스 워커 캐시로 비행기 모드에서도 실행
- **집중 모드** — 도구 막대를 숨기고 종이에만 집중

## 실행

Node.js 20 이상을 권장합니다.

```bash
npm install
npm run dev        # http://localhost:5180
```

프로덕션 빌드와 로컬 미리보기:

```bash
npm run build
npm run preview    # http://localhost:4180
```

빌드 결과물은 `dist/`에 생성됩니다. 정적 호스팅 서비스에 `dist/`를 올리면 바로 배포할 수 있습니다. 서비스 워커와 매니페스트를 사용하므로 HTTPS(또는 localhost)에서 열어야 설치형 PWA로 동작합니다.

## 네이티브 앱 빌드

네이티브 프로젝트는 `android/`와 `ios/`에 포함되어 있습니다. 웹 빌드 후 `cap sync`로 최신 `dist/`를 복사합니다.

```bash
npm run native:sync       # 웹 빌드 + Android/iOS 동기화
npm run android:open      # Android Studio에서 열기
npm run ios:open          # Xcode에서 열기
```

### Android APK

JDK 21과 Android SDK(compileSdk 36)가 필요합니다.

```bash
npm run android:apk
```

서명된 APK를 만들려면 `android/app/build/outputs/apk/release/app-release-unsigned.apk`를 zipalign 후 apksigner로 서명합니다. 이 저장소의 `release/keystore/jongigyeol-release.jks`는 로컬 빌드용이며 Git에는 포함하지 않습니다. 서명 키를 잃으면 기존 앱을 업데이트할 수 없으니 안전하게 보관하세요.

### iOS IPA

Xcode와 iOS 15+ SDK가 필요합니다. 서명 없이 빌드:

```bash
npm run ios:build
```

`ios/App/build/Build/Products/Release-iphoneos/App.app`이 생성됩니다. `Payload/App.app` 구조로 압축하면 unsigned IPA가 됩니다. 실제 기기 설치용 서명은 Xcode의 Signing & Capabilities에서 본인 Team을 선택한 뒤 Archive → Distribute App으로 진행합니다.

## 설치 파일

빌드된 설치 파일은 `programs/` 폴더에 있습니다.

| 파일 | 대상 | 비고 |
| --- | --- | --- |
| `jongigyeol-1.0.0-android.apk` | Android 7.0+ 태블릿 | 릴리스 키로 서명됨. 바로 설치 가능 |
| `jongigyeol-1.0.0-ios-unsigned.ipa` | iPadOS 15+ | 서명 전 IPA. 아래 iOS 설치 방법으로 본인 Apple ID로 서명 필요 |

패키지 이름은 `app.jongigyeol.note`, 버전은 `1.0.0`입니다.

### Android APK 설치

1. APK 파일을 태블릿으로 옮깁니다(USB, Drive, 메일 등).
2. 파일 관리자에서 APK를 열고 **설치**를 누릅니다.
3. 처음 설치할 때만 **출처를 알 수 없는 앱 설치 허용**을 켜면 됩니다.
4. 설치 후 홈 화면의 **종이결** 아이콘으로 실행합니다.

### iPad/iOS IPA 설치

현재 IPA는 Apple 개발자 서명이 없는 상태입니다. iPad에 설치하려면 본인의 Apple ID로 한 번 서명해야 합니다.

**방법 1 — Xcode 사용 (무료 Apple ID 가능)**

1. `ios/App/App.xcodeproj`를 Xcode로 엽니다.
2. 프로젝트 → App → Signing & Capabilities에서 본인 Apple ID의 Team을 선택합니다.
3. Bundle Identifier를 이미 사용 중이면 `app.jongigyeol.note`에서 한 글자만 바꿉니다.
4. iPad를 Mac에 연결하고 상단 기기를 선택한 뒤 Run(⌘R)합니다.
5. 무료 계정은 7일마다 다시 서명해야 하며, 유료 개발자 계정은 1년간 사용할 수 있습니다.

**방법 2 — Sideloadly / AltStore 사용**

서명된 IPA가 아니라면 Sideloadly 같은 도구에 `jongigyeol-1.0.0-ios-unsigned.ipa`와 Apple ID를 넣어 서명·설치할 수 있습니다. 이 경우에도 무료 계정은 7일 제한이 있습니다.

## 태블릿에 설치 (PWA)

### iPad (Safari)

1. Safari에서 앱 주소를 엽니다.
2. 공유 버튼을 누르고 **홈 화면에 추가**를 선택합니다.
3. 홈 화면의 **종이결** 아이콘으로 전체 화면 앱처럼 실행합니다.

### Android 태블릿 (Chrome)

1. Chrome에서 앱 주소를 엽니다.
2. 오른쪽 위 메뉴에서 **앱 설치** 또는 **홈 화면에 추가**를 선택합니다.
3. 설치된 앱을 실행하면 주소창 없는 전체 화면으로 열립니다.

## 사용법

| 동작 | 방법 |
| --- | --- |
| 쓰기 | 펜·연필·형광펜을 고르고 화면에 씁니다. 필압을 지원하는 펜은 굵기가 자연스럽게 변합니다. |
| 지우기 | 지우개를 고르고 획을 문지릅니다. 획 전체가 지워집니다. |
| 확대·축소 | 두 손가락으로 벌리거나 오므립니다. 하단의 `%`를 눌러 화면에 맞출 수 있습니다. |
| 이동 | 손가락 한 개로 끌거나, 도구 막대의 **손가락** 모드를 켭니다. |
| 페이지 넘기기 | 하단 `‹` `›` 또는 키보드 방향키 |
| 페이지 관리 | 하단 페이지 번호나 격자 아이콘을 눌러 추가·복제·이동·삭제 |
| 되돌리기 | 상단 ↶ 또는 `⌘Z` / `Ctrl+Z` |
| 다시 실행 | 상단 ↷ 또는 `⇧⌘Z` / `Shift+Ctrl+Z` |
| 도구 단축키 | `B` 펜, `P` 연필, `H` 형광펜, `E` 지우개, `F` 손가락 그리기 |

설정의 **손가락으로도 그리기**를 켜면 펜 없이도 그릴 수 있습니다. 끄면 손가락은 화면 이동에만 쓰이므로 손바닥이 닿아도 획이 생기지 않습니다.

## 데이터와 백업

노트, 페이지, 필기는 기기의 IndexedDB(`jongigyeol`)에만 저장되며 서버로 전송되지 않습니다. 웹과 네이티브 앱은 각각의 저장 공간을 사용합니다.

- **전체 백업** — 설정 → 데이터 → 전체 백업. 모든 노트와 페이지를 JSON 파일로 내려받습니다.
- **백업 복원** — 같은 위치에서 백업 파일을 선택합니다. 기존 노트에 덮어쓰지 않고 추가됩니다.
- **네이티브 내보내기** — PNG·PDF·JSON을 만들면 문서 폴더에 저장한 뒤 공유 시트를 엽니다. iPad는 **Files 앱 → 나의 iPad → 종이결 → 내보내기**, Android는 공유 시트의 **Files/Drive**로 저장할 수 있습니다.
- **주의** — 앱 데이터를 지우거나 웹 브라우저의 사이트 데이터를 지우면 노트가 사라질 수 있습니다. 중요한 노트는 백업을 내려받아 두세요.

## 기술 구성

- **Vite + React + TypeScript** — 화면과 상태 관리
- **Canvas 2D 3중 레이어** — 배경(템플릿·PDF), 확정된 잉크, 실시간 입력을 분리해 필기 지연을 줄입니다.
- **Pointer Events** — 필압, 펜/손가락 구분, 손바닥 무시, 제스처 처리
- **IndexedDB (`idb`)** — 노트·페이지·설정 로컬 저장
- **pdf.js** — PDF 페이지를 이미지 배경으로 변환
- **jsPDF** — 노트 전체를 PDF로 내보내기
- **서비스 워커** — 앱 셸과 폰트 캐시, 오프라인 실행 (PWA)
- **Capacitor 8** — Android/iOS 네이티브 셸, Filesystem·Share·StatusBar·App 플러그인

```
src/
  App.tsx              해시 라우팅, 첫 실행 노트 생성
  components/
    Library.tsx        서재, 폴더, 검색, 가져오기, 설정
    Notebook.tsx       편집기 상태, 페이지 관리, 내보내기
    DrawCanvas.tsx     필기 캔버스, 필압, 제스처, 확대/이동
    ui.tsx             시트, 토스트, 확인 대화상자 등
    Icon.tsx           직접 그린 선 아이콘
  lib/
    paper.ts           종이 템플릿과 획 렌더링
    db.ts              IndexedDB 스키마와 백업
    pdf.ts             PDF 가져오기
    export.ts          PNG·PDF·백업 내보내기
    native.ts          네이티브 저장·공유 처리
  types.ts             데이터 모델, 팔레트, 기본값
  styles.css           디자인 시스템과 태블릿 레이아웃
public/
  manifest.webmanifest PWA 매니페스트
  sw.js                서비스 워커
  icons/               앱 아이콘
android/               Android 네이티브 프로젝트
ios/                   iOS 네이티브 프로젝트 (SPM)
programs/              빌드된 APK / IPA
capacitor.config.ts    앱 ID, 이름, 플러그인 설정
assets/                아이콘·스플래시 원본
```

## 알려진 제한

- 필기 입력은 기기와 브라우저의 Pointer Events 지원에 따라 필압 해상도가 달라집니다.
- PDF는 벡터가 아닌 이미지 배경으로 변환되므로, 아주 큰 PDF는 가져오는 데 시간이 걸리고 저장 용량을 더 사용합니다.
- 노트는 기기별 로컬 저장소에 보관됩니다. 기기 간 자동 동기화는 없으며, JSON 백업으로 옮길 수 있습니다.
- iOS/iPadOS의 저장 공간 정책에 따라 장기간 미사용 시 데이터가 정리될 수 있으므로 백업을 권장합니다.
- 제공되는 iOS IPA는 서명 전 파일입니다. 실제 iPad 설치에는 본인 Apple ID 서명이 필요하며, 무료 계정은 7일마다 재서명해야 합니다.
- Android APK는 릴리스 키로 서명되어 있지만 Google Play 스토어에는 등록하지 않았습니다. 직접 설치(사이드로드)용입니다.
- 가로·세로 태블릿과 휴대폰 크기를 지원하지만, 필기에는 10인치 이상 화면을 권장합니다.

## 상표 고지

종이결은 독립적으로 제작된 오리지널 앱입니다. reMarkable은 해당 소유자의 상표이며, 이 앱은 reMarkable과 제휴·후원·보증 관계가 없습니다. 앱의 이름, 아이콘, 표지, 일러스트, 코드는 모두 이 프로젝트에서 새로 만들었습니다.
