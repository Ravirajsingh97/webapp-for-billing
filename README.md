# Showroom Manager — Billing Edition (Web App / PWA)

MyBillBook जैसा **showroom billing app** — GST invoice, estimate, barcode billing, stock aur reports.
Offline चलता है; data आपके phone/browser में रहता है। Staff PIN login और Firebase cloud sync optional हैं।

यह repository अपने आप में पूरा web app है — किसी दूसरे folder में जाने की ज़रूरत नहीं। Phone में "Add to Home screen" करके इसे
native app की तरह install किया जा सकता है।

---

## ✨ क्या-क्या है (Billing strong)

### 🧾 Billing (मुख्य)
- **Tax Invoice / पक्का बिल (GST)** — CGST+SGST या IGST (place of supply के हिसाब से) automatic
- **Estimate / Quotation**, **Proforma Invoice**, **Delivery Challan**, **Bill of Supply** (बिना GST), **Credit Note / Sales Return**
- **Item-wise discount % + Bill-level discount** (₹ या %), extra charges (freight/hamali), round-off
- **Barcode / quick billing** — barcode scan करके या नाम/code से item tap करके 2 second में bill
- USB/Bluetooth barcode scanner (keyboard-type) भी चलता है — code box में type करके Enter
- **Bill number series** per document type — जैसे `INV/25-26/001`, `EST/25-26/007` (Settings से बदल सकते हैं)
- **Payment tracking** — पूरा paid / आधा / **उधार (credit)**; cash, UPI, card, bank, cheque
- **WhatsApp पर bill** — पूरे bill का text message, या bill की **image** (native share sheet)
- **UPI QR** — बाकी amount का QR bill पर छपता है (PhonePe/GPay/Paytm scan करके pay)
- **Print / PDF** — A4 invoice (professional layout) और **80mm thermal printer** layout
- Estimate → Tax Invoice **convert**, bill duplicate, credit note बनाना, bill cancel (stock वापस) / delete

### 📦 Items & Stock
- Item master: code, barcode, brand, category, sub-category, HSN, unit, MRP, discount %, GST %, purchase rate, stock, low-stock alert
- Sale price + **margin per piece** live calculation
- Stock खुद कट जाता है bill पर (cancel/credit note पर वापस जुड़ जाता है)
- **CSV import/export** (Excel) — Android app की पुरानी CSV file भी चलती है; template भी download हो सकता है

### 📥 Purchase (supplier se maal)
- **Purchase Bill** — supplier का bill अपनी दुकान के नाम से लिखें, **stock अपने आप बढ़ता है**
- GST उसी तरह लगता है (intra-state → CGST/SGST, दूसरे state का supplier → IGST)
- Supplier का **payable** अपने आप बनता है; आधा/पूरा payment दर्ज करें
- Purchase rate से item का **cost (purchase price) update** कर सकते हैं
- अपना bill number series: `PUR/25-26/001`

### 👥 Khata / Parties
- Customer & Supplier list, **किसका कितना बाकी है** (udhaar khata)
- Customer: *lena hai* / *advance jama*; Supplier: *dena hai* / *advance diya*
- Ledger — party के सारे bills, total business, paid, बाकी
- **WhatsApp payment reminder** एक tap में (customer को माँगने, supplier को हिसाब clear करने)
- Opening balance (पुराना बकाया) support

### 💸 Payments In / Out (रोज़ का cash register)
- Seedha **payment entry** — customer से पैसा आया या supplier को दिया
- किसी **bill के against** लिखें (उस bill का "बाकी" भी update हो जाएगा) या **on-account / advance**
- Mode: Cash, UPI, Card, Bank, Cheque + note (UPI ref/cheque no.)
- Period filter (आज / 7 दिन / महीना / FY / custom), **mode-wise total**, entry delete
- Register में bill-wise और khata-wise — दोनों payments एक जगह

