# Cookie policy — DRAFT (requires legal review)

**Menus published or exported with MenuAI store nothing on guests' devices and use no cookies, pixels,
analytics or tracking technology.** The editor uses only what is strictly necessary:

| Name | Provider | Type | Purpose | Data | Retention | Third party | Consent needed |
|---|---|---|---|---|---|---|---|
| `menuai_session` | The business's own MenuAI server (first party) | Cookie: HttpOnly, Secure, SameSite=Strict, `Path=/api` | Keep a team member signed in (only if the optional server is used) | Random session id (stored on the server as a hash) | 30 days, or until sign-out | No | No: strictly necessary for a service the user requested |
| `menuai:menu:v1` | MenuAI (first party) | localStorage | Keep the menu draft between visits | Menu content entered by the user | Until the user clears site data | No | No: strictly necessary for the feature |
| `menuai:prefs:v1` | MenuAI (first party) | localStorage | Remember the interface language | Language code | Until cleared | No | No: functional, user-initiated |
| `menuai:cloud:v1` | MenuAI (first party) | localStorage | Remember which cloud menu this device edits, and whether changes are still unsent | Menu id, version, flag | Until cleared or disconnected | No | No: functional, user-initiated |

Exported and published menus keep the chosen language only in the URL (`?lang=`).

**Pay at the table** (`/t/…` pages): no cookies and no storage. The table code and language travel in the URL,
and the payment form is protected by an Origin check, not by a cookie. On the payment company's own hosted
page, that company's cookie policy applies (⚖️ list the chosen provider's cookies here before going live).

If analytics or marketing tools are ever added, this policy, a consent banner, and a persistent
"Privacy & cookie settings" link must be added **before** those tools load. The banner must offer
"Accept all", "Reject all" and "Manage" (rejection as easy as acceptance), with no pre-ticked boxes,
and consent must be withdrawable at any time.
