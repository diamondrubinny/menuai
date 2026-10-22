# MenuAI — אפיון ותוכנית עבודה

> מערכת קוד פתוח (AGPL-3.0 + תנאי קרדיט) לבניית תפריטים רב־לשוניים, מעוצבים ברמת סטודיו, רספונסיביים לכל מסך (נייד, טאבלט, דסקטופ, מסך TV/קיוסק, הדפסה).

## 1. מטרת המוצר וערך עסקי

| נושא | פירוט |
|---|---|
| בעיה | מסעדות, בתי קפה, ברים, מלונות ואירועים צריכים תפריט יפה, מתורגם ונגיש — לרוב משלמים למעצב על כל שינוי מחיר או מנה. |
| פתרון | עורך ויזואלי בדפדפן: תוכן ← תבנית עיצוב ← אפקטים ← שפות ← ייצוא לקובץ HTML עצמאי / הדפסה / QR. |
| ערך | שינוי מחיר בשניות, תפריט ב־N שפות עם RTL אמיתי, עיצוב מקצועי בלי מעצב, אפס עלות שרת (קובץ סטטי). |
| משתמשים | בעל עסק / מנהל משמרת (עורך), אורח במסעדה (צופה), מפתח/סוכנות (מתקין, מרחיב תבניות). |

## 2. הנחות עבודה (MVP)

1. **שלב 1 ללא שרת** — הכל רץ בדפדפן, הנתונים נשמרים מקומית (localStorage) + ייבוא/ייצוא JSON. מקטין משטח תקיפה, אין מידע אישי, אין עלויות.
2. פרסום = ייצוא **קובץ HTML יחיד** (כולל גופנים, תמונות ו־CSS מוטמעים) שאפשר להעלות לכל אחסון סטטי (Netlify / Cloudflare Pages / GitHub Pages / שרת קיים).
3. אין תשלומים, אין הזמנות, אין משתמשים — עד שלב 2.
4. שפות ממשק העורך: עברית, אנגלית, ערבית (מבנה מאפשר להוסיף). שפות **תוכן** התפריט: כל שפה (רשימה של 30+ מובנית + תוויות ניתנות לעריכה לכל שפה).

## 3. User Stories

- כבעל עסק, אני רוצה להוסיף קטגוריות ומנות (שם, תיאור, מחיר, וריאציות מחיר, תמונה, תגיות, אלרגנים) כדי לבנות תפריט מלא.
- כבעל עסק, אני רוצה לבחור תבנית עיצוב ולשנות צבעים/גופנים/פריסה כדי שהתפריט יתאים למותג.
- כבעל עסק, אני רוצה להפעיל אפקטים (זכוכית, ניאון, גרדיאנט חי, גרעיניות, חשיפה בגלילה, הטיה תלת־ממדית) בלי לשבור נגישות.
- כבעל עסק, אני רוצה להוסיף שפות ולתרגם כל שדה, עם חזרה אוטומטית לשפת ברירת המחדל כשחסר תרגום.
- כבעל עסק, אני רוצה לראות תצוגה מקדימה בנייד/טאבלט/דסקטופ/TV לפני פרסום.
- כבעל עסק, אני רוצה לייצא קובץ HTML, להדפיס A4, ולהפיק QR לכתובת שבה העליתי את התפריט.
- כאורח, אני רוצה להחליף שפה בתפריט, לנווט בין קטגוריות במגע/מקלדת, ולראות אלרגנים בבירור.
- כמשתמש עם מוגבלות, אני רוצה לנווט עם מקלדת/קורא מסך, להגדיל ל־200% ולבטל אנימציות.

## 4. מסכים וזרימות

| מסך | Route | תיאור |
|---|---|---|
| עורך | `#/` | פאנל עריכה (תוכן / עיצוב / שפות / ייצוא) + תצוגה מקדימה חיה עם בורר מכשיר. בנייד: מעבר בין "עריכה" ו"תצוגה". |
| תצוגה מלאה | `#/view` | התפריט במסך מלא (קיוסק / טאבלט על השולחן). |
| הצהרת נגישות | `#/accessibility` | טיוטה. |
| פרטיות | `#/privacy` | טיוטה. |
| 404 | כל נתיב אחר | חזרה לעורך. |

זרימה: עורך → בחירת תבנית → עריכת תוכן → שפות → תצוגה מקדימה → ייצוא HTML / הדפסה / QR.

## 5. ארכיטקטורה