### 🧾 Expenses (दुकान का खर्चा)
- 9 ready categories: kiraya, staff/salary, बिजली-मोबाइल, transport, packing, marketing, repair, chai-paani, other
- Category-wise **bar chart**, mode-wise summary, period filter, CSV export
- **Net profit = sale profit − kharcha** (Reports में दिखता है)

### 📊 Reports
- Net sale, taxable value, GST collected, discount, gross profit, **purchase total** aur **kharcha**
- **Net profit** (sale profit − kharcha) — asli kamai ka andaza
- **Din-wise sale chart** aur **mahine-wise sale vs purchase** chart
- Top items, top parties, payment-mode summary, document-type summary
- **Udhaar Aging report** — 0–30, 31–60, 61–90, 90+ दिन (lena hai / dena hai), on-account payments adjust hoke; CSV export
- **Day book** — किसी भी दिन का पूरा हिसाब: bills + payments + kharcha, CSV export
- **GST / HSN summary** (GSTR-1 जैसा) — CGST/SGST breakdown
- Stock value report + low-stock list
- सब reports **CSV export** (sales register, GST summary, item-wise, party-wise, aging, day book)

### ☰ More (ek hi jagah se sab)
- Koi bhi document banayein (7 types), khata, payments, expenses, reports, settings — sab ek tap par
- Receivable / payable / mahine ki sale / low stock — ek nazar me
- दुकान की details (नाम, address, phone, GSTIN, state, UPI ID, bank) + **logo & signature upload**
- Per-document number series, default terms & conditions
- **Backup / restore** (JSON file) + full data reset
- App install (PWA) button

---

## 🚀 चलाने का तरीका (development)

```bash
npm ci              # repeatable install (पहली बार)
npm run dev         # http://localhost:5173
```

दूसरे device/network से खोलने के लिए server पहले से `0.0.0.0` पर bind है।

### 📐 Responsive UI

UI को छोटे **320px mobile**, tablet और बड़े PC/desktop के लिए responsive रखा गया है:

- mobile पर dense forms single-column हो जाते हैं, touch targets कम-से-कम 44px रहते हैं और sheets safe-area के साथ खुलती हैं;
- tablet पर cards और item catalogue दो/तीन columns में फैलते हैं;
- desktop पर POS catalogue + cart side-by-side रहता है, item grid में ज़्यादा columns आते हैं और invoice preview
  container की width के हिसाब से scale होता है;
- GST/HSN और aging जैसी wide tables mobile पर horizontal scroll होती हैं, page को बाहर नहीं धकेलतीं।

Production build:

```bash
npm run build      # dist/ बनेगा (offline PWA + service worker के साथ)
npm run preview    # build को local test
```

## 📱 Phone में app की तरह install कैसे करें
1. App को Android **Chrome** में खोलें (HTTPS link होना चाहिए)
2. Menu (⋮) → **“Install app” / “Add to Home screen”**
3. Home screen पर 🏪 icon आ जाएगा — बिना internet भी खुलेगा

> Data browser storage (IndexedDB) में रहता है। इसलिए महीने में एक बार
> **Settings → Backup** से JSON file ज़रूर निकाल लें। Browser data clear करने पर data चला जाएगा।

## 🖥️ Preview / static build (node_modules ke bina bhi chalta hai)

Kuch environments (jaise sandbox/CI) `node_modules` ko save nahi rakhte — us case me dev server
(`npm run dev`) band ho sakta hai. Isliye ek **pre-built static** version bhi rakha jaata hai:

```bash
npm run build:preview     # dist build karke preview-build/ folder banata hai
npm run serve:static      # http://localhost:4173  (build ke baad)
```

Build hone ke baad `preview-build/` folder kisi bhi static hosting (ya `python3 -m http.server`)
se serve ho jata hai — app wahi pura kaam karta hai (offline bhi, kyunki service worker saath aata hai).
Windows par serve karne ke liye `npx serve preview-build` ya VS Code ka Live Server bhi chalega.

## 🤖 CodeRabbit पर review / coding task चलाने का तरीका

