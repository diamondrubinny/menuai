import type { Mail } from './mailer';

/** Bilingual (Hebrew + English) plain-text email. Plain text: no HTML to escape or to be abused. */
export function loginMail(to: string, link: string, kind: 'login' | 'invite', minutes: number): Mail {
  const he = kind === 'invite'
    ? `הוזמנת לערוך את התפריט ב־MenuAI.\nלכניסה, לחצו על הקישור (תקף ${minutes / 60} שעות, לשימוש חד־פעמי):`
    : `לכניסה ל־MenuAI, לחצו על הקישור (תקף ${minutes} דקות, לשימוש חד־פעמי):`;
  const en = kind === 'invite'
    ? `You have been invited to edit the menu on MenuAI.\nOpen this link to sign in (valid for ${minutes / 60} hours, single use):`
    : `Open this link to sign in to MenuAI (valid for ${minutes} minutes, single use):`;
  const note = 'אם לא ביקשתם את ההודעה הזו, אפשר להתעלם ממנה.\nIf you did not request this email, you can ignore it.';
  return {
    to,
    subject: kind === 'invite' ? 'הזמנה ל־MenuAI · MenuAI invitation' : 'קישור כניסה ל־MenuAI · MenuAI sign-in link',
    text: `${he}\n${link}\n\n${en}\n${link}\n\n${note}\n`,
  };
}