```
React 19 + TypeScript + Vite (SPA סטטי, ללא backend)
├── core/          לוגיקה טהורה ללא UI (סכמה, ולידציה, תרגום, מחירים, ייצוא) — נבדקת ביחידה
├── store/         מצב העורך (zustand) + Undo/Redo + שמירה מקומית עם ולידציה
├── renderer/      רכיב MenuRenderer טהור — משמש גם לתצוגה מקדימה וגם לייצוא (renderToStaticMarkup)
├── editor/        ממשק העורך
├── styles/        CSS: tokens של תבניות, אפקטים, container queries
└── pages/         נגישות, פרטיות, 404
```

**החלטות מפתח:**

| החלטה | למה | חלופות | מגבלות |
|---|---|---|---|
| React + Vite + TS | אקו־סיסטם רחב, SSR סטטי מובנה (`renderToStaticMarkup`) לייצוא | Svelte, Vue, Astro | גודל באנדל גדול יותר מ־Svelte |
| zustand | חנות קטנה, ללא boilerplate, קל ל־Undo | Redux Toolkit, Context | — |
| zod | אותה סכמה לולידציה של ייבוא, אחסון ועתידית ל־API | valibot, yup | — |
| Container Queries | התצוגה המקדימה של "טאבלט" באמת מתנהגת כמו טאבלט בתוך העורך, בלי iframe | Media queries + iframe | דפדפנים ישנים (לפני 2023) — fallback לפריסה של עמודה אחת |
| גופנים מ־@fontsource (self-hosted) | אין שליחת IP לגוגל (GDPR), עובד אופליין, מוטמע בייצוא | Google Fonts CDN | גודל קובץ הייצוא גדל (~100–400KB) |
| ייצוא HTML יחיד עם CSP ו־hash לסקריפט | אחסון בכל מקום, אין תלות בשרת שלנו | Hosting מנוהל (שלב 2) | עדכון = העלאה מחדש של הקובץ |

## 6. סכמת נתונים (גרסה 1)

```ts
Menu {
  schemaVersion: 1
  id: string
  defaultLocale: string            // "he"
  locales: string[]                // ["he","en","ar"]
  currency: string                 // ISO 4217 "ILS"
  title: Localized                 // { he: "...", en: "..." }
  subtitle: Localized
  footerNote: Localized
  logo?: ImageRef
  hero?: ImageRef
  sections: Section[]
  design: Design
  labels: Record<locale, Partial<Record<LabelKey,string>>>   // דריסת תוויות (אלרגנים, "אזל" ...)
  updatedAt: ISO string
}
Section { id, title: Localized, description: Localized, items: Item[], hidden?: boolean }
Item {
  id, name: Localized, description: Localized,
  price?: number, variants: { id, label: Localized, price: number }[],
  image?: ImageRef, tags: Tag[], allergens: Allergen[], spicy: 0..3,
  soldOut: boolean, hidden: boolean, calories?: number
}
ImageRef { src: string /* https: או data:image/(png|jpeg|webp) */, alt: Localized }
Design {
  theme: ThemeId, layout: "list"|"cards"|"magazine"|"showcase",
  palette overrides: { bg?, surface?, text?, muted?, accent?, accent2? },
  fontDisplay: FontId, fontBody: FontId,
  radius: 0..32, density: "compact"|"cozy"|"airy", scale: 0.85..1.3,
  effects: { reveal, glass, glow, aurora, grain, tilt, shimmer, parallax, leaders, ornaments },
  showImages, showAllergens, showLanguageSwitcher, stickyNav
}
```

שלב 2 (שרת): `Organization → Venue → Menu (versions) → Publication` + `User, Membership(role)`.

## 7. API (שלב 2 — לא נבנה ב־MVP)

| Method | Path | הרשאה |
|---|---|---|
| POST | `/api/auth/*` | ספק אימות מוכר (Auth.js / Clerk / Supabase Auth) + MFA לאדמינים |
| GET/POST | `/api/orgs/:orgId/menus` | חבר בארגון (בדיקת tenant בשרת) |
| GET/PUT/DELETE | `/api/orgs/:orgId/menus/:menuId` | editor/owner; בדיקת שייכות menu→org (מניעת IDOR) |
| POST | `/api/orgs/:orgId/menus/:menuId/publish` | owner |
| POST | `/api/orgs/:orgId/uploads` | editor; quarantine + ClamAV + re-encode |
| GET | `/m/:slug` | ציבורי (קריאה בלבד, cache, rate limit) |

## 8. Threat Model קצר (MVP)