इस repo में CodeRabbit के लिए root में `.coderabbit.yaml`, Node 22 के लिए `.nvmrc`,
और PR checks के लिए `.github/workflows/webapp-ci.yml` मौजूद हैं। CodeRabbit को install करने के लिए
README में कोई secret, API key या Firebase config डालने की ज़रूरत नहीं है।

### पहली बार setup

1. [coderabbit.ai](https://coderabbit.ai) पर GitHub से sign in करें और **Add repository** में
   `Ravirajsingh97/webapp-for-billing` चुनें। GitHub में **Settings → Integrations → GitHub Apps →
   CodeRabbit → Configure** खोलकर भी पक्का करें कि यही repository selected है।
2. CodeRabbit का **Coding Agent** इस्तेमाल करना हो तो [CodeRabbit Code](https://app.coderabbit.ai/code)
   में इस repository और `main` branch को चुनें। Automatic environment में Node **22** रखें;
   ज़रूरत पड़े तो setup command `npm ci` और startup/verification command `npm run verify` दें।
3. CodeRabbit सामान्यतः **pull request (PR)** पर review करता है, सीधे `main` पर push करने से नहीं।
   PR को draft न रखें; README-only/documentation PR भी review हो सकता है। Review न आए तो PR में
   `@coderabbitai review` comment करें।

### इस repo में change करके PR बनाना

```bash
git checkout -b my-change       # अपनी feature branch का नाम
git add .
git commit -m "Describe the change"
git push -u origin my-change
```

फिर GitHub में **Compare & pull request** खोलकर base branch `main` चुनें। PR खुलने के बाद CodeRabbit
review summary और inline comments देगा। Review comments ठीक करके उसी branch पर फिर push करें; CodeRabbit
incremental review चला देगा।

> **“Task failed: Something went wrong while running this task”** अगर task शुरू होने से पहले ही आता है,
> तो यह README या app code की error नहीं, अक्सर CodeRabbit GitHub App की repository access/permissions या
> Coding Environment की setup समस्या होती है। पहले सही repo selected है या नहीं देखें, task को `main` से
> दोबारा शुरू करें, Node 22 + `npm ci` रखें, और stale/closed PR की जगह नया non-draft PR try करें। फिर भी
> error रहे तो CodeRabbit में repository को remove करके दोबारा add/reconnect करें।

### ☁️ Cloud account (Google / Email) + data sync

MyBillBook jaisa: **login karein → company ka pura data cloud me sync** → doosre phone me usi account se login
karte hi sab wapas mil jata hai (items, bills, khata, payments, expenses, bill numbering).

Setup **ek baar** karna padta hai (free Firebase project, ~5 min) — app ke andar hi poora guide hai:
**Settings → ☁️ Cloud account → "Cloud setup karein"**

1. https://console.firebase.google.com → **Add project**
2. **Authentication → Get started** → **Email/Password** enable (Google login ke liye **Google** bhi)
3. **Firestore Database → Create database** → Production mode → **asia-south1**
4. Firestore **Rules** me ye paste karke Publish karein:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{db}/documents {
       match /showroomUsers/{uid}/{doc=**} {
         allow read, write: if request.auth != null
                            && request.auth.uid == uid;
       }
     }
   }
   ```

5. **Project settings → Your apps → Web** → `firebaseConfig` copy karke app me paste karein
6. **Authentication → Settings → Authorized domains** me apni site ka domain add karein

Uske baad **Login / Sign up** — email+password ya **Google se login** (browser me). Auto-sync on ho to login ke baad sync khud
chalta hai (local changes ke baad debounce + har 3 minute me), aur "Saari companies sync" se ek hi baar me sab companies sync ho jati hain.

**Sync kaise kaam karta hai**

- Chhota snapshot `showroomUsers/{uid}/companies/{companyId}` me jata hai. Bade snapshots immutable chunks me save hote hain; company document ka manifest tabhi update hota hai jab saare chunks upload ho jaate hain. Purane single-document backups bhi padhe ja sakte hain. Unchanged large snapshots reuse their content-addressed chunk paths; older generations are retained for concurrent readers.
- Har record ki stable sync identity hoti hai. Legacy backups natural key se migrate hote hain; legacy invoices ke liye creation time bhi identity ka hissa hai. Same bill number wale alag documents preserve hote hain. Local ID clashes aur invoice/party/item links remap hote hain; backup merge bhi wahi safe remapping use karta hai; merge ek transaction me hota hai. Deletion markers deleted records ko stale snapshots se wapas aane se rokte hain.
- Har company ka data alag — ek account me multiple firms, jaise MyBillBook me.
- Offline-first: internet na ho to app waise hi chalti hai; sync baad me ho jata hai.
- APK (WebView) me Google login Google ki policy se block hai — wahan **email/password** se login karein
  (web app me Google button chalta hai).

Technical: `src/lib/cloud.ts` (Firebase Auth + Firestore REST, koi SDK nahi — bundle chhota rehta hai) aur
`src/lib/sync.ts` (snapshot + merge). Smoke test me mock Firebase se poora flow verify hota hai.

### 🔐 Users & login (offline)

- Settings → **👤 Users & login** → naya user banayein (naam, role, 4-6 ank ka PIN).
- **Jab tak koi user na bane, app bina login khulti hai** — pehla user banate hi current tab bhi lock hota hai. Disabled/malformed users login ko automatically band nahi karte.
- Owner aur staff ka PIN sirf **logged-in owner** Settings se badal sakta hai. Login screen se PIN reset nahi hota. Pehla user hamesha owner hota hai; aakhri active owner ko disable/delete nahi kar sakte.
- PIN ka salted PBKDF2-SHA256 hash (210,000 iterations) phone me rehta hai. Purane hashes successful login par migrate hote hain. Secure Web Crypto unavailable ho to naya PIN save nahi hota. Session tab band hone par ya 8 ghante baad expire hota hai; PIN changes existing sessions revoke karte hain. Paanch wrong attempts ke baad ek minute lockout hota hai.

### 🏢 Company / Firm (multi-company)

- Settings → **🏢 Company / Firm** → **switch** ya **＋ Nayi company** banayein.
- Har company ka **pura data alag** hota hai (alag IndexedDB database): items, bills, khata, payments, expenses, users.
- Nayi company **khaali** shuru hoti hai (sample items sirf pehli company me aate hain) aur uska naam onboarding me apne aap aa jata hai.
- Company switch karte hi app reload hoti hai aur us company ka data khul jata hai.

### 📄 Ek hi file wala version (single-file HTML)
Kuch jagah (preview iframe, purane phone browser, WhatsApp par share) ke liye ek hi file sabse aasan hai:

```bash
npm run build:single      # banata hai: showroom-manager-app.html  (~790 KB)
```

Us ek file me **pura app** (JS + CSS) inline hai. Ise:
- kisi bhi browser me seedha khol sakte hain (double-click / file:// bhi chalta hai),
- WhatsApp/email par bhej sakte hain,
- kisi bhi static hosting par daal sakte hain.

Data usi browser me (IndexedDB) save hota hai, isliye ek hi browser me use karein.

## 🌐 Deploy
`npm run build` के बाद `dist/` को किसी भी static hosting पर publish किया जा सकता है। Vite में relative base
रखा गया है, इसलिए GitHub Pages जैसे sub-path पर भी build चलता है। GitHub Actions का
`.github/workflows/webapp-ci.yml` हर `main` push और PR पर typecheck, smoke test और production build चलाता है।
Pages deploy करने के लिए repository Settings → Pages में अपनी पसंद का deploy workflow/branch चुनें।


## 🧪 Testing (smoke test)

Poore billing flow ka automated test hai (jsdom + fake IndexedDB) — isi se data layer aur UI dono check hote hain.

Repo root se:

```bash
npm run smoke
npm run verify     # TypeScript + smoke suite
```

`npm ci` के बाद test packages lockfile से deterministic तरीके से install होते हैं। Har run ant me actual
passed/total check count dikhata hai.

### ⚠️ Phir bhi nahi chala? Ye 3 cheezein check karein

| Error | Wajah | Fix |
| --- | --- | --- |
| `npm: command not found` | Node.js install nahi hai | Node 22 install karein: https://nodejs.org (ya `winget install OpenJS.NodeJS` / `brew install node`) |
| `npm ERR! network` / install fail | internet/proxy ya company firewall | mobile hotspot se try karein, ya `SMOKE_NO_INSTALL=1` ke saath manual `npm install` |
| `Missing script: "smoke"` | aap purane commit/branch par hain | `git pull origin main` करें, फिर repo root में command चलाएँ |
| `Node ... is not supported` | Node purana (20 se kam) | Node 22 install karein |

**Terminal hi nahi chahiye?** App ke andar hi self-test hai: **Settings → 🧪 App self-test** (browser me,
bill banake, payment lekar, purchase karke — aur ant me sab rollback).

GitHub par `main` par push ya `main` ko target karne wale PR ke saath ye test apne aap (clean environment me)
chalta hai — workflow: `.github/workflows/webapp-ci.yml` → tab **Actions → Web App CI** me result dikhta hai.

### 🧪 App ke andar wala self-test (bina terminal)
**Settings → 🧪 App self-test** dabayein. Ye usi billing engine ko browser me chalata hai (checks:
GST maths, bill number series, stock kam/zyada, payment, khata balance, purchase payable, credit note,
CSV, backup, expenses, aging) aur **ant me sab kuch rollback** kar deta hai — aapka asli data bilkul safe.

Suite ye workflows check karti hai: invoice maths (GST/CGST/SGST/IGST, bill discount, round off), number series,
stock cut/restore, payment recording, khata balance, credit note, **purchase bill (stock IN + payable)**,
**payments in/out register**, **expenses**, **udhaar aging**, CSV import/export, backup-restore,
aur UI flow (home → items → reports → billing → item add → save → invoice view → print → UPI QR → payment →
More → payments → expenses → reports → purchase bill).

## 🧱 Tech
Vite + React 19 + TypeScript + Tailwind CSS 4 + Dexie (IndexedDB) + vite-plugin-pwa + qrcode.react + html2canvas-pro

```
src/
  lib/        types, db (Dexie), repo (billing + khata + purchase + expenses + aging), calc (GST maths), format, doc, csv, print
  components/ UI primitives, InvoicePaper (A4 + thermal), BarcodeScanner, pickers
  screens/    Home, Billing, InvoiceView, Invoices, Items, Parties, Payments, Expenses, Reports, More, Settings, Onboarding
```

## 🗄️ Database versions
- **v1** — business, items, parties, invoices, docSettings, appSettings
- **v2** — payments (khata in/out), expenses (migrate apne aap hota hai, data safe rehta hai)

### Regression coverage

`smoke/regressions.ts` also verifies consecutive UI invoice numbering, cancellation/deletion stock effects, payment-date filtering, atomic replacement restore, sync ID collisions and links, deletion propagation, owner-only PIN changes, CSV delimiters, and chunked cloud snapshots including interrupted uploads. The Firebase checks use synthetic fetch mocks; real provider configuration and physical printers need deployment testing.

Database **v4** adds deletion markers; existing company data is upgraded in place. Backups include markers. Reinstalling an older app version after this database upgrade is not supported.

## POS, OCR and responsive layout

Home / More → **POS** opens a searchable catalogue, barcode input, customer selection and cart. Checkout records a paid or customer-credit sale through the existing invoice/stock engine and opens the printable receipt. POS shows the full MRP and starts each new item with a blank discount field and no discount applied, even if the catalogue has a saved discount. Enter an item discount percentage only when needed; clearing the field removes it. POS has no extra bill discount. Manual item discounts apply to that sale only. Use the detailed bill editor for rates or partial payment.

Home / More → **Scan bill (OCR)** reads printed JPG/PNG/WebP bills locally with Tesseract.js. English and Hindi are supported; downloading the OCR engine/language requires internet (including for the single HTML build). PDFs and handwriting are not supported. Text stays editable. Only rows shaped like `Name Qty Rate Amount` with matching arithmetic become suggestions; GST starts at zero and must be checked. OCR never saves a bill automatically. Suggestions have no inventory link: replace them with catalogue items in the draft to update stock. Retained OCR source text appears in bill notes; edit/remove it before printing as needed.

Layouts adapt from 320px phones through tablets to 1440px desktops, support landscape, keep forms readable, and use a split catalogue/cart on large screens. Camera barcode support depends on the browser; manual entry and keyboard scanners remain available. A4 and thermal printing retain their original paper sizes.

## Payment, stock and sync safeguards

Invoice and item editors reject stale saves after another tab/device changes the record. Close and reopen the editor to load the latest version before applying your edit. Payments are recorded atomically, merged by entry ID, and deleted using retained removal markers.

Stock uses an opening quantity, uniquely identified manual adjustments, and the movements from active invoices. Independent offline sales and adjustments therefore survive sync without applying a movement twice. Fractional stock supports six decimal places. Legacy stock is initialized from the saved quantity and historic invoices; keep all syncing devices on this app version so older versions do not publish incompatible stock edits.

A converted delivery challan and its tax invoice represent one delivery: the active tax invoice controls stock while the challan is suppressed. Cancelling/deleting the invoice returns responsibility to an active challan; cancelling both restores stock. A second active conversion is rejected. If you change delivery quantities after conversion, edit the active tax invoice.

Home, More and aging use the party ledger, including opening balances, credit notes and standalone receipts/payments. Opening balances have no original transaction date and appear in the 90+ day bucket. Today's cash/UPI totals use payment dates and subtract outgoing payments. Discounts allocate exact paise; printed HSN summaries separate GST rates and purchase documents do not show the shop's collection QR.

Cloud snapshot publication checks the Firestore server revision and retries a conflicting pull/merge/upload up to three times. A continuing conflict displays an error and can be retried. Regression coverage includes these conflicts using a synthetic Firestore server; real Firebase permissions/OAuth and physical printing still require deployment checks.

## Login and cloud security / automation

- Login check/storage failure keeps the app locked. Onboarding is behind the gate. User mutations recheck open tabs; focus and a 30-second check also enforce session expiry. PIN reset, user administration, Settings/cloud controls and backup export/restore/reset require an owner when users are configured. Company switching remains available while locked, but company creation/rename controls require owner access.
- Local PIN login protects ordinary app use on a shared device. It does **not** encrypt IndexedDB, prevent browser developer tools/storage tampering, or establish server-side staff roles. Firebase Auth and the documented UID-based Firestore rules provide cloud account isolation. Keep those rules deployed; never use public read/write rules for this app.
- A local company becomes bound to the Firebase project/account used for sync. Another project/account cannot merge into that company. Use the original account or a separate company/browser profile. Changing Firebase configuration clears the old cloud session. Late login/refresh responses after logout are discarded, and revoked refresh tokens clear the session.
- Auto-sync off suppresses automatic startup/login/write-triggered work; explicit Sync buttons still work. Visible online tabs sync after a two-second write debounce (continuous writes flush within ten seconds), on reconnection/resume, and every three minutes after completion. Failures back off from five seconds up to five minutes. Hiding a tab or going offline pauses new work; an already dispatched request may finish.
- Sync calls for the same account/company/scope share one pending operation. Provider requests have a 30-second timeout including response-body reading. Token refresh uses one shared request. Unchanged registry/snapshots skip publication; large snapshot chunks transfer in batches of four and the manifest is published only after all uploads succeed.
- Sync still reads whole company snapshots and retains old chunk generations/deletion markers. Very large stores need a separate incremental-sync/retention design; this change does not remove historical cloud data.
