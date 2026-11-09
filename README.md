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
  | 연두 네모 | 전 메뉴 채식·비건 (고기·생선을 쓰지 않는 식당) |
  | 연두 테두리 네모 | 채식·비건 메뉴가 있는 일반 식당 |
- **할랄 식당이 없을 때의 대안: 채식·비건** — 고기를 쓰지 않는 음식은 할랄에서 가장 큰 걱정(도축 방식)을 피할 수 있어,
  근처에 할랄 식당이 없을 때 많은 무슬림이 채식·비건 식당을 찾습니다. 서울시 채식 인증 음식점, 수원시 비건 메뉴 취급 업소,
  오픈스트리트맵의 `diet:vegan`·`diet:vegetarian` 태그를 할랄과 구분되는 네모 마커로 보여 주고, 인증된 메뉴는 비건·락토·오보 같은
  식단 표시와 함께 보여 줍니다. 할랄 인증은 아니므로 소스의 술(맛술·주정) 등은 확인하라고 안내합니다.
  "보기" 필터로 **할랄 + 채식 / 할랄만 / 채식·비건만** 을 고를 수 있습니다.
- **프랜차이즈의 고기 없는 메뉴** — 롯데리아 미라클버거(100% 식물성 패티)처럼 체인 공통 메뉴에 비건·채식 메뉴가 있으면
  그 체인의 전국 지점을 모두 지도에 표시합니다. 체인과 메뉴는 `assets/js/core/brands.js` 한 곳에 공식 메뉴 링크·확인 날짜와 함께 적어 두고,
  지점 위치는 소상공인시장진흥공단 상가(상권)정보에서 가져옵니다(운영 회사 이름이 앞에 붙은 매장, 업종이 잘못 등록된 매장도 찾음).
  지금은 다음 6개 체인의 지점 약 4,600곳이 나옵니다. 목록에서는 할랄 식당을 먼저, 채식 메뉴가 있는 곳을 그다음에 보여 줍니다.

  | 체인 | 고기 없는 메뉴 (공식 메뉴·알레르기 정보로 확인) |
  |---|---|
  | 롯데리아 | 미라클버거 (식물성 패티, 달걀·우유 없음) |
  | 파파존스 | 그린잇 식물성 마가리타·가든스페셜 (비건 치즈), 마가리타, 가든 스페셜 |
  | 써브웨이 | 베지, 에그마요 |
  | 도미노피자 | 치즈 피자 |
  | 샐러디 | 단호박 노릇두부 샐러디, 청양간장 두부 비빔밥 (공식 메뉴의 VEGAN 표시) |
  | 본죽 | 단팥죽, 단호박죽, 녹두죽, 명품잣죽, 흑임자죽 (알레르기 정보상 고기·우유·달걀 없음, 교차 오염 항목도 없음) |
- **한국 특화**
  - 길찾기 버튼이 **네이버 지도 → 카카오맵 → 구글 지도** 순서 (한국에서는 구글 지도 도보·자동차 길찾기가 안 되기 때문)
  - 공공데이터(경기관광공사 무슬림 친화 음식점, 한국문화정보원 세계 음식점, 서울시 채식 인증 음식점, 수원시 비건 메뉴 업소) 반영, 이슬람 성원·기도실 표시
  - **무슬림을 위한 한식 가이드**: 돼지고기가 보통 들어가는 음식, 숨어 있는 재료(맛술·주정·젤라틴·라드), 비교적 안심할 수 있는 음식
  - **필요한 한국어 문장** (발음 표기, 크게 보기, 한국어 음성 재생)
  - **식당 직원용 안내 카드** (한국어·日本語·中文·English·Français, 전체 화면)
