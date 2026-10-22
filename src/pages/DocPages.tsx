import { useEffect, type ReactNode } from 'react';
import { useT } from '../i18n/ui';
import { REPO_URL } from './SiteFooter';

const UPDATED = '2026-10-22';

function DocShell({ children, lang }: { children: ReactNode; lang: string }) {
  const { t } = useT();
  useEffect(() => {
    document.getElementById('main')?.focus();
  }, []);
  return (
    <main className="doc-page" id="main" tabIndex={-1} lang={lang} dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <p><a href="#/">← {t('backToEditor')}</a></p>
      <p className="draft-notice" role="note">{t('draftNotice')}</p>
      {children}
    </main>
  );
}

export function AccessibilityPage() {
  const { lang } = useT();
  if (lang === 'he') {
    return (
      <DocShell lang="he">
        <h1>הצהרת נגישות</h1>
        <p>עודכן לאחרונה: {UPDATED}</p>
        <h2>מחויבות לנגישות</h2>
        <p>
          MenuAI הוא פרויקט קוד פתוח שנבנה מתוך מחויבות לאפשר לכל אדם, ובכלל זה לאנשים עם מוגבלות, לבנות תפריטים ולקרוא אותם באופן שוויוני ועצמאי.
          אנו שואפים לעמוד בהנחיות WCAG 2.1 ברמה AA ובדרישות התקן הישראלי ת״י 5568.
        </p>
        <h2>התאמות שבוצעו</h2>
        <ul>
          <li>מבנה HTML סמנטי, היררכיית כותרות תקינה ואזורי ניווט (landmarks).</li>
          <li>ניווט מלא במקלדת, כולל לשוניות עם מקשי חיצים, קישור "דילוג לעורך" וסימון מיקוד (focus) בולט.</li>
          <li>תמיכה מלאה בכתיבה מימין לשמאל, והגדרת שפה וכיווניות (lang/dir) לכל טקסט, בכל שפה.</li>
          <li>כל ערכות העיצוב נבדקות אוטומטית ועומדות בניגודיות של 4.5:1 לפחות, והעורך מתריע כשצבעים שנבחרו ידנית יוצרים ניגודיות נמוכה.</li>
          <li>האנימציות נעצרות כשבמכשיר מוגדרת העדפה להפחתת תנועה, ובתפריט עצמו יש כפתור להפחתת תנועה.</li>
          <li>אלרגנים ותגיות מוצגים גם כטקסט, ולא רק באמצעות סמל או צבע.</li>
          <li>אזורי לחיצה בגודל 44 פיקסלים לפחות, ותמיכה בהגדלת התצוגה עד 200%.</li>
          <li>אפשרות להזין טקסט חלופי (alt) לכל תמונה, בכל שפה.</li>
        </ul>
        <h2>מגבלות ידועות</h2>
        <ul>
          <li>הנגישות של התוכן שמוזן לתפריט (טקסט חלופי לתמונות, צבעים שנבחרו ידנית) היא באחריות מי שיוצר את התפריט.</li>
          <li>אפקט הפרלקסה פועל רק בדפדפנים שתומכים ב־scroll-driven animations. בדפדפנים אחרים התוכן מוצג כרגיל, בלי האפקט.</li>
          <li>התצוגה המקדימה של המכשירים מוקטנת. לבדיקה מלאה מומלץ לפתוח את התפריט ב"תצוגה במסך מלא".</li>
        </ul>
        <h2>פניות בנושא נגישות</h2>
        <p>
          נתקלתם בבעיה? נשמח לשמוע עליה. אפשר לפתוח פנייה במאגר הקוד: <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">{REPO_URL}/issues</a>.
          אנו שואפים להשיב תוך 14 ימי עסקים לכל היותר.
        </p>
        <p className="muted">לפני פרסום באתר מסחרי יש להוסיף את פרטי רכז/ת הנגישות ודרכי התקשרות נוספות.</p>
      </DocShell>
    );
  }
  return (
    <DocShell lang="en">
      <h1>Accessibility statement</h1>
      <p>Last updated: {UPDATED}</p>
      <h2>Our commitment</h2>
      <p>
        MenuAI is an open-source project built so that everyone, including people with disabilities, can create and read menus independently.
        We aim to conform to WCAG 2.1 level AA and the Israeli Standard IS 5568.
      </p>
      <h2>What we have done</h2>
      <ul>
        <li>Semantic HTML, a correct heading hierarchy and landmarks.</li>
        <li>Full keyboard support, including arrow-key tabs, a “skip to editor” link and a clearly visible focus indicator.</li>
        <li>Full right-to-left support and per-language lang/dir attributes.</li>
        <li>All built-in themes are automatically tested for at least 4.5:1 contrast; the editor warns about low-contrast custom colors.</li>
        <li>Animations stop when the system “reduce motion” preference is set, and every menu includes a “reduce motion” button.</li>
        <li>Allergens and tags are shown as text, never by icon or color alone.</li>
        <li>Touch targets of at least 44 px; usable at 200% zoom.</li>
        <li>Alternative text (alt) for every image, in every language.</li>
      </ul>
      <h2>Known limitations</h2>
      <ul>
        <li>Accessibility of the content entered (alt text, custom colors) is the responsibility of the menu author.</li>
        <li>The parallax effect only runs in browsers that support scroll-driven animations; others show the content without it.</li>
        <li>Device previews are visually scaled; use “Open full-screen view” for complete testing.</li>
      </ul>
      <h2>Contact</h2>
      <p>
        Found a problem? Please open an issue: <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">{REPO_URL}/issues</a>.
        Target response time: 14 business days.
      </p>
      <p className="muted">Add the accessibility coordinator’s name and contact details before publishing on a commercial website.</p>
    </DocShell>
  );
}

