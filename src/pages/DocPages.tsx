/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · AGPL-3.0-only + attribution terms (NOTICE)
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { useEffect, type ReactNode } from 'react';
import { useT } from '../i18n/ui';
import { REPO_URL } from './SiteFooter';

const UPDATED = '2026-10-22';

function DocShell({ children, lang }: { children: ReactNode; lang: string }) {
  const { t, dir } = useT();
  useEffect(() => {
    document.getElementById('main')?.focus();
  }, []);
  return (
    <main className="doc-page" id="main" tabIndex={-1} lang={lang} dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <p><a href="#/"><span aria-hidden="true">{dir === 'rtl' ? '→' : '←'}</span> {t('backToEditor')}</a></p>
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
          העורך של MenuAI פועל בדפדפן שלכם. בלי חשבון — שום מידע לא יוצא מהמכשיר. אין עוגיות שיווק, כלי מדידה, פיקסלים או שירותי צד שלישי.
        </p>
        <h2>אילו נתונים נשמרים ואיפה</h2>
        <ul>
          <li><strong>טיוטת התפריט</strong> (טקסטים, מחירים, תמונות שהעליתם, הגדרות עיצוב) — נשמרת בדפדפן שלכם (localStorage), כדי שלא תאבד בין ביקור לביקור, ובשרת רק אם בחרתם לשמור בענן. היא נמחקת כשמנקים את נתוני האתר בדפדפן.</li>
          <li><strong>העדפת שפת ממשק</strong> — נשמרת ב־localStorage.</li>
          <li>תמונות שאתם מעלים מעובדות במכשיר עצמו (הקטנה והסרת נתוני EXIF, כמו מיקום GPS), ונשלחות לשרת רק אם שומרים את התפריט בענן (ראו בהמשך).</li>
          <li>הגופנים נטענים מהאתר עצמו (self-hosted), ולא נשלחת שום בקשה ל־Google Fonts.</li>
        </ul>
        <h2>אם האתר מפעיל את שרת MenuAI (כניסה ושמירה בענן)</h2>
        <p>
          השרת אופציונלי, ומותקן ומופעל על ידי העסק שמפעיל את האתר הזה — לא על ידי מפתחי MenuAI. אם נכנסתם לחשבון:
        </p>
        <ul>
          <li><strong>חשבון:</strong> כתובת אימייל, שם ותפקיד (בעלים / עורך / צופה), לצורך כניסה והרשאות. קישורי הכניסה וההזמנה נשלחים דרך ספק האימייל שהעסק הגדיר.</li>
          <li><strong>עוגיית סשן אחת</strong> (חיונית, HttpOnly) לשמירת הכניסה, עד 30 יום או עד היציאה. אין עוגיות אחרות.</li>
          <li><strong>תפריטים בענן:</strong> כשבוחרים „שמירה בענן”, תוכן התפריט (כולל תמונות שהעליתם) נשמר בשרת, יחד עם זהות המשתמש שעדכן אותו לאחרונה ומועד העדכון.</li>
          <li><strong>יומן אבטחה</strong> של פעולות רגישות (כניסות, הזמנות, יצירה, פרסום ומחיקה של תפריטים), ללא תוכן התפריט.</li>
          <li><strong>תמונות שמעלים לתפריט בענן</strong> נסרקות לאיתור נוזקות בשרת עצמו (ClamAV, בלי שליחה לצד שלישי), ומקודדות מחדש כך שכל המטא־דאטה (כולל מיקום GPS) נמחקת. התמונה זמינה בכתובת עם מזהה אקראי, כדי שאורחים יוכלו לראות אותה בתפריט המפורסם.</li>
          <li><strong>שמירה ומחיקה:</strong> קישורי כניסה נמחקים אחרי 24 שעות, סשנים כשתוקפם פג, ויומן האבטחה אחרי 12 חודשים. כל זה קורה אוטומטית. גיבויים של השרת מוצפנים, ורק מי שמחזיק במפתח הפרטי יכול לפתוח אותם.</li>
          <li><strong>תפריטים מפורסמים</strong> (כתובת <code>/m/…</code>): האורחים לא מקבלים עוגיות, והשרת לא רושם את הביקורים שלהם ביומן.</li>
          <li><strong>תשלום מהשולחן</strong> (אם העסק הפעיל אותו): התשלום עצמו מתבצע בעמוד המאובטח של חברת הסליקה, ופרטי הכרטיס לא מגיעים לשרת. השרת שומר את החשבון והתשלומים (סכום, טיפ, סטטוס ומספר אסמכתה) לצורכי הנהלת חשבונות. אם חברת הסליקה דורשת שם וטלפון לקבלה, הם מועברים אליה ולא נשמרים בשרת. עמודי התשלום לא שומרים עוגיות מעקב.</li>
        </ul>
        <p>לבקשות גישה, תיקון או מחיקה של מידע שבשרת — פנו לבעלים של העסק שמפעיל את האתר.</p>
        <h2>תפריטים שאתם מפרסמים</h2>
        <p>
          קובץ ה־HTML המיוצא אינו כולל עוגיות או כלי מעקב. אם תשתמשו בקישורים לתמונות חיצוניות (https), הדפדפן של האורח יפנה לשרת שבו התמונה מאוחסנת, והשרת עשוי לראות את כתובת ה־IP של האורח.
          מי שמפרסם את התפריט אחראי לאחסון שלו ולכל כלי שיוסיף לקובץ.
        </p>
        <h2>זכויותיכם</h2>
        <p>בלי חשבון, כל הנתונים נמצאים אצלכם: אפשר לייצא אותם (JSON), לתקן או למחוק אותם בכל עת, דרך העורך או דרך הגדרות הדפדפן. מידע שנשמר בשרת אפשר לתקן או למחוק דרך העורך, או בפנייה לבעלים של העסק.</p>
        <p className="muted">טיוטה טכנית: לפני פרסום נדרשת בדיקה משפטית (חוק הגנת הפרטיות ותיקון 13, GDPR), ובמיוחד כשמשתמשים בשרת ובחשבונות משתמש, או אם יתווספו כלי מדידה.</p>
      </DocShell>
    );
  }
  return (
    <DocShell lang="en">
      <h1>Privacy policy</h1>
      <p>Last updated: {UPDATED}</p>
      <h2>In short</h2>
      <p>The MenuAI editor runs in your browser. Without an account, no data leaves your device. There are no marketing cookies, analytics, pixels or third-party services.</p>
      <h2>What is stored, and where</h2>
      <ul>
        <li><strong>Your menu draft</strong> (texts, prices, uploaded images, design settings) — stored in your browser’s localStorage so it survives between visits, and on the server only if you choose to save it to the cloud. Clearing site data removes it.</li>
        <li><strong>Interface language preference</strong> — stored in localStorage.</li>
        <li>Uploaded images are processed locally (resized, EXIF data such as GPS location removed) and are sent to a server only if you save the menu to the cloud (see below).</li>
        <li>Fonts are self-hosted — no request is made to Google Fonts.</li>
      </ul>
      <h2>If this site runs the MenuAI server (sign-in and cloud saving)</h2>
      <p>The server is optional and is installed and operated by the business running this site — not by the MenuAI developers. If you sign in:</p>
      <ul>
        <li><strong>Account:</strong> email address, name and role (owner / editor / viewer), used for sign-in and permissions. Sign-in and invitation links are sent through the email provider the business configured.</li>
        <li><strong>One session cookie</strong> (essential, HttpOnly) keeps you signed in for up to 30 days or until you sign out. No other cookies.</li>
        <li><strong>Cloud menus:</strong> when you choose “Save to cloud”, the menu content (including uploaded images) is stored on the server, together with who last updated it and when.</li>
        <li><strong>A security log</strong> of sensitive actions (sign-ins, invitations, creating, publishing and deleting menus), without menu content.</li>
        <li><strong>Images uploaded to a cloud menu</strong> are scanned for malware on the server itself (ClamAV, nothing is sent to third parties) and re-encoded, removing all metadata (including GPS location). Each image is available at a random address so guests can see it in the published menu.</li>
        <li><strong>Retention:</strong> sign-in links are deleted after 24 hours, sessions when they expire, and the security log after 12 months. All of this is automatic. Server backups are encrypted, and only the holder of the private key can open them.</li>
        <li><strong>Published menus</strong> (<code>/m/…</code> addresses): guests get no cookies, and the server does not log their visits.</li>
        <li><strong>Paying at the table</strong> (if the business turned it on): the payment itself happens on the payment company’s secure page, and card details never reach the server. The server keeps the bill, its payments and any refunds (amount, tip, status and reference number) for accounting, plus the number and link of the receipt the payment company issued, if it issued one. If the business lets guests order from the menu, the order (dishes, quantities and the note typed for the kitchen) is kept with the bill; please don’t write personal details in the note. If the payment company needs a name and phone number for the receipt, they are passed to it and not stored on the server. Payment pages set no tracking cookies.</li>
      </ul>
      <p>For access, correction or deletion of data on the server, contact the owner of the business that runs this site.</p>
      <h2>Menus you publish</h2>
      <p>
        The exported HTML file contains no cookies or trackers. If you use external image links (https), guests’ browsers will contact the server hosting those images, which may see their IP address.
        Whoever publishes the menu is responsible for its hosting and anything they add to the file.
      </p>
      <h2>Your rights</h2>
      <p>Without an account, all data stays with you: you can export (JSON), correct or delete it at any time from the editor or your browser settings. Data on the server can be corrected or deleted from the editor, or by contacting the business owner.</p>
      <p className="muted">Technical draft — requires legal review (Israeli Privacy Protection Law incl. Amendment 13, GDPR) before publication, especially when the server and user accounts are used, or if analytics are added.</p>
    </DocShell>
  );
}