- **검색과 메뉴** — 지역, 식당명, 주소 또는 메뉴를 검색하고 결과를 선택하면 지도로 이동합니다. 상세 화면에 출처가 있는 대표 메뉴나 메뉴 링크가 표시됩니다.
- **주변 식당 더 찾기** — 지도를 확대하고 버튼을 누르면 지도 중심 주변의 식당을 OpenStreetMap에서 추가로 찾습니다.
- **필터**: 보기(할랄 + 채식 / 할랄만 / 채식·비건만), 확인된 곳만, 영업 중, 음식 종류, 식당/패스트푸드/카페/마트, 기도 장소
- **7개 언어**: 한국어, English, العربية(오른쪽→왼쪽), Bahasa Indonesia, Bahasa Melayu, Türkçe, Français — 지도 글자도 언어에 맞게 표시
- **빠르고 가벼움**: 프레임워크 없는 순수 JS, 목록이 지도보다 먼저 뜸, 미리 만든 데이터 파일을 지역별로 나눠 필요한 것만 받음
- **앱처럼 설치 + 오프라인**: PWA, 본 지역의 지도와 데이터는 인터넷이 약해도 계속 보임
- 다크 모드, 키보드·스크린리더 접근성, 쿠키·추적·광고 없음

## GitHub Pages 배포 (처음 한 번)

1. 이 브랜치를 `main`에 병합합니다.
2. 저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 바꿉니다.
3. **Actions** 탭에서 *Deploy to GitHub Pages* 워크플로가 끝나면 사이트가 열립니다. (바로 실행하려면 *Run workflow*)

이후에는 매일 04:17(KST)에 오픈스트리트맵 데이터를 새로 받아 자동 배포합니다(5~10분, 대부분 공용 Overpass 서버를 기다리는 시간).
Overpass 서버가 잠시 안 될 때는 마지막으로 받은 데이터를 그대로 씁니다.
`main`에 코드를 푸시하면 마지막으로 받은 오픈스트리트맵·상가 데이터로 바로 다시 빌드해 약 2분 안에 배포합니다.
상가(상권)정보 원본(약 350MB)은 분기마다 새 판이 나올 때 한 번만 받고 GitHub Actions 캐시에 보관하므로,
`brands.js`에 체인을 추가해도 다시 받지 않고 30초 안에 지점을 다시 뽑습니다.

> "Deploy from a branch" 방식으로도 동작하지만, 그 경우 저장소에 들어 있는 한국 공공데이터만 미리 들어가고
> 그 밖의 지역은 브라우저가 오픈스트리트맵에 실시간으로 조회합니다(조금 느림).

## 데이터

