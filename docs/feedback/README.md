# Feedback endpoint (owner form and "is this right?" votes)

The site sends restaurant submissions and visitor votes to a small Google Apps
Script web app, which writes them to a Google Sheet you own. It is free and
needs no server. Until it is set up, the form opens a prefilled GitHub issue
instead, and votes are only remembered on the visitor's device.

## Setup (about 5 minutes)

1. Create a new Google Sheet, for example "Muslimfood feedback".
2. **Extensions → Apps Script**. Delete the sample code and paste all of
   [`Code.gs`](Code.gs). Save.
3. **Deploy → New deployment → Select type: Web app**
   - Description: `Muslimfood feedback`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Press **Deploy** and allow access. Google warns that the app is
   unverified because you wrote it: choose *Advanced → Go to … (unsafe)*.
5. Copy the **Web app URL** (`https://script.google.com/macros/s/…/exec`) and
   put it in [`assets/js/config.js`](../../assets/js/config.js):

   ```js
   export const FEEDBACK_URL = 'https://script.google.com/macros/s/…/exec';
   ```

The sheets `places` and `votes` are created on the first submission. New
restaurant submissions are e-mailed to you (set `NOTIFY_NEW_PLACES = false` in
`Code.gs` to stop that). Mark a row's `status` column `added` or `rejected`
once you have handled it.

After changing `Code.gs`, use **Deploy → Manage deployments → Edit → Version:
New version**, so the URL stays the same.

## What is stored

- `places`: what the visitor typed in the form, the UI language and the map
  centre (rounded to about 10 m). The contact field is for you only; never copy
  it to OpenStreetMap or the site.
- `votes`: place id and name, yes/no, the reason and note, and the place's
  coordinates. No IP address, account or device id is available to the script.

---

## 설정 방법 (한국어, 약 5분, 무료)

1. 구글 시트를 새로 만듭니다 (예: "Muslimfood feedback").
2. **확장 프로그램 → Apps Script**에서 기본 코드를 지우고 [`Code.gs`](Code.gs) 전체를 붙여 넣은 뒤 저장합니다.
3. **배포 → 새 배포 → 유형 선택: 웹 앱**
   - 실행 사용자: **나**
   - 액세스 권한: **모든 사용자**
4. **배포**를 누르고 권한을 허용합니다. "확인되지 않은 앱" 경고가 나오면 *고급 → (안전하지 않음)으로 이동*을 누릅니다. 직접 만든 스크립트라서 나오는 경고입니다.
5. 표시되는 **웹 앱 URL**(`https://script.google.com/macros/s/…/exec`)을 복사해 `assets/js/config.js`의 `FEEDBACK_URL`에 넣거나, 저에게 보내 주세요.

새 식당 등록이 들어오면 메일로 알려 드립니다. 처리한 줄은 `status` 열을 `added` 또는 `rejected`로 바꿔 두세요. 코드를 고친 뒤에는 **배포 관리 → 수정 → 새 버전**으로 배포해야 URL이 그대로 유지됩니다.