| נכס | איום | סיכון | בקרה |
|---|---|---|---|
| התפריט בדפדפן | XSS דרך שם מנה / JSON מיובא | בינוני | React escaping, ייצוא דרך `renderToStaticMarkup`, אין `dangerouslySetInnerHTML` על תוכן משתמש, ולידציית zod לכל ייבוא |
| קובץ HTML מיוצא | הזרקת סקריפט / טעינת משאבים חיצוניים | בינוני | CSP קשיח עם `sha256` לסקריפט היחיד, `default-src 'none'`, תמונות רק `data:`/`https:` |
| תמונות | SVG זדוני / polyglot / EXIF עם מיקום | בינוני | רק PNG/JPEG/WebP, בדיקת MIME + פענוח בפועל, **re-encode דרך canvas** (מסיר EXIF ו־payload), הגבלת גודל |
| JSON מיובא | DoS (קובץ ענק), prototype pollution | נמוך | הגבלת 10MB, zod strict, `JSON.parse` בלבד |
| קישורי תמונה | מעקב/דליפת IP של אורחים | נמוך | אזהרה בממשק; מומלץ להעלות קובץ (מוטמע) |
| אפליקציית העורך | Clickjacking | נמוך | כותרות `X-Frame-Options`/`frame-ancestors` בקובץ `_headers` |

## 9. פרטיות, עוגיות, נגישות

- **אין עוגיות, אין אנליטיקה, אין צדדים שלישיים** ב־MVP. localStorage משמש רק לשמירת הטיוטה של המשתמש עצמו (פונקציונלי, ביוזמת המשתמש) — לא נדרש באנר הסכמה. *דורש אימות משפטי אם יתווספו כלי מדידה.*
- אין איסוף מידע אישי. תמונות שהמשתמש מעלה נשארות בדפדפן שלו.
- נגישות: יעד WCAG 2.1 AA / ת"י 5568: HTML סמנטי, ניווט מקלדת מלא, focus גלוי, `prefers-reduced-motion` + מתג ביטול אנימציות בתפריט, `lang`/`dir` לכל שפה, ניגודיות נבדקת בתבניות, אלרגנים מוצגים גם כטקסט (לא רק אייקון/צבע), יעדי מגע ≥ 44px.

## 10. מבנה תיקיות

```
menuai/
├── docs/PLAN.md, docs/legal/*.md
├── public/ (favicon.svg, robots.txt, _headers)
├── src/
│   ├── core/ schema.ts, locales.ts, labels.ts, i18n.ts, themes.ts, fonts.ts, format.ts,
│   │         localize.ts, images.ts, storage.ts, exportHtml.ts, sample.ts, ids.ts
│   ├── store/ menuStore.ts
│   ├── renderer/ MenuRenderer.tsx, menuRuntime.ts
│   ├── editor/ Editor.tsx, panels/*.tsx, fields/*.tsx, DevicePreview.tsx
│   ├── pages/ AccessibilityPage.tsx, PrivacyPage.tsx, NotFound.tsx, ViewPage.tsx
│   ├── styles/ app.css, menu.css
│   ├── App.tsx, main.tsx
├── tests/ *.test.ts(x), e2e/*.spec.ts
└── .github/workflows/ci.yml
```

## 11. תוכנית שלבים

| שלב | תוכן | סטטוס |
|---|---|---|
| **1 — MVP מקומי** | סכמה, עורך מלא, 10 תבניות, 10 אפקטים, 4 פריסות, 30+ שפות תוכן, RTL, תצוגת מכשירים, Undo/Redo, ייבוא/ייצוא JSON, ייצוא HTML עצמאי, הדפסה, QR, בדיקות יחידה + e2e + axe | **הושלם** ✅ |
| 2 — Cloud | Backend (Postgres + Auth + RBAC multi-tenant), פרסום לכתובת קבועה, היסטוריית גרסאות, העלאות עם סריקת וירוסים | ממתין לאישור |
| 3 — AI | תרגום אוטומטי / ניסוח תיאורים (BYO API key, הסכמה מפורשת לשליחת תוכן לספק) | ממתין לאישור |
| 4 — Signage | מצב TV עם סבב קטגוריות אוטומטי, תזמון תפריטים (בוקר/ערב), Happy Hour | ממתין לאישור |

## 12. סיכונים

- **גודל קובץ ייצוא** עם תמונות רבות — מוקטן ע"י re-encode ל־WebP 1200px; אזהרה מעל 8MB.
- **localStorage מוגבל (~5MB)** — תמונות רבות עלולות לחרוג; מוצגת שגיאה ידידותית + המלצה לייצא JSON. שלב 2: IndexedDB / שרת.
- **גופנים לשפות CJK/תאילנדית/הודיות** — לא מוטמעים (נפח); נופלים לגופן מערכת. ניתן להרחיב ב־`fonts.ts`.
- **תרגומי תוויות** (אלרגנים וכו') ל־10 שפות מובנים; לשאר — אנגלית כברירת מחדל + עריכה ידנית. *מומלץ בדיקת דובר שפת אם.*
- **דרישות חוקיות על אלרגנים/מחירים** משתנות לפי מדינה — *דורש בדיקה משפטית*.
