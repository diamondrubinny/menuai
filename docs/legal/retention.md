# Data retention and deletion policy — DRAFT (requires legal review)

This policy applies to a MenuAI server installed and operated by a business ("the operator"). The operator is
the data controller; MenuAI's developers do not receive or process this data. Retention periods marked
"enforced" are applied automatically every day by the server (`cli.mjs retention` runs it on demand).

| Data | Retention | How it is deleted |
|---|---|---|
| Sign-in and invitation links (stored as hashes) | 24 hours after creation or expiry | Enforced |
| Sessions (hashes, browser user agent) | Until expiry (max 30 days) or sign-out | Enforced; sign-out and disabling an account delete them immediately |
| Security audit log (actions, no menu content) | 12 months | Enforced |
| Records of uploads refused by the virus scan (no file is kept) | 12 months | Enforced |
| Uploaded images no menu or stored version uses | 24 hours | Enforced |
| Published versions of a menu | The latest 50 per menu (the live one is always kept) | Enforced on each publish |
| Menus and their images | Until the operator deletes the menu | Deleting a menu removes its public page and versions; its images follow within 24 hours |
| Team accounts (email, name, role) | While the account exists | Disabling an account blocks it at once. ⚖️ Define when disabled accounts are deleted |
| Guests of published menus | MenuAI stores nothing. The web server's access log (truncated IP, path, status) is kept 14 days | logrotate |
| Encrypted backups | 14 days on the server (configurable); off-site copies per the operator's policy | `scripts/backup.sh`; ⚖️ define off-site retention |

**Requests from individuals** (access, correction, deletion, objection): handled by the operator.
Menu content can be exported (JSON) and corrected or deleted in the editor. Account data is managed
by the business owner. Data inside backups expires with the backup rotation.

*Technical draft. Requires review by a lawyer or privacy officer (Israeli Privacy Protection Law incl.
Amendment 13; GDPR where applicable) before publication.*