export function PrivacyPage() {
  const { lang } = useT();
  if (lang === 'he') {
    return (
      <DocShell lang="he">
        <h1>מדיניות פרטיות</h1>
        <p>עודכן לאחרונה: {UPDATED}</p>
        <h2>בקצרה</h2>
        <p>
          העורך של MenuAI פועל כולו בדפדפן שלכם. אין לנו שרת שאוסף נתונים, ואיננו משתמשים בעוגיות, בכלי מדידה, בפיקסלים או בשירותי צד שלישי.
        </p>
        <h2>אילו נתונים נשמרים ואיפה</h2>
        <ul>
          <li><strong>טיוטת התפריט</strong> (טקסטים, מחירים, תמונות שהעליתם, הגדרות עיצוב) — נשמרת רק בדפדפן שלכם (localStorage), כדי שלא תאבד בין ביקור לביקור. היא נמחקת כשמנקים את נתוני האתר בדפדפן.</li>
          <li><strong>העדפת שפת ממשק</strong> — נשמרת ב־localStorage.</li>
          <li>תמונות שאתם מעלים מעובדות במכשיר עצמו (הקטנה והסרת נתוני EXIF, כמו מיקום GPS), ואינן נשלחות לשום שרת.</li>
          <li>הגופנים נטענים מהאתר עצמו (self-hosted), ולא נשלחת שום בקשה ל־Google Fonts.</li>
        </ul>
        <h2>תפריטים שאתם מפרסמים</h2>
        <p>
          קובץ ה־HTML המיוצא אינו כולל עוגיות או כלי מעקב. אם תשתמשו בקישורים לתמונות חיצוניות (https), הדפדפן של האורח יפנה לשרת שבו התמונה מאוחסנת, והשרת עשוי לראות את כתובת ה־IP של האורח.
          מי שמפרסם את התפריט אחראי לאחסון שלו ולכל כלי שיוסיף לקובץ.
        </p>
        <h2>זכויותיכם</h2>
        <p>כל הנתונים נמצאים אצלכם: אפשר לייצא אותם (JSON), לתקן או למחוק אותם בכל עת, דרך העורך או דרך הגדרות הדפדפן.</p>
        <p className="muted">טיוטה טכנית: לפני פרסום נדרשת בדיקה משפטית (חוק הגנת הפרטיות ותיקון 13, GDPR), ובמיוחד אם יתווספו שרת, חשבונות משתמש או כלי מדידה.</p>
      </DocShell>
    );
  }
  return (
    <DocShell lang="en">
      <h1>Privacy policy</h1>
      <p>Last updated: {UPDATED}</p>
      <h2>In short</h2>
      <p>The MenuAI editor runs entirely in your browser. We run no data-collecting server and use no cookies, analytics, pixels or third-party services.</p>
      <h2>What is stored, and where</h2>
      <ul>
        <li><strong>Your menu draft</strong> (texts, prices, uploaded images, design settings) — stored only in your browser’s localStorage so it survives between visits. Clearing site data removes it.</li>
        <li><strong>Interface language preference</strong> — stored in localStorage.</li>
        <li>Uploaded images are processed locally (resized, EXIF data such as GPS location removed) and never sent to a server.</li>
        <li>Fonts are self-hosted — no request is made to Google Fonts.</li>
      </ul>
      <h2>Menus you publish</h2>
      <p>
        The exported HTML file contains no cookies or trackers. If you use external image links (https), guests’ browsers will contact the server hosting those images, which may see their IP address.
        Whoever publishes the menu is responsible for its hosting and anything they add to the file.
      </p>
      <h2>Your rights</h2>
      <p>All data stays with you: you can export (JSON), correct or delete it at any time from the editor or your browser settings.</p>
      <p className="muted">Technical draft — requires legal review (Israeli Privacy Protection Law incl. Amendment 13, GDPR) before publication, especially if a server, user accounts or analytics are added.</p>
    </DocShell>
  );
}