| 출처 | 내용 | 라이선스 |
|---|---|---|
| [OpenStreetMap](https://www.openstreetmap.org/copyright) (Overpass API) | 전 세계 `diet:halal=yes/only/limited` 장소와 전 메뉴 채식·비건 식당(`diet:vegan=only`, `diet:vegetarian=only`), 한국의 이슬람 성원·기도실, 채식·비건 메뉴가 있는 식당, 이름·음식 종류로 보아 할랄 가능성이 높은 음식점 (할랄 인증 태그와 할랄 관련 분류도 검색하고, 실시간 검색에서는 이름·브랜드의 할랄 표시와 채식 태그도 확인) | ODbL, © OpenStreetMap contributors |
| [경기관광공사_경기도 무슬림 친화 음식점](https://www.data.go.kr/data/15099378/fileData.do) | 경기도 무슬림 친화 식당 51곳 (주소를 좌표로 변환) | 공공데이터포털 이용허락범위 제한 없음 |
| [경기관광공사_경기도 이슬람 예배당 및 예배소 현황](https://www.data.go.kr/data/15099380/fileData.do) | 경기도 성원·기도소 (정확한 위치를 찾은 곳만) | 이용허락범위 제한 없음 |
| [한국문화정보원_전국 세계 음식점 데이터](https://www.data.go.kr/data/15111398/fileData.do) | 할랄 가능성이 높은 음식 종류의 식당 (미확인으로 표시), 채식 메뉴가 있다고 등록된 식당 | 이용허락범위 제한 없음 |
| [서울특별시_식품안전정보 서비스_먹거리 지도정보 (채식음식점)](https://data.seoul.go.kr/dataList/OA-23126/S/1/datasetView.do) | 서울시 채식 인증 음식점 300곳: 채식전문(전 메뉴)·채식가능(일부 메뉴), 인증 메뉴와 비건·락토·오보 구분 | 이용허락범위 제한 없음 |
| [경기도 수원시_비건메뉴취급업소](https://www.data.go.kr/data/15129222/fileData.do) | 수원시 비건 메뉴 업소 26곳과 대표 비건 메뉴 | 이용허락범위 제한 없음 |
| [소상공인시장진흥공단_상가(상권)정보](https://www.data.go.kr/data/15083033/fileData.do) | `brands.js`에 있는 체인의 전국 지점 위치 (음식점 업종만, 분기마다 갱신) | 이용허락범위 제한 없음 |
| 각 체인의 공식 메뉴 페이지 | 체인 공통 메뉴 가운데 고기 없는 메뉴와 식단 구분 (`brands.js`에 확인 날짜와 링크 기록) | 사실 정보, 출처 링크 |
| [한국관광공사 무슬림 친화 식당 가이드](https://english.visitkorea.or.kr/svc/thingsToDo/subMuslimFriendly.do) | 식당 9곳의 위치, 분류, 대표 메뉴 | 사실 정보 요약, 출처 표시 |
| [OpenFreeMap](https://openfreemap.org) | 지도 타일 | © OpenMapTiles, © OpenStreetMap contributors |

공공데이터는 `scripts/import-kr.mjs`로 내려받아 `data/sources/*.json`에 저장합니다(출처·날짜 포함).
주소만 있는 데이터는 Nominatim·Photon으로 좌표를 찾았고, 건물 단위로 찾지 못한 곳은 앱에 "대략적인 위치"로 표시됩니다.

### 장소 추가·수정하기

- 가장 좋은 방법: [오픈스트리트맵](https://www.openstreetmap.org)에서 식당을 추가하고 `diet:halal=yes`(일부 할랄) 또는 `diet:halal=only`(전부 할랄) 태그를 답니다. 식당 메뉴 주소는 `website:menu`에 추가할 수 있습니다. 인증 기관은 `halal:certification=KMF` 처럼 적습니다. 다음 날 사이트에 반영됩니다.
- 또는 이 저장소의 이슈 양식 **Add a halal place / 할랄 식당 추가**, **Report a problem / 잘못된 정보 신고** 를 사용합니다.
- **프랜차이즈 메뉴 추가**: `assets/js/core/brands.js`에 체인 이름, 상호명 앞부분, 메뉴(이름·영문명·식단), 공식 메뉴 링크와 확인 날짜를 추가하면
  다음 배포 때 전국 지점이 나타납니다(새 체인이 생기면 상가정보를 자동으로 다시 받습니다). 직접 고치기 어렵다면 이슈 양식
  **Add a chain's meat-free dish / 프랜차이즈 비건·채식 메뉴 추가** 를 사용하세요. 확인한 지 6개월이 지난 메뉴는 빌드 로그에 경고가 나옵니다.

## 개발

```bash
npm ci
npm test                       # 단위 테스트 (영업시간 파서, 데이터 정규화, 번역 키, 사이트 구성 등)
npm run build:data:offline     # 한국 공공데이터만으로 data/ 생성 (네트워크 불필요)
npm run build:data             # 오픈스트리트맵 포함 전체 데이터 생성 (Overpass 필요, 수 분 소요)
npm run serve                  # http://localhost:8080
npm run import:kr              # data.go.kr 공공데이터 다시 받기 + 좌표 변환
npm run import:chains          # 상가(상권)정보(약 350MB)에서 체인 지점 다시 뽑기 → data/sources/kr-chains.json
```

```
index.html, sw.js, manifest.webmanifest   앱 셸 / 서비스 워커 / PWA 설정
assets/js/core/      브라우저와 Node가 함께 쓰는 순수 로직 (정규화, 영업시간, 지도 링크, Overpass)
assets/js/ui/        화면 (지도, 목록·상세, 검색, 가이드, 다국어)
assets/i18n/         번역 (en, ko, ar, id, ms, tr, fr)
assets/vendor/       MapLibre GL JS 5.24.0, RTL 텍스트 플러그인 (라이선스 파일 포함)
data/sources/        한국 공공데이터 (가공본)
data/index.json, data/cells/   배포용 데이터 (1°×1° 구역별 파일)
data/search.json              검색을 실행할 때만 받는 전체 식당 검색 데이터
scripts/             데이터 빌드·가져오기·배포 조립 스크립트
.github/workflows/   pages.yml (매일 데이터 갱신 + 배포), ci.yml (테스트 + 한국 데이터 빌드)
```

새 언어를 추가하려면 `assets/i18n/en.json`을 복사해 번역하고 `assets/js/core/normalize.js`의 `UI_LANGS`와 `sw.js` 목록에 추가하면 됩니다. `npm test`가 빠진 키를 알려 줍니다.

### 알려진 한계

- 한국의 오픈스트리트맵 할랄 태그는 아직 적습니다. 그래서 공공데이터, "미확인" 후보, 채식·비건 식당을 함께 보여 주며, 미확인 장소와 채식 식당은 필터로 숨길 수 있습니다.
- 한국관광공사의 무슬림 친화 식당 목록은 저작권이 있어 복사하지 않고, 가이드에서 공식 PDF로 연결합니다.
- 한국문화정보원 데이터는 2022년 기준이라 폐업한 곳이 있을 수 있습니다(상세 화면에 기준일 표시).
- 무슬림이 다수인 나라에서는 대부분의 음식이 할랄이라 따로 표시된 곳이 적습니다.
- 코드 라이선스 파일은 아직 없습니다. 공개 저장소로 공유하려면 원하는 라이선스(MIT 등)를 추가하세요. 데이터에는 위 표의 라이선스가 적용됩니다.

---

## English

**Muslimfood** is a fast, static website (GitHub Pages) for finding halal and Muslim-friendly food anywhere in the world, with extra depth for Korea.

- Map + list sorted by distance, "Near me", filters (show, confirmed only, open now, cuisine, category, prayer places)
- Search the full catalog by restaurant, address, cuisine or published dishes. Choose a result to see its pin and details. Use **Find more nearby** to look for additional OpenStreetMap listings around the map centre.
- Every place shows *how we know* it is halal (certified / 100% halal / halal menu / Muslim-friendly list / some halal / not confirmed) and its source and date
- Chains whose standard menu has a meat-free dish appear at every branch in Korea, about 4,600 places: Lotteria (plant-based Miracle Burger), Papa John's (plant-based and cheese pizzas), Subway (Veggie, Egg Mayo), Domino's (cheese pizza), Salady (dishes marked vegan) and Bonjuk (porridges with no meat, milk or egg in the official allergen list). The chains, dishes, official menu links and check dates live in `assets/js/core/brands.js`; branch locations come from the national store registry and refresh each quarter. Halal places stay first in the list
- Vegetarian and vegan places as a fallback when there is no halal option nearby: square leaf markers (filled = whole menu meat-free, outlined = some dishes), with certified dishes and their diet labels (vegan, lacto, ovo) from Seoul City, Suwon City and OpenStreetMap. A **Show** filter switches between halal + vegetarian, halal only and vegetarian only
- Korea: Naver Map and Kakao Map directions first, Korean public datasets, mosques and prayer rooms, a guide to Korean dishes that usually contain pork or alcohol, key Korean phrases with audio, and a card to show restaurant staff (Korean, Japanese, Chinese, English, French)
- 7 UI languages (en, ko, ar with RTL, id, ms, tr, fr), localized map labels, dark mode, installable PWA with offline support, no tracking

**Deploy:** merge to `main`, then set *Settings → Pages → Source* to **GitHub Actions**. A push deploys in about two minutes from the last downloads; the daily run refreshes OpenStreetMap and, once a quarter, the Korean store registry.

**Contribute data:** add the place on OpenStreetMap with `diet:halal=yes|only` (it shows up within a day), or open an issue with the *Add a halal place* form.

Data © OpenStreetMap contributors (ODbL); Korean public data from data.go.kr (no usage restrictions); map tiles by OpenFreeMap / OpenMapTiles.
