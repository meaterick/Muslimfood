# Muslimfood · 무슬림푸드

전 세계 어디서나 **무슬림이 먹을 수 있는 음식점(할랄·무슬림 친화)** 을 빠르게 찾는 웹사이트입니다.
GitHub Pages에서 동작하는 정적 사이트이며, 특히 **한국**에서 쓰기 좋도록 만들었습니다.

배포 후 주소: `https://meaterick.github.io/Muslimfood/`

[English summary below](#english)

## 주요 기능

- **내 주변 바로 찾기** — "내 주변" 한 번이면 가까운 순으로 정렬되고, 근처에 장소가 적으면 가장 가까운 곳들이 보이도록 지도를 맞춥니다.
- **할랄 신뢰도 표시** — 지도 마커의 색과 모양으로 근거를 구분합니다.
  | 표시 | 의미 |
  |---|---|
  | 초록 원 (+금색 인증 표식) | 할랄 인증 / 100% 할랄 / 할랄 메뉴 (오픈스트리트맵 `diet:halal`) |
  | 청록 원 | 관광 공공기관이 선정한 무슬림 친화 식당 |
  | 노랑 원 | 일부 할랄 메뉴 |
  | 점선 원 | 미확인 — 상호에 '할랄'이 있거나, 한국에서 보통 할랄인 음식 종류(튀르키예·우즈베키스탄·파키스탄 등) |
- **한국 특화**
  - 길찾기 버튼이 **네이버 지도 → 카카오맵 → 구글 지도** 순서 (한국에서는 구글 지도 도보·자동차 길찾기가 안 되기 때문)
  - 공공데이터(경기관광공사 무슬림 친화 음식점, 한국문화정보원 세계 음식점) 반영, 이슬람 성원·기도실 표시
  - **무슬림을 위한 한식 가이드**: 돼지고기가 보통 들어가는 음식, 숨어 있는 재료(맛술·주정·젤라틴·라드), 비교적 안심할 수 있는 음식
  - **필요한 한국어 문장** (발음 표기, 크게 보기, 한국어 음성 재생)
  - **식당 직원용 안내 카드** (한국어·日本語·中文·English, 전체 화면)
- **필터**: 확인된 곳만, 영업 중, 음식 종류, 식당/패스트푸드/카페/마트, 기도 장소
- **6개 언어**: 한국어, English, العربية(오른쪽→왼쪽), Bahasa Indonesia, Bahasa Melayu, Türkçe — 지도 글자도 언어에 맞게 표시
- **빠르고 가벼움**: 프레임워크 없는 순수 JS, 목록이 지도보다 먼저 뜸, 미리 만든 데이터 파일을 지역별로 나눠 필요한 것만 받음
- **앱처럼 설치 + 오프라인**: PWA, 본 지역의 지도와 데이터는 인터넷이 약해도 계속 보임
- 다크 모드, 키보드·스크린리더 접근성, 쿠키·추적·광고 없음

## GitHub Pages 배포 (처음 한 번)

1. 이 브랜치를 `main`에 병합합니다.
2. 저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 바꿉니다.
3. **Actions** 탭에서 *Deploy to GitHub Pages* 워크플로가 끝나면 사이트가 열립니다. (바로 실행하려면 *Run workflow*)

이후에는 매일 04:17(KST)에 오픈스트리트맵 데이터를 새로 받아 자동 배포합니다.
Overpass 서버가 잠시 안 될 때는 마지막으로 받은 데이터를 그대로 씁니다.

> "Deploy from a branch" 방식으로도 동작하지만, 그 경우 저장소에 들어 있는 한국 공공데이터만 미리 들어가고
> 그 밖의 지역은 브라우저가 오픈스트리트맵에 실시간으로 조회합니다(조금 느림).

## 데이터

| 출처 | 내용 | 라이선스 |
|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org/copyright) (Overpass API) | 전 세계 `diet:halal=yes/only/limited` 장소, 한국의 이슬람 성원·기도실과 이름·음식 종류로 보아 할랄 가능성이 높은 음식점 (그 밖의 지역에서 이름에 halal·حلال·清真이 들어간 곳은 앱이 실시간으로 조회) | ODbL, © OpenStreetMap contributors |
| [경기관광공사_경기도 무슬림 친화 음식점](https://www.data.go.kr/data/15099378/fileData.do) | 경기도 무슬림 친화 식당 51곳 (주소를 좌표로 변환) | 공공데이터포털 이용허락범위 제한 없음 |
| [경기관광공사_경기도 이슬람 예배당 및 예배소 현황](https://www.data.go.kr/data/15099380/fileData.do) | 경기도 성원·기도소 (정확한 위치를 찾은 곳만) | 이용허락범위 제한 없음 |
| [한국문화정보원_전국 세계 음식점 데이터](https://www.data.go.kr/data/15111398/fileData.do) | 할랄 가능성이 높은 음식 종류의 식당 (미확인으로 표시) | 이용허락범위 제한 없음 |
| [OpenFreeMap](https://openfreemap.org) | 지도 타일 | © OpenMapTiles, © OpenStreetMap contributors |

공공데이터는 `scripts/import-kr.mjs`로 내려받아 `data/sources/*.json`에 저장합니다(출처·날짜 포함).
주소만 있는 데이터는 Nominatim·Photon으로 좌표를 찾았고, 건물 단위로 찾지 못한 곳은 앱에 "대략적인 위치"로 표시됩니다.

### 장소 추가·수정하기

- 가장 좋은 방법: [오픈스트리트맵](https://www.openstreetmap.org)에서 식당을 추가하고 `diet:halal=yes`(일부 할랄) 또는 `diet:halal=only`(전부 할랄) 태그를 답니다. 인증 기관은 `halal:certification=KMF` 처럼 적습니다. 다음 날 사이트에 반영됩니다.
- 또는 이 저장소의 이슈 양식 **Add a halal place / 할랄 식당 추가**, **Report a problem / 잘못된 정보 신고** 를 사용합니다.

## 개발

```bash
npm ci
npm test                       # 단위 테스트 (영업시간 파서, 데이터 정규화, 번역 키, 사이트 구성 등)
npm run build:data:offline     # 한국 공공데이터만으로 data/ 생성 (네트워크 불필요)
npm run build:data             # 오픈스트리트맵 포함 전체 데이터 생성 (Overpass 필요, 수 분 소요)
npm run serve                  # http://localhost:8080
npm run import:kr              # data.go.kr 공공데이터 다시 받기 + 좌표 변환
```

```
index.html, sw.js, manifest.webmanifest   앱 셸 / 서비스 워커 / PWA 설정
assets/js/core/      브라우저와 Node가 함께 쓰는 순수 로직 (정규화, 영업시간, 지도 링크, Overpass)
assets/js/ui/        화면 (지도, 목록·상세, 검색, 가이드, 다국어)
assets/i18n/         번역 (en, ko, ar, id, ms, tr)
assets/vendor/       MapLibre GL JS 5.24.0, RTL 텍스트 플러그인 (라이선스 파일 포함)
data/sources/        한국 공공데이터 (가공본)
data/index.json, data/cells/   배포용 데이터 (1°×1° 구역별 파일)
scripts/             데이터 빌드·가져오기·배포 조립 스크립트
.github/workflows/   pages.yml (매일 데이터 갱신 + 배포), ci.yml (테스트 + 한국 데이터 빌드)
```

새 언어를 추가하려면 `assets/i18n/en.json`을 복사해 번역하고 `assets/js/core/normalize.js`의 `UI_LANGS`와 `sw.js` 목록에 추가하면 됩니다. `npm test`가 빠진 키를 알려 줍니다.

### 알려진 한계

- 한국의 오픈스트리트맵 할랄 태그는 아직 적습니다. 그래서 공공데이터와 "미확인" 후보를 함께 보여 주며, 미확인 장소는 필터로 숨길 수 있습니다.
- 한국문화정보원 데이터는 2022년 기준이라 폐업한 곳이 있을 수 있습니다(상세 화면에 기준일 표시).
- 무슬림이 다수인 나라에서는 대부분의 음식이 할랄이라 따로 표시된 곳이 적습니다.
- 코드 라이선스 파일은 아직 없습니다. 공개 저장소로 공유하려면 원하는 라이선스(MIT 등)를 추가하세요. 데이터에는 위 표의 라이선스가 적용됩니다.

---

## English

**Muslimfood** is a fast, static website (GitHub Pages) for finding halal and Muslim-friendly food anywhere in the world, with extra depth for Korea.

- Map + list sorted by distance, "Near me", filters (confirmed only, open now, cuisine, category, prayer places)
- Every place shows *how we know* it is halal (certified / 100% halal / halal menu / Muslim-friendly list / some halal / not confirmed) and its source and date
- Korea: Naver Map and Kakao Map directions first, Korean public datasets, mosques and prayer rooms, a guide to Korean dishes that usually contain pork or alcohol, key Korean phrases with audio, and a card to show restaurant staff (Korean, Japanese, Chinese, English)
- 6 UI languages (en, ko, ar with RTL, id, ms, tr), localized map labels, dark mode, installable PWA with offline support, no tracking

**Deploy:** merge to `main`, then set *Settings → Pages → Source* to **GitHub Actions**. The `pages.yml` workflow rebuilds the data from OpenStreetMap every day and deploys.

**Contribute data:** add the place on OpenStreetMap with `diet:halal=yes|only` (it shows up within a day), or open an issue with the *Add a halal place* form.

Data © OpenStreetMap contributors (ODbL); Korean public data from data.go.kr (no usage restrictions); map tiles by OpenFreeMap / OpenMapTiles.
