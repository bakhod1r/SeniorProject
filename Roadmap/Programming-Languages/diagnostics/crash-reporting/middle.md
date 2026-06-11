# Crash Reporting — Middle Level

> **Topic:** [Crash Reporting Roadmap](README.md)
> **Focus:** Wiring a real reporter (Sentry / Crashlytics / Bugsnag) correctly. Grouping & fingerprinting so the dashboard stays usable. Breadcrumbs and context. Uploading symbols (source maps, dSYM, ProGuard) so traces are readable. Scrubbing PII before it ever leaves the process.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Wiring a Real Reporter](#wiring-a-real-reporter)
6. [Grouping & Fingerprinting](#grouping--fingerprinting)
7. [Breadcrumbs & Context](#breadcrumbs--context)
8. [Symbol Upload — The Build Step You Can't Skip](#symbol-upload--the-build-step-you-cant-skip)
9. [PII Scrubbing](#pii-scrubbing)
10. [Code Examples](#code-examples)
11. [Capturing Handled Exceptions Deliberately](#capturing-handled-exceptions-deliberately)
12. [Pros & Cons](#pros--cons)
13. [Use Cases](#use-cases)
14. [Coding Patterns](#coding-patterns)
15. [Clean Code](#clean-code)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Tricky Points](#tricky-points)
20. [Test Yourself](#test-yourself)
21. [Tricky Questions](#tricky-questions)
22. [Cheat Sheet](#cheat-sheet)
23. [Summary](#summary)
24. [What You Can Build](#what-you-can-build)
25. [Further Reading](#further-reading)
26. [Related Topics](#related-topics)
27. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **Stop hand-rolling crash capture. Wire a real reporter, make it group correctly, enrich it with context, and make sure it never leaks a secret.**

At junior level you installed the global handlers and understood why symbolication exists. That's the *skeleton*. At middle level you put a real SDK on it and discover that the SDK works perfectly out of the box — and then your dashboard is a disaster anyway. Why? Because the four things that actually make crash reporting *useful* are the four things the default config gets subtly wrong for your app:

1. **Grouping.** Out of the box, two crashes that are obviously the same bug land as two separate issues — because the default fingerprint keyed off a message that contains a dynamic ID. Now you have 9,000 issues that are really 40.
2. **Symbols.** Capture works on day one. Readable traces do *not* — until you wire symbol upload into your release pipeline, every build, automatically. The most common middle-level failure is a perfectly-instrumented app whose every trace is `t.n.a`.
3. **Context.** A bare stack trace tells you *where* it broke, not *what the user was doing*. Breadcrumbs and structured context turn "crash in CartView" into "crash in CartView, right after a 500 from `/api/cart`, on a slow network, for a logged-out user."
4. **PII.** The moment you start enriching reports, you start leaking. The email you added to the user object, the auth token in the request headers breadcrumb, the card number in the error message — all now sitting in a third-party SaaS, in scope for GDPR/PCI. Scrubbing is not optional; it's the price of enrichment.

This page is the practical wiring for all four, in code, per language. `senior.md` builds on it with sampling, crash-free SLOs, release health, and signal-handler safety; `professional.md` operates the whole thing at scale.

> 🎓 **Why this matters at middle level:** A junior gets crashes into a dashboard. A middle engineer makes that dashboard *trustworthy* — every issue is one real bug, every trace is readable, every report has enough context to fix without a repro, and no report contains a single thing the legal team would panic about. The gap between "we have Sentry" and "Sentry actually saves us time" is exactly this page.

---

## Prerequisites

- **Required:** All of [`junior.md`](junior.md) — global handlers per language, anatomy of a report, why symbolication exists, crash vs error vs warning.
- **Required:** You can install and configure an SDK from a package manager, set environment variables, and run a release build.
- **Required:** Comfort reading stack traces and exception chains. See [`../debugging/middle.md`](../debugging/middle.md).
- **Helpful:** Exposure to a CI/CD pipeline — symbol upload lives there. See [`../../code-craft/refactoring/05-tooling-and-automation/`](../../code-craft/refactoring/05-tooling-and-automation/) for the automation mindset.
- **Helpful:** Awareness of structured logging and correlation IDs — breadcrumbs and trace context build on the same ideas. See [`../logging/middle.md`](../logging/middle.md).
- **Helpful:** A rough sense of GDPR/PCI scope — *why* you can't ship emails and card numbers to a third party.

---

## Glossary

| Term | Definition |
|------|-----------|
| **DSN** | Data Source Name — the URL+key that tells the SDK where to send reports (Sentry's term). The single config value that wires the client to the project. |
| **Reporter / SDK** | The client library: Sentry, Firebase Crashlytics, Bugsnag, Breakpad/Crashpad, sentry-native. Captures, enriches, queues, uploads. |
| **Grouping** | The act of deciding which crashes are "the same." Produces issues from events. |
| **Fingerprint** | The key used for grouping. Default is derived from the stack/exception; you can override it. |
| **Event** | A single captured crash occurrence. |
| **Issue / group** | A set of events that share a fingerprint. The unit you triage. |
| **Breadcrumb** | A small timestamped event recorded *before* a crash (navigation, HTTP call, log, user action) that gives the report context. |
| **Context / tags** | Structured key-value data attached to a report. *Tags* are indexed/filterable (release, os, device); *context* is freeform (extra state). |
| **Source map** | The JS codebook mapping minified positions back to source. |
| **dSYM** | Apple's debug-symbol bundle for symbolicating iOS/macOS crashes. |
| **PDB** | Windows program database — symbols for native and .NET. |
| **ProGuard/R8 mapping** | `mapping.txt` — undoes Android obfuscation (a.k.a. "retrace"). |
| **PII** | Personally Identifiable Information — must be scrubbed before send. |
| **`beforeSend` / scrubbing hook** | The SDK callback that runs on every event *before* upload, where you redact or drop data. |
| **Scrubbing** | Removing/redacting sensitive fields (emails, tokens, card numbers) from a report. |
| **Server-side scrubbing** | A second redaction layer applied by the backend (Sentry "Data Scrubbers") as defense in depth. |

---

## Core Concepts

### 1. The SDK Does the Plumbing; You Own the Policy

A real reporter handles the hard mechanics for free: capturing across all surfaces, offline queueing, retry with backoff, batching, payload compression, symbolication on the server. What it *cannot* know is your *policy*: how *your* crashes should group, what context *your* app should attach, and which of *your* fields are sensitive. Middle-level crash reporting is configuring policy on top of plumbing — not reimplementing plumbing.

### 2. Grouping Is the Feature

If you remember one thing: **the value of a crash reporter is grouping, and grouping is fragile.** A good fingerprint collapses thousands of events into one actionable issue. A bad fingerprint either *over-groups* (two different bugs look like one, so you fix one and the issue won't close) or *under-groups* (one bug shatters into thousands of issues because the message contains `order_id=8831`). Most "Sentry is noisy" complaints are grouping problems, not volume problems.

### 3. Context Is What Replaces the Repro

You can't reproduce a production crash. So the report must carry everything you'd otherwise reproduce: the user's path (breadcrumbs), the device/OS/release (tags), the relevant state (context), and the last network calls. Every field you attach is a question you won't have to ask a user who is never coming back. The art is attaching *enough* to diagnose, *without* attaching PII.

### 4. Enrichment and Scrubbing Are the Same Decision

The instant you decide "let's attach the user object so we know who's affected," you've made a scrubbing decision: *which* fields of that user object are safe? Email — no. Hashed ID — yes. You cannot enrich responsibly without scrubbing in the same breath. They are two sides of one config block (`beforeSend`), not two separate projects.

### 5. Symbol Upload Belongs in CI, Not in a Human's Memory

The single most reliable way to get unreadable production traces is to make symbol upload a manual step someone "remembers" to do. They'll forget on the hotfix release — the one you most need to read. Symbol upload must be a *non-optional, automated step of the release build*, gated so the build *fails* if symbols didn't upload. Treat it like running tests.

---

## Wiring a Real Reporter

The major reporters share a shape. Learn the shape once; the per-vendor differences are small.

| Reporter | Best fit | Symbolication | Notable |
|---|---|---|---|
| **Sentry** | Everything — web, backend, mobile, native | Source maps, dSYM, PDB, ProGuard, DWARF | The de facto standard; self-hostable; rich grouping config |
| **Firebase Crashlytics** | Mobile (iOS/Android) first | dSYM (auto), NDK symbols, ProGuard mapping | Free; deep mobile/release-health integration; Google-owned |
| **Bugsnag (SmartBear)** | Mobile + web, stability-score focus | Source maps, dSYM, ProGuard | Strong "release stability" framing |
| **Breakpad / Crashpad** | Native desktop (C/C++), browsers, games | Breakpad `.sym` from your symbols | Generates **minidumps**; the engine behind many of the above for native |
| **sentry-native** | Native apps wanting Sentry's backend | DWARF/PDB via Crashpad/Breakpad under the hood | Bridges native minidumps into Sentry |

The universal init sequence (Sentry shown; others mirror it):

1. **Initialize as early as possible** — first line of `main`, before anything can fail.
2. **Pass the DSN** from config/env (never hard-code; it's an environment selector too).
3. **Set `release` and `environment`** — wired from the build, not typed.
4. **Set the sample rate** (`senior.md` topic; default to 1.0 for crashes at first).
5. **Register a `beforeSend` hook** for scrubbing (see below).
6. **Let the SDK install its handlers**, then chain *your* prior handler if you had one.

---

## Grouping & Fingerprinting

### How Default Grouping Works

Most reporters fingerprint by **the exception type + a normalized stack trace** (often the top N in-app frames). Two events with the same exception thrown from the same call path → same issue. This is right ~80% of the time and wrong in two predictable ways:

**Under-grouping (one bug → thousands of issues).** The default fingerprint includes the **message**, and your message contains a dynamic value:

```text
Error: failed to load order 8831    ← issue A
Error: failed to load order 9027    ← issue B   (same bug, different issue!)
Error: failed to load order 4410    ← issue C
```

Three issues, one bug. The fix: normalize the message *or* override the fingerprint to drop the variable part.

**Over-grouping (many bugs → one issue).** A generic frame at the top — a shared `assert`, a logging wrapper, a `panic` helper — makes unrelated crashes share a top frame and collapse into one giant issue. The fix: exclude the framework/helper frames so grouping keys off *your* code, or split the fingerprint by a distinguishing field.

### Overriding the Fingerprint

```js
// Sentry: pin grouping to a stable key, ignore the variable message.
Sentry.captureException(err, {
  fingerprint: ["order-load-failure"], // all "failed to load order N" → one issue
});
```

```python
# Sentry Python: same idea inside a scope.
with sentry_sdk.push_scope() as scope:
    scope.fingerprint = ["payment", "gateway-timeout", gateway_name]
    sentry_sdk.capture_exception(err)
```

The fingerprint should be **stable across occurrences of the same bug** and **distinct across different bugs**. Good ingredients: the logical operation, the exception type, the failing subsystem. Bad ingredients: IDs, timestamps, user names, anything per-request.

### Grouping Rules of Thumb

| Symptom | Likely cause | Fix |
|---|---|---|
| One bug shows as thousands of issues | Message has a dynamic ID | Normalize message or set explicit `fingerprint` |
| Fix shipped but issue won't auto-close | Over-grouped: two bugs share one issue | Split the fingerprint |
| Unrelated crashes share one giant issue | Generic top frame (assert/log wrapper) | Mark those frames "not in-app" so grouping skips them |
| Minified frames make grouping random | Symbols not uploaded | Fix symbol upload (next section) — grouping *depends* on readable frames |

> Note the last row: **grouping quality depends on symbolication.** Group by minified frames and a new build (with new minified names) re-shatters every issue. Symbols first, then grouping.

---

## Breadcrumbs & Context

A stack trace says *where*. Breadcrumbs say *what led there*. Context says *under what conditions*.

### Breadcrumbs

Breadcrumbs are a rolling buffer (typically the last ~100 events) automatically trimmed and attached on crash. Most SDKs auto-record common ones; you add the domain-specific ones.

```text
12:03:41  navigation  /products → /cart
12:03:48  http        GET /api/cart  500  890ms   ← the smoking gun
12:03:49  ui.click    button#checkout
12:03:49  ← CRASH: TypeError reading 'total' of null
```

The 500 on `/api/cart` *is* the bug: the cart came back null, and `renderCart` didn't guard it. The stack trace alone wouldn't have told you *why* the cart was null. Breadcrumbs did.

Add them at meaningful boundaries:

```js
Sentry.addBreadcrumb({
  category: "checkout",
  message: "applied coupon",
  level: "info",
  data: { couponLength: coupon.length }, // NOT the coupon code itself
});
```

> Breadcrumbs are a *prime* PII leak vector. Auto-recorded HTTP breadcrumbs include URLs (which may contain tokens in query strings) and sometimes request bodies. Scrub them (see PII section). The `data` you add should describe, not reveal — `couponLength`, not the coupon.

### Context and Tags

- **Tags** are indexed and filterable: `release`, `environment`, `os`, `device`, `feature_flag.new_checkout`. Use tags for things you'll want to *slice by* ("show me crashes on iOS 17 in v4.2.0 with new_checkout on").
- **Context** is freeform extra state attached for reading: the relevant config, the size of the cart, the state machine's current state. Not indexed; just there when you open the issue.

```python
sentry_sdk.set_tag("checkout.variant", "B")          # filterable
sentry_sdk.set_context("cart", {                      # readable
    "item_count": len(cart.items),
    "currency": cart.currency,
    # no prices, no user identity
})
```

### User Context — Carefully

You usually *do* want to know *how many users* a crash hit (for crash-free-users in `senior.md`). But the user object is where PII concentrates.

```js
Sentry.setUser({
  id: hash(user.id),     // stable, non-reversible identifier — YES
  // email: user.email,  // NO — strip it
  segment: user.plan,    // "free"/"pro" is fine, low cardinality, not PII
});
```

A hashed/opaque ID gives you "affected users count" without storing who they are.

---

## Symbol Upload — The Build Step You Can't Skip

Capture works without symbols. *Readable* traces don't. Symbol upload turns the gibberish into source — and it must happen at build time, automatically, for the exact build you ship.

| Platform | Symbol artifact | Upload tooling | When |
|---|---|---|---|
| **JS (web/Node)** | `*.js.map` source maps | `sentry-cli sourcemaps upload` / bundler plugin | After bundling, before/with deploy |
| **Android (Java/Kotlin)** | `mapping.txt` (R8/ProGuard) + NDK `.so` symbols | Sentry/Crashlytics Gradle plugin | During the release build |
| **iOS/macOS (Swift/ObjC)** | `.dSYM` bundles | `sentry-cli upload-dif` / Fastlane / Crashlytics run-script | Post-archive |
| **Windows (C/C++/.NET)** | `.pdb` | `sentry-cli upload-dif` | Post-build |
| **Go / Rust / C++ (Linux)** | DWARF (in binary or split debug) | `sentry-cli upload-dif` / keep unstripped binary | Post-build |

The canonical JS flow, automated:

```bash
# In CI, after the production bundle is built:
export SENTRY_RELEASE="myapp@4.2.0+$(git rev-parse --short HEAD)"

sentry-cli releases new "$SENTRY_RELEASE"
sentry-cli sourcemaps upload ./dist \
    --release "$SENTRY_RELEASE" \
    --url-prefix '~/static/'         # match how files are served
sentry-cli releases finalize "$SENTRY_RELEASE"

# CRITICAL: do NOT ship the .map files to the public CDN.
# Upload them to Sentry, then delete from the deploy artifact.
rm ./dist/**/*.map
```

Three rules that catch teams out:

1. **The release name in the SDK must match the release the symbols were uploaded under**, byte for byte (`myapp@4.2.0+abc123`). A mismatch = symbols exist but never get applied. Wire both from the same source.
2. **Don't serve source maps publicly.** Upload them to your reporter, then strip them from the deployed bundle, or you've handed your source to anyone with DevTools.
3. **Gate the build on upload success.** If `sentry-cli` exits non-zero, fail the release. A "successful" deploy with no symbols is the trap.

> Native (`Breakpad`/`Crashpad`) is different: the device produces a **minidump** (compact memory snapshot), and you symbolicate *server-side* against `.sym` files you generated with `dump_syms` from your build. Same principle — symbols are per-build and uploaded out of band — but the mechanics are heavier; see `professional.md`.

---

## PII Scrubbing

Every report leaves your process and lands in a third party (or your own backend). The moment it does, anything sensitive in it is a liability — GDPR for personal data, PCI-DSS for card data, plain bad-news for auth tokens. Scrubbing happens in **three layers**:

1. **Don't collect it.** The cheapest scrubbing is never attaching the email in the first place. Default to hashed IDs and describe-don't-reveal data.
2. **`beforeSend` — scrub on the client, before upload.** A hook that runs on every event; redact known-sensitive fields, drop dangerous breadcrumbs, regex-out card/token patterns from messages.
3. **Server-side scrubbing — defense in depth.** Sentry's "Data Scrubbers" and `sensitive_fields` strip known patterns again on receipt, in case the client missed one.

```js
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  release: process.env.SENTRY_RELEASE,
  environment: process.env.NODE_ENV,
  sendDefaultPii: false,            // do NOT auto-attach IP, cookies, headers
  beforeSend(event) {
    // 1. Strip the user email if some code set it.
    if (event.user) delete event.user.email;

    // 2. Redact Authorization headers from HTTP breadcrumbs.
    for (const b of event.breadcrumbs?.values ?? []) {
      if (b.data?.headers?.Authorization) b.data.headers.Authorization = "[redacted]";
      if (typeof b.data?.url === "string") b.data.url = stripQueryTokens(b.data.url);
    }

    // 3. Regex out card numbers / tokens that leaked into the message.
    if (event.message) event.message = scrubSecrets(event.message);
    if (event.exception?.values) {
      for (const ex of event.exception.values) ex.value = scrubSecrets(ex.value || "");
    }
    return event; // return null to DROP the event entirely
  },
});

function scrubSecrets(s) {
  return s
    .replace(/\b\d{13,16}\b/g, "[card]")               // naive PAN
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]");
}
```

| Field | Default risk | Treatment |
|---|---|---|
| Email / name / phone | PII | Never send; strip in `beforeSend` |
| Auth token / cookie / API key | Secret | Strip from headers, messages, breadcrumbs |
| Card number / CVV | PCI-DSS | Regex-scrub; never log upstream either |
| Full request body | Often PII | Don't attach; or attach a redacted summary |
| IP address | PII in EU | `sendDefaultPii: false`; or truncate last octet |
| User ID | Low if opaque | Hash it; gives counts without identity |
| URL query string | May carry tokens | Strip query params or known token keys |

> The honest caveat: regex scrubbing is best-effort, not a guarantee. The *real* defense is not collecting sensitive data in the first place, plus scrubbing as a safety net. Treat `beforeSend` as the last line, not the only line. And test it: send a synthetic event containing a fake card number and confirm it arrives redacted.

---

## Code Examples

The four middle-level pillars — init, fingerprint, breadcrumb, scrub — in each language.

### Python (Sentry SDK)

```python
import sentry_sdk
from sentry_sdk import capture_exception, add_breadcrumb, set_tag

def scrub(event, hint):
    if event.get("user"):
        event["user"].pop("email", None)
    # drop the event entirely if it's a known-noisy handled error:
    exc = (event.get("exception") or {}).get("values") or []
    if exc and exc[0].get("type") == "BrokenPipeError":
        return None
    return event

sentry_sdk.init(
    dsn=os.environ["SENTRY_DSN"],
    release=os.environ.get("APP_RELEASE", "unknown"),
    environment=os.environ.get("APP_ENV", "production"),
    send_default_pii=False,
    before_send=scrub,
    traces_sample_rate=0.0,   # crash capture is separate from perf tracing
)

def checkout(cart, user):
    set_tag("checkout.variant", cart.variant)
    add_breadcrumb(category="checkout", message="started",
                   data={"item_count": len(cart.items)})  # count, not contents
    try:
        return charge(cart)
    except GatewayTimeout as e:
        # surprising-but-survivable: report with a STABLE fingerprint, then re-raise
        with sentry_sdk.push_scope() as scope:
            scope.fingerprint = ["payment", "gateway-timeout", cart.gateway]
            capture_exception(e)
        raise
```

### Go (sentry-go)

```go
import (
	"github.com/getsentry/sentry-go"
)

func initCrashReporting(release string) {
	_ = sentry.Init(sentry.ClientOptions{
		Dsn:         os.Getenv("SENTRY_DSN"),
		Release:     release,                 // e.g. "svc@" + gitSHA
		Environment: os.Getenv("APP_ENV"),
		SendDefaultPII: false,
		BeforeSend: func(event *sentry.Event, hint *sentry.EventHint) *sentry.Event {
			if event.User.Email != "" {
				event.User.Email = "" // scrub
			}
			return event
		},
	})
}

// Each goroutine still needs its own recover -> report (junior lesson).
func guarded(work func()) {
	defer sentry.Recover() // sentry-go's recover-then-report helper
	work()
}

func chargeHandler(cart Cart) error {
	sentry.WithScope(func(scope *sentry.Scope) {
		scope.SetTag("checkout.variant", cart.Variant)
		scope.AddBreadcrumb(&sentry.Breadcrumb{
			Category: "checkout", Message: "started",
			Data: map[string]any{"item_count": len(cart.Items)},
		}, 100)
	})
	if err := charge(cart); err != nil {
		sentry.WithScope(func(scope *sentry.Scope) {
			scope.SetFingerprint([]string{"payment", "gateway-timeout", cart.Gateway})
			sentry.CaptureException(err)
		})
		return err
	}
	return nil
}
```

### Java / Android (Sentry or Crashlytics)

```java
// Sentry init (Android: usually via SentryAndroid.init in Application.onCreate)
Sentry.init(options -> {
    options.setDsn(BuildConfig.SENTRY_DSN);
    options.setRelease("app@" + BuildConfig.VERSION_NAME + "+" + BuildConfig.GIT_SHA);
    options.setEnvironment("production");
    options.setSendDefaultPii(false);
    options.setBeforeSend((event, hint) -> {
        if (event.getUser() != null) event.getUser().setEmail(null); // scrub
        return event; // return null to drop
    });
});

// Stable fingerprint + breadcrumb for a surprising-but-handled failure:
void charge(Cart cart) {
    Sentry.addBreadcrumb(new Breadcrumb("checkout started"));
    try {
        gateway.charge(cart);
    } catch (GatewayTimeoutException e) {
        Sentry.withScope(scope -> {
            scope.setFingerprint(Arrays.asList("payment", "gateway-timeout", cart.gateway));
            scope.setTag("checkout.variant", cart.variant);
            Sentry.captureException(e);
        });
        throw e;
    }
}
```

> Android symbols: add the Sentry (or Crashlytics) Gradle plugin so `mapping.txt` and NDK `.so` symbols upload automatically on the release build. Without the plugin, every release crash is obfuscated `a.b.c`.

### Node.js (Sentry)

```js
const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  release: process.env.SENTRY_RELEASE,
  environment: process.env.NODE_ENV,
  sendDefaultPii: false,
  beforeSend(event) {
    if (event.user) delete event.user.email;
    return event;
  },
  beforeBreadcrumb(crumb) {
    // strip tokens from auto-recorded http breadcrumbs
    if (crumb.category === "http" && crumb.data?.url) {
      crumb.data.url = crumb.data.url.replace(/([?&](token|key)=)[^&]+/gi, "$1[redacted]");
    }
    return crumb;
  },
});

// uncaughtException + unhandledRejection are auto-wired by the SDK (junior lesson),
// but you still process.exit(1) after fatal ones in a server.
```

### Rust (sentry crate)

```rust
let _guard = sentry::init(sentry::ClientOptions {
    dsn: std::env::var("SENTRY_DSN").ok().and_then(|s| s.parse().ok()),
    release: Some(env!("CARGO_PKG_VERSION").into()),
    environment: Some("production".into()),
    send_default_pii: false,
    before_send: Some(std::sync::Arc::new(|mut event| {
        if let Some(user) = event.user.as_mut() {
            user.email = None; // scrub
        }
        Some(event)
    })),
    ..Default::default()
});
// sentry::integrations::panic forwards panics automatically once the guard is alive.
```

---

## Capturing Handled Exceptions Deliberately

Crash reporters aren't only for *un*handled failures. The "this shouldn't happen but I survived it" case is valuable too — but it's the easiest way to flood your dashboard if done carelessly.

```python
try:
    result = parse_third_party_response(resp)
except SchemaError as e:
    # We have a fallback, so we don't crash. But we WANT to know it happened.
    capture_exception(e)        # report
    result = fallback()          # recover
```

Guardrails for handled captures:

- **Give them a stable fingerprint** so they group cleanly (they often share a generic call site).
- **Sample them** if they're frequent — you don't need every occurrence (see `senior.md`).
- **Never capture routine errors** — a 404, a validation failure, an expected timeout. Those are metrics/logs. Capturing them buries real crashes.
- **Capture, then recover or re-raise — never capture-and-swallow blindly.** Reporting is not handling.

---

## Pros & Cons

| Decision | Pros | Cons |
|---|---|---|
| **Use a SaaS reporter (Sentry/Crashlytics)** | Plumbing solved; great UI; symbolication built-in | Data leaves your network (privacy); ongoing cost; vendor lock-in |
| **Self-host (Sentry/GlitchTip)** | Data stays in-house; no per-event SaaS bill | You operate it; scaling/retention is your problem (`professional.md`) |
| **Override fingerprints aggressively** | Clean, actionable issues | Over-engineering; can mask genuinely-distinct bugs if too coarse |
| **Rich breadcrumbs/context** | Diagnose without a repro | Bigger payloads; more PII surface to scrub |
| **`sendDefaultPii: false` + manual scrub** | Compliance-safe by default | You must remember to *add back* the safe context you actually need |
| **Capture handled exceptions** | See "shouldn't happen" cases early | Easy to flood the dashboard; needs sampling + fingerprints |

---

## Use Cases

- **App "feels buggy" but no clear crash** → wire the SDK, add breadcrumbs around the suspect flow; the breadcrumb timeline reveals the precondition.
- **Dashboard has 9,000 issues that are really 40** → fix fingerprints; normalize dynamic messages; mark wrapper frames not-in-app.
- **Every production trace is `t.n.a`** → wire source-map/dSYM upload into CI; match release names; verify on a real event.
- **Compliance review flags the crash tool** → audit `beforeSend`, enable server-side scrubbers, set `sendDefaultPii: false`, send a synthetic PII event and confirm redaction.
- **You ship a fix and want to confirm it worked** → tag the release, watch the issue's event rate per release drop to zero on the build with the fix.

---

## Coding Patterns

### Pattern 1 — One Init Module, Imported First

```python
# observability.py — imported as the very first line of main
def init():
    sentry_sdk.init(dsn=..., release=..., before_send=scrub, ...)
```

Centralize init so DSN, release, and scrubbing live in one auditable place — not scattered, not duplicated, not divergent between services.

### Pattern 2 — Release From the Build, Never Typed

```bash
# CI injects the same value into the SDK AND the symbol upload
RELEASE="myapp@$(cat VERSION)+$(git rev-parse --short HEAD)"
```

The SDK's `release` and the symbol upload's `--release` must come from *one* source of truth, or symbols silently won't apply.

### Pattern 3 — Scrub Allowlist, Not Just Denylist

```python
SAFE_USER_KEYS = {"id", "plan", "segment"}
event["user"] = {k: v for k, v in event["user"].items() if k in SAFE_USER_KEYS}
```

Denylists ("strip email") miss the *next* sensitive field someone adds. An allowlist of *what may pass* is safer by default.

### Pattern 4 — Stable, Composed Fingerprints

```go
scope.SetFingerprint([]string{subsystem, errType, logicalOp}) // never include IDs
```

Compose fingerprints from *stable categorical* parts. Same bug → same key; different bug → different key; no per-request entropy.

### Pattern 5 — Describe, Don't Reveal, in Breadcrumbs

```js
addBreadcrumb({ message: "coupon applied", data: { length: code.length } }); // not the code
```

Breadcrumb `data` should let you *understand* the event without *exposing* the value.

---

## Clean Code

- **Initialize the reporter in exactly one place**, imported first, configured from env. No scattered `Sentry.init` calls.
- **Wire `release` and symbol upload from the same source** so they can never drift.
- **Make symbol upload a hard-gated CI step** — build fails if symbols didn't upload.
- **Scrub with an allowlist** for structured objects (user, context), plus regex denylist for free text (messages).
- **Set `sendDefaultPii: false`** and consciously add back only the safe context you need.
- **Override fingerprints where the default is wrong**, with stable categorical keys — and *only* where it's wrong; don't pre-optimize grouping.
- **Don't capture routine errors.** A reporter full of 404s is a reporter no one reads.
- **Verify, don't assume:** a CI smoke test that emits a crash with a fake PII payload and asserts it lands symbolicated and redacted.

---

## Best Practices

1. **Match the SDK `release` to the uploaded-symbol release, exactly.** This is the #1 cause of "symbols uploaded but traces still minified."
2. **Automate symbol upload in CI and fail the build if it fails.** Never rely on memory.
3. **Audit default grouping per project.** Find the under-grouped (dynamic message) and over-grouped (generic frame) cases and fix their fingerprints.
4. **Add breadcrumbs at network and navigation boundaries** — they're where the precondition usually hides.
5. **Scrub in `beforeSend` *and* enable server-side scrubbers.** Defense in depth.
6. **Use hashed user IDs** to get affected-user counts without storing identity.
7. **Test the scrubber** with a synthetic event containing fake secrets; confirm redaction end-to-end.
8. **Tag with feature flags / experiment variants** so you can correlate a crash with a rollout.
9. **Keep `environment` accurate** so staging noise doesn't pollute production issues.

---

## Edge Cases & Pitfalls

- **Release-name mismatch** between SDK and symbol upload → symbols exist, never applied, traces stay minified. Single source of truth.
- **Source maps served publicly** → you've shipped your source. Upload to the reporter, strip from the deploy.
- **`beforeSend` throws** → some SDKs drop the event silently; keep the hook simple and defensive.
- **Auto HTTP breadcrumbs leak tokens** in query strings/headers → scrub in `beforeBreadcrumb`.
- **Over-grouping hides a regression** — a new bug folds into an existing issue and you never notice it's new. Watch for event-rate changes within an issue, not just new issues.
- **Hashing user IDs inconsistently** across services → the same user counts as several. Hash with a shared, stable scheme.
- **Sampling applied to crashes by accident** (confusing perf-trace sampling with error sampling) → you lose crashes. Keep error capture at 1.0 unless deliberately sampling (`senior.md`).
- **Mobile symbol upload tied to local builds only** → CI release builds ship with no symbols. Put the plugin in the *release* build path.
- **Breadcrumb buffer too small/large** → too small loses the smoking gun; too large bloats payloads and PII surface. Tune to your flows.

---

## Common Mistakes

1. **Uploading symbols under a release name that doesn't match the SDK's.** The most common middle-level failure; traces stay gibberish despite "successful" uploads.
2. **Leaving symbol upload as a manual step.** It gets skipped exactly on the urgent hotfix.
3. **Never touching default grouping**, then complaining the dashboard is noisy. Fingerprints are the fix.
4. **Putting IDs/timestamps into fingerprints**, shattering one bug into thousands of issues.
5. **Shipping `.map` files to the CDN**, exposing source.
6. **Attaching the full user object** (email, name) "to know who's affected," creating a PII liability. Use a hashed ID + plan.
7. **Auto-recorded HTTP breadcrumbs leaking auth tokens** because no one scrubbed `beforeBreadcrumb`.
8. **Capturing every handled error** (404s, validation) at full volume, burying real crashes.
9. **Trusting client-side scrubbing alone**, with no server-side scrubbers as backstop.
10. **Not testing the pipeline** — assuming the SDK "just works" and discovering at incident time that symbols never uploaded.

---

## Tricky Points

1. **Grouping depends on symbolication.** Group on minified frames and every new build re-shatters issues. Fix symbols *before* tuning fingerprints.
2. **`beforeSend` returning `null` drops the event entirely** — a powerful way to filter noise, but easy to over-drop and lose real crashes. Be conservative.
3. **Tags vs context is not cosmetic.** Tags are indexed (filter/group by them); context is just attached. Put anything you'll *slice by* in tags.
4. **`sendDefaultPii: false` also removes things you might want** (request data, IP). You re-add the *safe* subset deliberately — it's a default-deny posture.
5. **Crashlytics and Sentry handler chaining:** on Android both want to be the uncaught handler. They cooperate by chaining to the previous handler — don't install a third that breaks the chain.
6. **A "handled" capture still costs quota and dashboard space.** It's not free just because the app survived. Fingerprint and sample it.
7. **Source maps must match URL layout** (`--url-prefix`). If served paths don't match uploaded paths, resolution silently fails even with correct release.
8. **Regex scrubbing is lossy and fragile** — a card number split across a message won't match. Not-collecting beats scrubbing; scrubbing is the net, not the wall.

---

## Test Yourself

1. Wire Sentry (or Crashlytics) into a small app: init from env, set release + environment, register a `beforeSend` that strips email. Trigger a crash; confirm it lands.
2. Throw the same error with three different dynamic IDs in the message. Watch it create three issues. Now add a stable `fingerprint` and confirm it collapses to one.
3. Build a release/minified bundle. Wire source-map (or dSYM/ProGuard) upload into your build. Crash it; confirm the dashboard trace is *readable*, with correct file:line.
4. Deliberately mismatch the SDK release and the symbol-upload release. Observe the traces stay minified. Fix the mismatch; observe them resolve. Feel why "single source of truth" matters.
5. Add an HTTP breadcrumb whose URL contains `?token=secret123`. Confirm it arrives. Now add a `beforeBreadcrumb` scrubber; confirm `[redacted]`.
6. Add `Sentry.setUser({ id, email })`. Confirm the email appears. Then strip it in `beforeSend` and re-verify it's gone, while the affected-user count still works via the id.
7. Capture a handled exception with `captureException` in a `catch`, then re-raise. Confirm the dashboard shows it *and* the program still propagated the error.

---

## Tricky Questions

**Q1: You uploaded source maps successfully (CI is green) but production traces are still minified. What's the most likely cause?**

The release name the SDK stamps on events doesn't match the release the source maps were uploaded under. Symbolication matches symbols to events *by release*; a mismatch means the maps exist but never get applied. Wire the SDK `release` and the `sentry-cli --release` flag from one variable. (Second suspect: `--url-prefix` not matching how the files are actually served.)

**Q2: One bug is showing up as 4,000 separate issues. How do you fix it?**

The default fingerprint is keyed off a message containing a dynamic value (`failed to load order 8831`). Either normalize the message to a constant, or set an explicit `fingerprint` made of *stable categorical* parts (`["order-load-failure"]`). The principle: fingerprints must be identical across occurrences of the same bug and free of per-request entropy.

**Q3: After shipping a fix, the issue won't auto-resolve even though the bug is gone. Why?**

Over-grouping: two *different* bugs share one issue (usually because a generic top frame — an assert helper, a logging wrapper — collapses them). Your fix killed one; the other still fires under the same issue. Split the fingerprint so the two bugs separate, then the fixed one can resolve.

**Q4: Compliance found an email address in a crash report. Your `beforeSend` strips `user.email`. How did it get through?**

It wasn't in `user.email`. PII leaks through many channels: an HTTP breadcrumb body, a query string, an exception *message* that interpolated the email, or a context field someone added. A denylist on one field can't catch all of them. Switch the user object to an *allowlist*, scrub breadcrumbs and message text, and enable server-side scrubbers as a backstop. Best of all: stop collecting it upstream.

**Q5: Should you capture handled exceptions, and if so, how do you keep them from flooding the dashboard?**

Yes for "shouldn't happen but I survived" cases — they're early warnings. Keep them sane by: giving them stable fingerprints (they share generic call sites), sampling frequent ones, and *never* capturing routine errors (404s, validation, expected timeouts). Capture the surprising, not the routine.

**Q6: Why is `sendDefaultPii: false` the right default even though it removes useful data like request bodies and IPs?**

Because the cost of accidentally shipping PII to a third party (regulatory, reputational) vastly outweighs the convenience of auto-attached request data. Default-deny, then consciously add back the *safe* subset you actually need (hashed user ID, redacted URL, plan tier). It's far easier to add safe data deliberately than to notice sensitive data you're leaking by default.

**Q7: Your fingerprints are perfect but the dashboard is still chaotic after every release. What's wrong?**

You're probably grouping on minified frames because symbols aren't uploaded (or the release mismatches). Each new build mangles names differently, so the "same" bug gets new frames and a new fingerprint every release. Symbolication is a *precondition* for stable grouping — fix symbols first, and the fingerprints will start behaving.

---

## Cheat Sheet

```text
┌─────────────────────────── CRASH REPORTING — MIDDLE CHEAT SHEET ───────────────────────────┐
│                                                                                            │
│  THE FOUR PILLARS                                                                          │
│    1. WIRE the SDK   (init first, from env: dsn, release, environment, beforeSend)         │
│    2. GROUP right    (fix under/over-grouping with stable fingerprints)                    │
│    3. ENRICH         (breadcrumbs at net/nav boundaries; tags=filterable, context=read)    │
│    4. SCRUB          (beforeSend + server-side; allowlist objects, regex free text)        │
│                                                                                            │
│  GROUPING                                                                                  │
│    Under-grouped (1 bug → many issues)  → message has an ID → set explicit fingerprint     │
│    Over-grouped  (many bugs → 1 issue)  → generic top frame → mark frames not-in-app/split │
│    Fingerprint = [subsystem, errType, logicalOp]   ← stable, categorical, NO ids/timestamps│
│                                                                                            │
│  SYMBOL UPLOAD (per build, automated, CI-gated)                                            │
│    JS → .js.map (sentry-cli sourcemaps)   Android → mapping.txt + .so (Gradle plugin)      │
│    iOS → .dSYM (upload-dif)   Win → .pdb   Go/Rust → DWARF                                 │
│    RULE 1: SDK release == upload release (exact)                                           │
│    RULE 2: never serve .map publicly                                                       │
│    RULE 3: fail the build if upload fails                                                  │
│                                                                                            │
│  PII SCRUBBING                                                                             │
│    sendDefaultPii:false · strip email/token/card/cookie · hash user id · describe≠reveal   │
│    layers: (1) don't collect → (2) beforeSend → (3) server-side scrubbers                  │
│                                                                                            │
│  HANDLED CAPTURE                                                                           │
│    capture(e) for "shouldn't happen"; fingerprint + sample; NEVER routine 404/validation;  │
│    capture-then-reraise, never capture-and-swallow                                         │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Summary

- A real reporter (**Sentry, Crashlytics, Bugsnag, Breakpad/Crashpad, sentry-native**) solves the *plumbing* — capture, offline queue, retry, symbolication. You own the *policy*: grouping, context, scrubbing.
- **Grouping is the feature.** Fix **under-grouping** (dynamic message → set a stable `fingerprint`) and **over-grouping** (generic top frame → mark not-in-app / split fingerprint). Fingerprints must be stable across occurrences and free of per-request entropy.
- **Symbol upload is a hard-gated CI step**, per build, with the **SDK release matching the upload release exactly**. JS source maps, Android `mapping.txt`, iOS `.dSYM`, Windows `.pdb`, Go/Rust DWARF. Never serve `.map` publicly. Grouping quality *depends* on symbolication.
- **Breadcrumbs** (recorded before the crash) supply the precondition the stack trace can't; **tags** are filterable, **context** is readable. They replace the repro you can't do.
- **PII scrubbing** is three layers: don't collect it, scrub in `beforeSend` (allowlist objects, regex free text), and enable **server-side scrubbers**. Set `sendDefaultPii: false` and add back only safe context. Use **hashed user IDs** for affected-user counts without identity.
- **Capture handled exceptions** deliberately for "shouldn't happen but survived" cases — with stable fingerprints and sampling — but **never** capture routine errors, and never capture-and-swallow.
- **Verify the whole pipeline**: trigger a synthetic crash with a fake PII payload and confirm it lands symbolicated, correctly grouped, and redacted.

---

## What You Can Build

- A **reusable observability-init module** for your stack: one function that wires the SDK from env (DSN, release, environment), registers an allowlist-based `beforeSend`, and is imported as the first line of `main`. Drop it into three services.
- A **CI symbol-upload job** that derives `release` once from `VERSION + git SHA`, uploads source maps / dSYM / mapping.txt under that exact name, strips maps from the deploy artifact, and **fails the build** if upload fails.
- A **grouping audit script**: pull the top 100 issues via the reporter's API, flag ones whose titles differ only by digits (under-grouping) and ones with suspiciously high event counts across unrelated stacks (over-grouping). Output a fingerprint-fix to-do list.
- A **scrubber test harness**: emit synthetic events containing a fake card number, an `Authorization: Bearer ...` header breadcrumb, and a user email; assert each arrives redacted. Run it in CI so a `beforeSend` regression is caught.
- A **breadcrumb-coverage decorator/middleware** that auto-adds a breadcrumb on every HTTP call and route change (with URL tokens stripped), so your reports always carry the timeline.

---

## Further Reading

- **Docs**
  - Sentry "Source Maps" / "Debug Information Files" — the canonical symbol-upload reference. <https://docs.sentry.io/platforms/javascript/sourcemaps/>
  - Sentry "Grouping & Fingerprints" — <https://docs.sentry.io/concepts/data-management/event-grouping/>
  - Sentry "Scrubbing Sensitive Data" / `beforeSend` — <https://docs.sentry.io/platforms/javascript/data-management/sensitive-data/>
  - Firebase Crashlytics "Customize crash reports" (keys, logs, user IDs) — <https://firebase.google.com/docs/crashlytics/customize-crash-reports>
  - Android R8 retrace / ProGuard mapping — <https://developer.android.com/build/shrink-code>
  - `sentry-cli` — <https://docs.sentry.io/product/cli/>
- **Concepts**
  - "What are source maps and why do you need them" — web.dev.
  - GDPR/PCI primers — *why* scrubbing is a legal requirement, not a nicety.
- **Adjacent**
  - [`../logging/middle.md`](../logging/middle.md) — structured logs and correlation IDs that pair with breadcrumbs.
  - [`../error-handling/middle.md`](../error-handling/middle.md) — wrapping/typed errors that produce cleaner, better-grouped reports.

---

## Related Topics

- **Down a level:** [junior.md](junior.md) — global handlers, anatomy of a report, why symbolication exists.
- **Up a level:** [senior.md](senior.md) — sampling, crash-free-rate SLOs, release health, dedup strategy, signal-handler safety, mobile vs backend.
- **Professional:** [professional.md](professional.md) — operating the pipeline at scale, minidumps, symbol servers, cost, regression alerting.
- **Interview prep:** [interview.md](interview.md)
- **Practice:** [tasks.md](tasks.md)

**Sibling diagnostic topics:**

- [Error Handling — Middle](../error-handling/middle.md) — typed/wrapped errors group better and read cleaner.
- [Logging — Middle](../logging/middle.md) — correlation IDs and structured events feed breadcrumbs.
- [Tracing](../tracing/) — `traceparent`/trace IDs link a crash to its distributed request.
- [Telemetry Cost and Sampling Strategy](../telemetry-cost-and-sampling-strategy/) — the cost dimension of crash events (deep-dived in `senior.md`).

**Cross-roadmap links:**

- [Clean Code — Error Handling](../../code-craft/clean-code/06-error-handling/README.md) — better error handling yields better reports.
- [Refactoring — Tooling & Automation](../../code-craft/refactoring/05-tooling-and-automation/) — the CI-automation mindset that symbol upload requires.

---

## Diagrams & Visual Aids

### Where the Four Pillars Act in the Pipeline

```text
   ON DEVICE / IN PROCESS                          IN THE REPORTER BACKEND
 ┌──────────────────────────────┐               ┌──────────────────────────────┐
 │  exception escapes handler   │               │                              │
 │            │                 │               │   SYMBOLICATE (uploaded      │
 │   [ENRICH] add breadcrumbs,  │   raw event   │   .map/.dSYM/mapping.txt)    │
 │            tags, context ────┼──────────────►│            │                 │
 │            │                 │               │            ▼                 │
 │   [SCRUB] beforeSend:        │               │   [SCRUB] server-side        │
 │     strip email/token/card ──┤               │     data scrubbers           │
 │            │                 │               │            │                 │
 │            ▼ (queue/offline) │               │            ▼                 │
 │       upload (retry/batch)   │               │   [GROUP] fingerprint →      │
 └──────────────────────────────┘               │     1 issue × N events       │
                                                └──────────────────────────────┘
```

### Fingerprint Quality

```text
   BAD (under-grouped)              BAD (over-grouped)            GOOD
   ──────────────────              ──────────────────            ────
   fp = "load order 8831"          fp = ["assertFailed"]         fp = ["orders",
   fp = "load order 9027"          (all asserts → 1 issue)             "load",
   fp = "load order 4410"               every bug merges               "NotFound"]
   → 1 bug, 3000 issues            → many bugs, 1 issue          → 1 bug ⇄ 1 issue
```

### Symbol Upload Must Match the Build

```text
   BUILD (CI)                                    REPORTER
   ─────────                                     ────────
   RELEASE = app@4.2.0+abc123  ─┬─► SDK stamps events:  release=app@4.2.0+abc123
                                │                                   │
                                └─► upload symbols:    --release app@4.2.0+abc123
                                                                    │
                                          match? ──► symbolicate ✓  │
                                          mismatch ─► gibberish ✗ ──┘
```

---
