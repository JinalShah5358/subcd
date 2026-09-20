# IFP Subsidy Assistant — browser extension

Fills a case you prepared in the IFP platform into the portal's application
form. Chrome/Edge, Manifest V3, no build step — the source you read is the code
that runs.

> **It does not file anything.** It types into boxes and highlights what it
> touched. Reviewing the form, solving the CAPTCHA and pressing submit are
> yours, and the extension has no code that could do any of them.

---

## What it will not do

These are not settings. They are properties of the code, and
`test/safety.test.js` fails the build if any of them stops being true.

| | Why it holds |
|---|---|
| Press submit | No `submit()`, no `requestSubmit()`, no synthetic submit event, no click on a submit control anywhere in `src/`. The only two `.click()` calls in the codebase are the checkbox and radio branches, asserted by name. |
| Touch a CAPTCHA | Refused by input name, by label, and by enclosing container — at capture time *and* again against the live element at fill time. |
| Read a password field | `password`, `file` and `hidden` are in the refusal set. A refused control is recorded with no selector, so nothing downstream can address it. |
| Store IFP credentials or cookies | There is no `document.cookie`, no `chrome.cookies`, and no page-storage access in `src/`. |
| Run unattended | No declarative content script, no `chrome.alarms`, no `setInterval`, no navigation hooks. Injection happens through `chrome.scripting` on a click in the popup. |
| Run anywhere else | `host_permissions` names one host. The service worker also checks the tab's host against the server's list before injecting. |
| Execute remote code | No `eval`, no `new Function`, no dynamic `import`. MV3's CSP forbids it too. |
| Send back what it typed | Telemetry carries a source path, a selector and an outcome. There is no field for a value. |

---

## Install (development)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this directory (`apps/extension`)
3. Click the extension → set the **Platform API** if it is not
   `http://localhost:4000/api/v1`
4. In the platform: **Browser extension** → **Pair a browser** → copy the code
5. Paste the code into the extension and give the browser a name

Pairing exchanges a one-time, ten-minute code for a device credential scoped to
your firm and your permissions. It expires in 90 days and you can unpair from
the platform at any time. **Your IFP portal password is never entered here.**

---

### If pairing says "Origin not allowed"

The API refuses cross-origin state-changing requests as CSRF defence, and a
packed extension calls from `chrome-extension://<id>` — an origin that cannot
be in `WEB_ORIGIN`, because the id differs per installation.

In **development** any extension origin is accepted on `/extension` routes and
nowhere else. In **production** the id must be named in `EXTENSION_ORIGINS` or
the extension is refused. Find it on the extension card in `chrome://extensions`.

This is not a CSRF hole: CSRF needs a credential the browser attaches
*ambiently*, and nothing under `/extension` uses a cookie. Pairing needs a
ten-minute single-use code; everything else needs a device secret that lives in
the extension's own storage, unreachable from any web page.

---

## Teaching it the form

Nobody on this project has seen the authenticated IFP form, so **no selectors
are shipped**. Guessing one would be worse than having none: a wrong guess
types a PAN into whatever box happened to match.

Instead:

1. Sign in to the IFP portal yourself and open the application form.
2. Extension → **Learn this page** → **Capture this page**.
   It records the controls it can see — type, label, name, options — and
   records refused controls with no selector at all.
3. Platform → **Browser extension** → open the capture.
4. Bind each control to a data path (`client.pan`, `project.pincode`, …) and
   pick a transform if the portal wants a different format.
5. **Activate this map.**

Mapping is deliberately manual. "Name of Applicant (as per PAN)" is a judgement
about which of our fields belongs there, and the cost of guessing wrong is a
misfiled government application.

### When the portal changes

Each capture stores a digest of the form's shape. If the page stops matching,
the extension says so before it fills anything and records `driftDetected` on
the run. Capture the page again and re-activate.

---

## Using it

1. Open the IFP form in the paired browser.
2. Extension → pick the case → **Preview** (reports what would happen, changes
   nothing) or **Fill form**.
3. Filled boxes get a green outline; anything skipped gets an amber dashed one
   and a line in the results list saying why.
4. **Check every field.** Then solve the CAPTCHA and submit yourself.

Revealing a case's data through the extension needs the same
`sensitive:reveal` permission as revealing a PAN in the web app, and writes the
same audit row. A Staff user cannot obtain identifiers this way.

---

## Layout

```
manifest.json        MV3. One host, three permissions, no content_scripts block
src/background.js    Service worker — the only code that talks to the API
src/content.js       The page-facing half: capture, fill, mark. No network access
src/popup.*          The UI. Everything starts with a click here
src/options.*        API base URL, and the promises above in plain language
test/content.test.js 22 tests against a hostile synthetic form
test/safety.test.js  15 tests asserting the guarantees against the source
test/popup.test.js    7 tests that the markup, styles and script agree
```

`background.js` holds the credential and `content.js` has no way to make a
request, so a compromised page that reached the content script still could not
reach the API.

---

## Tests

```bash
npx vitest run --root apps/extension     # 44 unit tests
node scripts/smoke-extension.mjs         # 30 assertions, real API + real DOM
```

The smoke test pairs a browser, captures a synthetic portal page through the
real content script, maps fields, activates, fills, and then asserts that the
password and CAPTCHA boxes are still empty and that no filled value reached the
audit trail.

Every guarantee in the table above has been mutation-tested: adding a
`submit()` call, adding `<all_urls>`, or removing `password` from the refusal
set each break the suite.
