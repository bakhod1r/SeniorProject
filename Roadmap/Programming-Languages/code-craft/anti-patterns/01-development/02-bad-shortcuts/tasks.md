# Bad Shortcuts Anti-Patterns — Exercises

> **Category:** [Development Anti-Patterns](../README.md) → **Bad Shortcuts** — *hands-on practice paying back the debt before it compounds.*
> **Covers (collectively):** Copy-Paste Programming · Magic Numbers / Strings · Hard Coding · Cargo Cult Programming · Pokémon Exception Handling · Stringly-Typed Programming

---

These are **fix-it** exercises, not recognition quizzes. For each one you are given a problem statement, starting code (in Go, Java, or Python — the language varies on purpose), acceptance criteria, and a collapsible solution. The point is to *make the change*: extract the duplicated rule, name the magic value, get the secret out of git, justify or delete the cargo-culted line, replace the catch-all with a deliberate strategy, and let the type system reject the typo.

> **How to use this file.** Read the problem, try it in your editor *before* opening the solution, then compare. The "why it's better" note under each solution matters more than the diff — a shortcut removed is a recurring cost removed. One exercise (Exercise 2) is a deliberate trap: the "obvious" fix is wrong. Refer back to [`junior.md`](junior.md) for the shapes and [`middle.md`](middle.md) for the countermoves and their over-applied failure modes.

---

## Table of Contents

| # | Exercise | Anti-pattern(s) | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Extract the duplicated rule](#exercise-1--extract-the-duplicated-rule) | Copy-Paste | Python | ★ easy |
| 2 | [The DRY trap — do NOT merge](#exercise-2--the-dry-trap--do-not-merge) | Copy-Paste (coincidental) | Go | ★ easy |
| 3 | [Name the magic values](#exercise-3--name-the-magic-values) | Magic Numbers/Strings | Java | ★ easy |
| 4 | [Magic strings → enum](#exercise-4--magic-strings--enum) | Magic Strings + Stringly-Typed | Python | ★★ medium |
| 5 | [Move hard-coded values to config](#exercise-5--move-hard-coded-values-to-config) | Hard Coding | Go | ★★ medium |
| 6 | [Get the committed secret out](#exercise-6--get-the-committed-secret-out) | Hard Coding (secret) | (process) | ★★★ hard |
| 7 | [Justify or delete the cargo-culted lines](#exercise-7--justify-or-delete-the-cargo-culted-lines) | Cargo Cult | Python | ★★ medium |
| 8 | [Replace Pokémon catch with a strategy](#exercise-8--replace-pokémon-catch-with-a-strategy) | Pokémon Exceptions | Python | ★★ medium |
| 9 | [Preserve the cause when wrapping](#exercise-9--preserve-the-cause-when-wrapping) | Pokémon Exceptions | Java | ★★ medium |
| 10 | [Wrapper types stop the argument swap](#exercise-10--wrapper-types-stop-the-argument-swap) | Stringly-Typed | Go | ★★★ hard |
| 11 | [Invariant value type](#exercise-11--invariant-value-type) | Stringly-Typed + Magic | Java | ★★★ hard |
| 12 | [Mini-project: clean up the `notifier`](#exercise-12--mini-project-clean-up-the-notifier) | All six | Python | ★★★★ project |
| 13 | [Write a pre-commit / lint config](#exercise-13--write-a-pre-commit--lint-config) | meta | (config) | ★★ medium |
| 14 | [Write a review checklist](#exercise-14--write-a-review-checklist) | meta | — | ★★ medium |

---

## Exercise 1 — Extract the duplicated rule

**Anti-pattern:** Copy-Paste · **Language:** Python · **Difficulty:** ★ easy

The free-shipping rule is copy-pasted into three pricing functions. A product manager just changed the threshold from `100` to `150` — find out how many places you'd have to edit, then fix it so the answer is *one*.

```python
def price_member(items):
    total = sum(i.price for i in items)
    shipping = 0 if total > 100 else 9.99      # free shipping rule
    return total * 0.9 + shipping

def price_guest(items):
    total = sum(i.price for i in items)
    shipping = 0 if total > 100 else 9.99      # SAME rule, copied
    return total + shipping

def price_gift(items):
    total = sum(i.price for i in items)
    shipping = 0 if total > 100 else 9.99      # SAME rule, copied again
    return total + 4.99                         # gift wrap, no member discount
```

**Acceptance criteria**
- The free-shipping rule (the threshold *and* the `9.99` fee) lives in exactly one place.
- Changing the threshold to `150` is a one-line edit.
- Behavior is identical for all three functions.

**Hint:** the duplicated *knowledge* is "how shipping is computed from a total." Extract it; name the literals while you're there (you're touching them anyway).

<details>
<summary>Solution</summary>

```python
FREE_SHIPPING_THRESHOLD = 150   # was 100; one edit, everywhere
STANDARD_SHIPPING = 9.99
MEMBER_DISCOUNT = 0.9

def shipping_for(total: float) -> float:
    return 0.0 if total > FREE_SHIPPING_THRESHOLD else STANDARD_SHIPPING

def price_member(items):
    total = sum(i.price for i in items)
    return total * MEMBER_DISCOUNT + shipping_for(total)

def price_guest(items):
    total = sum(i.price for i in items)
    return total + shipping_for(total)

def price_gift(items):
    total = sum(i.price for i in items)
    return total + 4.99   # gift wrap; intentionally no member discount
```

**Why it's better.** The shipping rule now has one authoritative home, so the threshold change is a single edit instead of a three-file hunt where you'd probably miss one. Naming the literals (`FREE_SHIPPING_THRESHOLD`, `STANDARD_SHIPPING`) turned the comment into code the reader can't ignore. Note we did *not* merge the three price functions themselves — they encode genuinely different rules (member discount, gift wrap), so only the *shared* knowledge was extracted. That distinction is the whole point of Exercise 2.

</details>

---

## Exercise 2 — The DRY trap — do NOT merge

**Anti-pattern:** Copy-Paste (coincidental duplication) · **Language:** Go · **Difficulty:** ★ easy

Here are two validators that look *identical*. An over-eager reviewer demands you "DRY them up" into one shared function. Decide whether to comply — and justify your answer.

```go
// usernames must be 3–20 characters
func ValidateUsername(s string) bool {
	return len(s) >= 3 && len(s) <= 20
}

// passwords must be 3–20 characters (today)
func ValidatePassword(s string) bool {
	return len(s) >= 3 && len(s) <= 20
}
```

Context you have: the security team has a ticket open to raise password length to **8–64** next sprint. Usernames are staying at 3–20.

**Acceptance criteria**
- A clear decision: merge or don't merge.
- A one-question test that justifies the decision.
- If you don't merge, show what you *would* legitimately share (if anything).

**Hint:** ask *"if one rule changes, must the other change too?"* DRY is about duplicated **knowledge**, not duplicated **text**.

<details>
<summary>Solution</summary>

**Decision: do NOT merge them.** The two functions are textually identical *today* but encode **independent business rules**. The deciding question — *"if the password rule changes, must the username rule change too?"* — answers **no**. We already know they're about to diverge (passwords → 8–64). Merging into `validateLength(s, min, max)` would couple two unrelated rules; next sprint you'd either thread parameters through every call site or split them back out. This is **coincidental duplication**, and merging it is the "wrong abstraction."

The correct change is to make each rule's *own* knowledge explicit — name its bounds — which also documents that they are separate:

```go
const (
	usernameMinLen = 3
	usernameMaxLen = 20
	passwordMinLen = 8   // raised this sprint; ValidateUsername untouched, exactly as intended
	passwordMaxLen = 64
)

func ValidateUsername(s string) bool {
	return len(s) >= usernameMinLen && len(s) <= usernameMaxLen
}

func ValidatePassword(s string) bool {
	return len(s) >= passwordMinLen && len(s) <= passwordMaxLen
}
```

There *is* one thing you could legitimately share — the mechanical "is length in `[min,max]`" check — but only as a generic, intent-free helper that takes the bounds as parameters, never as a single `validateUsernameOrPassword`:

```go
func lenBetween(s string, min, max int) bool { return len(s) >= min && len(s) <= max }
```

That's fine because `lenBetween` carries no business meaning; the *rules* still live in the two named, separate functions.

**Why it's better.** We avoided coupling two rules that change for different reasons. The lesson is the inverse of Exercise 1: there, the duplication *was* shared knowledge, so we extracted it; here, the duplication is a coincidence, so extracting it would have manufactured the very coupling DRY is meant to prevent. The test is always the same — *must these change together?*

</details>

---

## Exercise 3 — Name the magic values

**Anti-pattern:** Magic Numbers / Strings · **Language:** Java · **Difficulty:** ★ easy

Every literal in this method is a riddle. Name them so the next reader doesn't have to guess — and so a typo like `8640` instead of `86400` becomes obvious.

```java
boolean isSessionValid(Session s) {
    if (s.ageSeconds() > 86400) {                 // 86400 = ??
        return false;
    }
    if (s.failedAttempts() >= 5) {                // 5 = ??
        return false;
    }
    if (s.role().equals("2")) {                   // "2" = ??
        return s.ageSeconds() <= 3600;            // 3600 = ??
    }
    return true;
}
```

**Acceptance criteria**
- No bare literal does real work; each has a name that states its *meaning*, not its value.
- Constants live near the code that owns them (not a global `Constants` dumping ground).
- Behavior is unchanged.

**Hint:** name the *concept* (`MAX_SESSION_SECONDS`), never the value (`final int EIGHTY_SIX_FOUR_HUNDRED`). For `"2"` a constant is the minimum; an enum is better (see Exercise 4).

<details>
<summary>Solution</summary>

```java
private static final long MAX_SESSION_SECONDS  = 86_400; // 24h
private static final long ADMIN_SESSION_SECONDS = 3_600; // 1h — admins re-auth hourly
private static final int  MAX_FAILED_ATTEMPTS  = 5;
private static final String ROLE_ADMIN         = "2";    // better still: an enum

boolean isSessionValid(Session s) {
    if (s.ageSeconds() > MAX_SESSION_SECONDS) {
        return false;
    }
    if (s.failedAttempts() >= MAX_FAILED_ATTEMPTS) {
        return false;
    }
    if (s.role().equals(ROLE_ADMIN)) {
        return s.ageSeconds() <= ADMIN_SESSION_SECONDS;
    }
    return true;
}
```

**Why it's better.** Each constant's *name is the documentation* — `MAX_SESSION_SECONDS` tells you what `86_400` means without a comment, and the digit-group separator (`86_400`) makes a missing zero visible. The reader now understands the policy ("sessions last a day, admins re-auth hourly, five strikes locks out") at a glance. The constants sit with the method that owns them, not in a far-off catch-all file. The lingering smell is `ROLE_ADMIN = "2"`: it's a magic *string* standing in for a category, which is exactly the stringly-typed problem Exercise 4 fixes properly.

</details>

---

## Exercise 4 — Magic strings → enum

**Anti-pattern:** Magic Strings + Stringly-Typed · **Language:** Python · **Difficulty:** ★★ medium

Order status is a free-form string compared by value all over the codebase. A typo (`"shiped"`) compiles and runs; it just silently never matches. Replace the strings with an enum so illegal values can't exist and typos fail loudly.

```python
def can_cancel(order) -> bool:
    return order.status in ("pending", "paid")     # typo here = silent bug

def advance(order):
    if order.status == "pending":
        order.status = "paid"
    elif order.status == "paid":
        order.status = "shiped"                     # typo! never matches "shipped"
    elif order.status == "shipped":
        order.status = "delivered"

def label(order) -> str:
    return {"pending": "Awaiting payment",
            "paid": "Paid",
            "shipped": "On its way",
            "delivered": "Delivered"}.get(order.status, "Unknown")
```

**Acceptance criteria**
- Status is a fixed, enumerated set; an invalid status cannot be assigned.
- Comparisons use the enum, not round-tripped strings.
- The `"shiped"` typo becomes impossible (it won't even parse).
- Transitions remain the same: pending → paid → shipped → delivered.

**Hint:** use `enum.Enum`. Keep the human-readable label as enum data or a separate mapping keyed by the enum, not by a raw string.

<details>
<summary>Solution</summary>

```python
from enum import Enum

class Status(Enum):
    PENDING   = "pending"
    PAID      = "paid"
    SHIPPED   = "shipped"
    DELIVERED = "delivered"

_NEXT = {
    Status.PENDING: Status.PAID,
    Status.PAID:    Status.SHIPPED,
    Status.SHIPPED: Status.DELIVERED,
}

_LABELS = {
    Status.PENDING:   "Awaiting payment",
    Status.PAID:      "Paid",
    Status.SHIPPED:   "On its way",
    Status.DELIVERED: "Delivered",
}

def can_cancel(order) -> bool:
    return order.status in (Status.PENDING, Status.PAID)

def advance(order):
    nxt = _NEXT.get(order.status)
    if nxt is not None:
        order.status = nxt          # Status.SHIPED would be an AttributeError — caught instantly

def label(order) -> str:
    return _LABELS[order.status]    # total over the enum; no "Unknown" fallback needed
```

**Why it's better.** The `"shiped"` typo is now *unwritable*: `Status.SHIPED` raises `AttributeError` the first time the code runs, instead of compiling into a status that silently never matches. The set of valid statuses is discoverable (your IDE lists `Status.` members) and closed (you can't assign `"banana"`). The transition table makes the lifecycle readable in one place, and `label` is total over the enum, so the defensive `"Unknown"` fallback — which existed only because *any* string was possible — disappears. We compare enum members directly rather than round-tripping back to strings, which would have re-created the smell.

> **Watch the trap from [`middle.md`](middle.md):** enums are for *fixed, code-known* sets. If statuses were user-defined or arrived from an external system as open data, an enum would force a redeploy to add a value — there a validated string or a lookup table is the right tool.

</details>

---

## Exercise 5 — Move hard-coded values to config

**Anti-pattern:** Hard Coding · **Language:** Go · **Difficulty:** ★★ medium

This service has its database URL, an upload directory tied to one laptop, a per-environment timeout, and an API token all baked into source. Move the environment-dependent values to configuration — and treat the token as a secret, not just config.

```go
func connect() (*sql.DB, error) {
	return sql.Open("postgres", "postgres://admin:S3cr3t@10.0.0.5:5432/prod") // creds in source!
}

const uploadDir = "/Users/alex/dev/app/uploads"   // exists only on Alex's laptop

func callPartner(payload []byte) error {
	client := &http.Client{Timeout: 5 * time.Second} // same in dev and prod — should it be?
	req, _ := http.NewRequest("POST", "https://api.partner.com/v1/ingest", bytes.NewReader(payload))
	req.Header.Set("Authorization", "Bearer bm9aF2bQ7xK") // hard-coded live token!
	_, err := client.Do(req)
	return err
}
```

**Acceptance criteria**
- DB URL, upload dir, partner base URL, and timeout come from configuration (env vars), read once at startup.
- The API token comes from the environment, never a literal — and you note it must be a *secret*, not committed config.
- Startup fails fast with a clear message if a required value is missing.
- A truly fixed value (if any) may stay a constant — justify it.

**Hint:** load config into a struct at startup; pass it (or the values) where needed. Distinguish "config" (URL, dir, timeout — non-secret, could even live in a checked-in per-env file) from "secret" (the token — env-injected or a secrets manager, never git).

<details>
<summary>Solution</summary>

```go
type Config struct {
	DatabaseURL   string
	UploadDir     string
	PartnerURL    string
	PartnerToken  string        // SECRET: injected at runtime, never committed
	PartnerTimeout time.Duration
}

func LoadConfig() (Config, error) {
	cfg := Config{
		DatabaseURL:  os.Getenv("DATABASE_URL"),
		UploadDir:    os.Getenv("UPLOAD_DIR"),
		PartnerURL:   os.Getenv("PARTNER_URL"),
		PartnerToken: os.Getenv("PARTNER_TOKEN"), // from a secrets manager / vault in prod
	}
	// fail fast: a missing required value should crash at startup, not at first request
	for k, v := range map[string]string{
		"DATABASE_URL": cfg.DatabaseURL, "UPLOAD_DIR": cfg.UploadDir,
		"PARTNER_URL": cfg.PartnerURL, "PARTNER_TOKEN": cfg.PartnerToken,
	} {
		if v == "" {
			return Config{}, fmt.Errorf("missing required env var %s", k)
		}
	}
	timeout, err := time.ParseDuration(getEnvOr("PARTNER_TIMEOUT", "5s"))
	if err != nil {
		return Config{}, fmt.Errorf("invalid PARTNER_TIMEOUT: %w", err)
	}
	cfg.PartnerTimeout = timeout
	return cfg, nil
}

func getEnvOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func connect(cfg Config) (*sql.DB, error) {
	return sql.Open("postgres", cfg.DatabaseURL)
}

func callPartner(cfg Config, payload []byte) error {
	client := &http.Client{Timeout: cfg.PartnerTimeout}
	req, err := http.NewRequest("POST", cfg.PartnerURL, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+cfg.PartnerToken)
	_, err = client.Do(req)
	return err
}
```

**Why it's better.** The same binary now runs unchanged in dev, staging, and prod — only the environment differs, which is exactly [12-factor](https://12factor.net) config (factor III). The credential and live token are no longer fossilized in source (and therefore in git history forever); the token is explicitly classified as a **secret** that comes from a manager at runtime. Startup *fails fast* with a named missing variable, so a misconfiguration is a loud boot error instead of a mysterious 3 a.m. request failure. The timeout has a sane default but can be tuned per environment.

> **Don't over-correct into [Soft Coding](../03-over-engineering/middle.md):** if a value genuinely never differs between environments (say, `secondsPerDay`), leave it a constant. Configure what *varies by deploy*; hard-code what doesn't.

</details>

---

## Exercise 6 — Get the committed secret out

**Anti-pattern:** Hard Coding (a leaked secret) · **Difficulty:** ★★★ hard · *(process exercise — no single code answer)*

During Exercise 5 you discovered the live token `bm9aF2bQ7xK` was hard-coded — and `git log -S` shows it was committed **eight months ago** and is in dozens of clones and the public-fork history. A junior says, "I removed it from the file and pushed, we're good." You are **not** good. Write the full remediation plan.

**Acceptance criteria**
- Explain why deleting the line and pushing does **not** fix the exposure.
- A correct, ordered remediation: what to do *first*, and why.
- The history-rewrite steps (with the actual tool), and the caveat about clones/forks.
- A prevention step so it can't recur.

**Hint:** the order matters — rotation comes before history surgery. Git history is forever and already distributed; assume the secret is compromised the moment it was pushed.

<details>
<summary>Solution</summary>

**Why "I deleted the line" is not enough.** Removing the token in a *new* commit leaves it fully intact in every *previous* commit. Anyone with the repo (every clone, every CI cache, every fork, anyone who scraped it) can `git show <old-sha>` and read it. Git history is append-only and already distributed; once a secret is pushed, treat it as **compromised**, full stop.

**Remediation, in order:**

1. **Rotate first — this is the only step that actually stops the bleeding.** Go to the partner's dashboard, **revoke** `bm9aF2bQ7xK`, and issue a new token. Until the old token is invalidated, nothing else you do matters — the leaked value still works. Deploy the new token via the secrets manager / env (per Exercise 5), never as a literal.

2. **Confirm the new token works and the old one is dead.** Smoke-test the integration with the new token; verify a call using the old token now returns `401`.

3. **Purge it from history** (defense in depth — reduces accidental re-exposure, but is *not* a substitute for rotation):
   ```bash
   # Preferred modern tool:
   git filter-repo --replace-text <(echo 'bm9aF2bQ7xK==>REDACTED')
   # (older alternative: the BFG Repo-Cleaner)
   ```
   Then force-push the rewritten history and have **every collaborator re-clone** — a rewrite changes SHAs, so stale clones still contain the secret and can reintroduce it on merge.

4. **Handle forks and caches you don't control.** Public forks keep the old objects regardless of your rewrite. This is precisely why **step 1 is the real fix**: you cannot un-leak data that already left your control, you can only invalidate it. Ask the platform (e.g. GitHub support) to garbage-collect cached views if it was public.

5. **Notify** per your incident policy (security team, and the partner if their dashboard shows the key was used from unexpected IPs).

6. **Prevent recurrence:** add a secret scanner to **pre-commit and CI** (`gitleaks` / `git-secrets` / `trufflehog`) so the next token is rejected *before* it ever reaches history — see Exercise 13.

**Why this is the right order.** The catastrophic, irreversible part of a leaked secret is that it's *valid*, not that it's *visible*. Rotation removes the validity immediately; history surgery and notifications reduce blast radius but cannot recall data that's already distributed. A junior who only rewrites history has left a working credential in dozens of clones. Rotate, then clean, then prevent.

</details>

---

## Exercise 7 — Justify or delete the cargo-culted lines

**Anti-pattern:** Cargo Cult · **Language:** Python · **Difficulty:** ★★ medium

This function was assembled by pasting from three different Stack Overflow answers. For each suspicious line, decide: *justified* (keep, with a reason) or *cargo cult* (delete). Then produce the cleaned-up version.

```python
import os
os.environ["PYTHONHASHSEED"] = "0"          # (a) "saw this in someone's repo"

def load_users(path):
    time.sleep(0.5)                          # (b) "the tutorial had a sleep"
    df = pd.read_csv(path)
    df = df.copy()                           # (c) "to be safe"
    df = df[df["active"] == True]            # (d) actual filter we need
    df.reset_index(drop=True, inplace=True)  # (e) ?
    try:
        df["email"] = df["email"].str.lower()
    except:                                   # (f) "in case email is missing"
        pass
    return df.reset_index().reset_index()    # (g) reset twice "just in case"
```

**Acceptance criteria**
- A one-line verdict (justified / cargo cult) for each labeled line, with the reason.
- A cleaned version keeping only what earns its place.
- The "in case email is missing" concern, if real, handled deliberately — not by a bare `except`.

**Hint:** the smell test is *"can I explain why this line is here, and what breaks without it?"* "To be safe" / "just in case" / "the tutorial had it" are confessions, not justifications. Line (f) is also a Pokémon catch hiding inside the cargo cult.

<details>
<summary>Solution</summary>

**Verdicts:**

- **(a)** `PYTHONHASHSEED = "0"` → **cargo cult.** Set at runtime it doesn't even take effect (it must be set *before* the interpreter starts), and there's no reproducibility requirement here. Delete.
- **(b)** `time.sleep(0.5)` → **cargo cult.** A sleep copied from a tutorial (often there to dodge a rate limit or a demo race) does nothing here but slow every call. Delete.
- **(c)** `df.copy()` → **cargo cult as written.** It's defending against a `SettingWithCopyWarning` that the rest of the code doesn't trigger; "to be safe" is not a reason. Delete — and if a real chained-assignment warning appears, fix *that* deliberately.
- **(d)** the `active == True` filter → **justified.** It's the actual business requirement. Keep (and tidy to the idiomatic `df["active"]`).
- **(e)** `reset_index(drop=True)` → **justified, conditionally.** After filtering rows, resetting the index is reasonable *if* downstream code relies on a contiguous 0..n index. Keep one reset, with a comment on why.
- **(f)** `try/except: pass` → **cargo cult + Pokémon.** It swallows *everything*, including real bugs. If "email may be missing" is a genuine case, check for it explicitly. Replace.
- **(g)** `reset_index().reset_index()` → **cargo cult.** Resetting twice creates two junk columns; nobody can explain it. Delete.

**Cleaned version:**

```python
def load_users(path):
    df = pd.read_csv(path)
    df = df[df["active"]]                 # (d) the real requirement
    if "email" in df.columns:            # (f) the real concern, handled deliberately
        df["email"] = df["email"].str.lower()
    return df.reset_index(drop=True)     # (e) one intentional reset for a clean 0..n index
```

**Why it's better.** Every remaining line has a reason you could defend in review; the borrowed noise — a no-op env tweak, a gratuitous sleep, a defensive copy, a double reset — is gone, and with it the false sense that those lines were load-bearing. The genuine "email might be missing" concern is now handled by an explicit `if "email" in df.columns`, which is both correct and readable, instead of a bare `except` that would also have hidden a typo in the column name or a real pandas bug. The function got faster, shorter, and *explainable*.

</details>

---

## Exercise 8 — Replace Pokémon catch with a strategy

**Anti-pattern:** Pokémon Exception Handling · **Language:** Python · **Difficulty:** ★★ medium

This handler catches everything and logs a useless message, so a declined card, an invalid request, and a genuine bug all look the same — and the customer is told "ok" regardless. Replace it with a deliberate strategy: classify recoverable failures vs bugs, handle the recoverable ones meaningfully, and let bugs crash loudly.

```python
def checkout(request_body):
    try:
        data = json.loads(request_body)
        user = db.get_user(data["user_id"])
        charge(user, data["amount"])
        return {"status": "ok"}
    except Exception:
        log.error("something went wrong")   # which thing? we'll never know
        return {"status": "ok"}             # lies to the customer
```

Available signals: `json.JSONDecodeError` (bad input), `db.get_user` returns `None` for a missing user, `charge` raises `PaymentDeclined(reason)` for a declined card.

**Acceptance criteria**
- Bad JSON → a clear 400-style result; it's the client's fault, recoverable.
- Missing user → an explicit, handled outcome (not an exception swallowed).
- Declined card → a meaningful result carrying the reason.
- Any *other* exception (a bug — `KeyError`, `TypeError`, etc.) propagates loudly to the framework boundary; it is **not** swallowed.
- No catch-all returns `"ok"`.

**Hint:** catch *specific* types near where you can act, return distinct results, and resist the urge to wrap the whole thing in one `try`. A missing user is a value condition (`None`), not an exception to catch.

<details>
<summary>Solution</summary>

```python
def checkout(request_body):
    # 1) Bad input — expected, recoverable, the client's fault.
    try:
        data = json.loads(request_body)
    except json.JSONDecodeError:
        return {"status": "error", "code": 400, "message": "invalid JSON"}

    # A missing key is a malformed request, also the client's fault — handle, don't crash.
    if "user_id" not in data or "amount" not in data:
        return {"status": "error", "code": 400, "message": "user_id and amount required"}

    # 2) Missing user — a value condition, not an exception.
    user = db.get_user(data["user_id"])
    if user is None:
        return {"status": "error", "code": 404, "message": "user not found"}

    # 3) Declined card — expected, recoverable; carry the reason.
    try:
        charge(user, data["amount"])
    except PaymentDeclined as e:
        return {"status": "declined", "code": 402, "message": e.reason}

    # 4) Any other exception (a real bug) is NOT caught here — it propagates to the
    #    framework's error boundary, gets logged with a full stack trace, and gets fixed.
    return {"status": "ok"}
```

**Why it's better.** Each *expected* failure now has its own narrow catch (or value check) and a distinct, honest result — the customer is no longer told "ok" when their card was declined. The three recoverable cases (bad JSON, missing user, declined card) are handled where the code can actually do something about them. Crucially, the catch-all is *gone*: a `KeyError` or `TypeError` from a real coding mistake now surfaces with a stack trace at the framework boundary instead of being disguised as success — so you find the bug instead of shipping silent corruption. The missing user is modeled as a `None` value rather than an exception, which is both faster and clearer.

</details>

---

## Exercise 9 — Preserve the cause when wrapping

**Anti-pattern:** Pokémon Exception Handling (the subtle variant) · **Language:** Java · **Difficulty:** ★★ medium

This code *does* catch and rethrow — so it looks responsible — but it throws away the original exception, leaving on-call staff a message with no stack trace and no clue what actually failed. Fix the wrapping so the cause is preserved, and stop swallowing the bug-class exception.

```java
public Invoice loadInvoice(String id) {
    try {
        String json = http.get("/invoices/" + id);   // can throw IOException
        return parser.parse(json);                    // can throw ParseException
    } catch (Exception e) {
        // rethrows a generic message — original cause and stack trace are lost
        throw new RuntimeException("could not load invoice");
    }
}
```

**Acceptance criteria**
- The original exception is chained as the cause (so the stack trace survives).
- Expected, distinct failures (network vs parse) are translated to a meaningful domain exception.
- A truly unexpected exception (a bug) is not silently rebranded.
- The message includes the `id` for context.

**Hint:** Java's `Throwable` takes a `cause` argument — use it (`new XException(msg, e)`). Catch the specific types you expect; don't flatten `IOException` and a `NullPointerException` into the same generic wrapper.

<details>
<summary>Solution</summary>

```java
public class InvoiceLoadException extends RuntimeException {
    public InvoiceLoadException(String message, Throwable cause) {
        super(message, cause);   // <-- the cause is preserved
    }
}

public Invoice loadInvoice(String id) {
    String json;
    try {
        json = http.get("/invoices/" + id);
    } catch (IOException e) {
        // expected failure: network/IO. Translate, but KEEP the cause.
        throw new InvoiceLoadException("failed to fetch invoice " + id, e);
    }

    try {
        return parser.parse(json);
    } catch (ParseException e) {
        // expected failure: malformed response. Translate, keep the cause.
        throw new InvoiceLoadException("invoice " + id + " returned malformed JSON", e);
    }
    // A NullPointerException or other bug is NOT caught — it propagates unchanged,
    // with its original stack trace, to be found and fixed.
}
```

**Why it's better.** The original `IOException`/`ParseException` is chained via the `cause` constructor, so the logged stack trace shows the *real* failure (`Caused by: java.net.SocketTimeoutException ...`) instead of a context-free `"could not load invoice"`. The two expected failures are translated into a single, meaningful domain exception (`InvoiceLoadException`) that callers can catch — and the message includes the `id`, so the log line is actionable. The earlier `catch (Exception e)` would also have swallowed and rebranded a `NullPointerException` from a genuine bug; now such an exception propagates untouched and gets fixed. Dropping the cause is a *subtle* Pokémon: you appear to handle the error while destroying the one artifact that explains it.

</details>

---

## Exercise 10 — Wrapper types stop the argument swap

**Anti-pattern:** Stringly-Typed · **Language:** Go · **Difficulty:** ★★★ hard

Every identifier in this API is a bare `string`, so a user ID and an email are interchangeable to the compiler. Two call sites have silently swapped their arguments and nobody noticed. Introduce distinct types so the swap becomes a compile error.

```go
// Everything is a string — the compiler can't tell a UserID from an Email from a raw name.
func GrantAccess(userID string, resource string) error { ... }
func SendWelcome(email string, name string) error      { ... }

func onSignup(id string, email string, name string) error {
	if err := GrantAccess(email, "dashboard"); err != nil {  // BUG: passed email as userID
		return err
	}
	return SendWelcome(name, email)                           // BUG: name and email swapped
}
```

**Acceptance criteria**
- `UserID` and `Email` are distinct types that cannot be passed where the other is expected.
- The two existing bugs become compile errors.
- Construction of an `Email` (at the boundary) validates it, so an invalid email can't enter the system.
- Internal call sites pass the typed values, not raw strings.

**Hint:** Go's `type UserID string` creates a *distinct* type (not just an alias) — `GrantAccess(Email, ...)` won't compile. Add a constructor `NewEmail(string) (Email, error)` to validate at the boundary.

<details>
<summary>Solution</summary>

```go
type UserID string
type Email string

// Construct (and validate) Email at the trust boundary; an invalid Email can't exist.
func NewEmail(s string) (Email, error) {
	if !strings.Contains(s, "@") || strings.HasPrefix(s, "@") {
		return "", fmt.Errorf("invalid email: %q", s)
	}
	return Email(strings.ToLower(s)), nil
}

func GrantAccess(userID UserID, resource string) error { ... }
func SendWelcome(email Email, name string) error       { ... }

func onSignup(id UserID, email Email, name string) error {
	if err := GrantAccess(email, "dashboard"); err != nil {
		//                  ^^^^^ compile error: cannot use email (Email) as UserID
		return err
	}
	return SendWelcome(name, email)
	//                 ^^^^  ^^^^^ compile error: arguments don't match (name is string, not Email)
}
```

Corrected call site, with the swaps fixed:

```go
func onSignup(id UserID, email Email, name string) error {
	if err := GrantAccess(id, "dashboard"); err != nil {   // id, not email
		return err
	}
	return SendWelcome(email, name)                        // email, name — right order
}

// At the HTTP boundary, raw strings become typed values exactly once:
func handleSignup(w http.ResponseWriter, r *http.Request) {
	email, err := NewEmail(r.FormValue("email"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	id := UserID(r.FormValue("user_id"))
	_ = onSignup(id, email, r.FormValue("name"))
}
```

**Why it's better.** The compiler now enforces what the variable *names* only suggested before: a `UserID` and an `Email` are different things and cannot be interchanged. Both pre-existing bugs — passing an email where a user ID belongs, and swapping `name`/`email` — turn into build failures, caught in seconds instead of in production. `NewEmail` validates and normalizes at the single boundary where untrusted strings enter, so every `Email` inside the system is known-valid (no scattered re-validation, no stringly-typed `if !valid` checks deep in business logic). This is the "make illegal states unrepresentable" idea applied to *confusable* values, not just fixed sets.

> **Don't over-type:** a one-off local string (a log message, a temp filename) doesn't need a wrapper. Reach for distinct types when values cross boundaries, carry invariants, or are easily confused — exactly the case here.

</details>

---

## Exercise 11 — Invariant value type

**Anti-pattern:** Stringly-Typed + Magic · **Language:** Java · **Difficulty:** ★★★ hard

A discount percentage is passed around as a raw `double`. Nothing stops `150.0` or `-10.0`, so invalid percentages flow deep into pricing and explode (or silently corrupt totals) far from where they were created. Make an invalid percentage *impossible to construct*.

```java
// percent is a bare double — 150.0 and -10.0 are accepted everywhere
double applyDiscount(double price, double percent) {
    return price - (price * percent / 100.0);     // percent=150 → negative price!
}

// somewhere far away:
double finalPrice = applyDiscount(cart.total(), config.getDouble("promo.percent")); // could be anything
```

**Acceptance criteria**
- A `Percentage` type whose constructor rejects values outside `0..100` — so an invalid instance can never exist.
- `applyDiscount` takes a `Percentage`, not a `double`, and needs no defensive range check.
- The `100.0` divisor is named, not magic.
- Construction failure surfaces at the boundary (where the config value is read), not deep in pricing.

**Hint:** a Java `record` with a compact constructor enforces the invariant once. After that, every `Percentage` is valid by construction, so downstream code can trust it.

<details>
<summary>Solution</summary>

```java
public record Percentage(double value) {
    private static final double MIN = 0.0;
    private static final double MAX = 100.0;

    // Compact constructor: the ONLY way to make a Percentage validates it.
    public Percentage {
        if (value < MIN || value > MAX) {
            throw new IllegalArgumentException("percentage must be 0..100, got " + value);
        }
    }

    double asFraction() {
        return value / MAX;   // MAX is named; no magic 100.0 sprinkled around
    }
}

// applyDiscount can TRUST its input — no defensive check, because an invalid
// Percentage cannot be passed in: it could never have been constructed.
double applyDiscount(double price, Percentage discount) {
    return price - (price * discount.asFraction());
}

// At the boundary, where the untrusted config value enters, construction validates it:
Percentage promo = new Percentage(config.getDouble("promo.percent")); // throws here if 150 or -10
double finalPrice = applyDiscount(cart.total(), promo);
```

**Why it's better.** The invariant "a percentage is between 0 and 100" is enforced in exactly one place — the constructor — so it holds *everywhere* a `Percentage` is used. `applyDiscount` drops its defensive range check entirely because the type system guarantees a valid value; you can't even call it with a bad one. A misconfigured `promo.percent = 150` now fails loudly at the boundary, with a clear message, at the moment the bad value enters — not as a mysterious negative price three layers deep in checkout. The magic `100.0` became the named `MAX`. This is stringly-typed's deeper cure: not just enums for fixed sets, but *invariant-carrying value types* so illegal values are unrepresentable rather than merely discouraged.

</details>

---

## Exercise 12 — Mini-project: clean up the `notifier`

**Anti-pattern:** all six, in one small realistic module · **Language:** Python · **Difficulty:** ★★★★ project

Below is a compact notification module that manages to commit **every** bad-shortcut anti-pattern at once: copy-pasted send logic, magic numbers and strings, a hard-coded URL and token, a cargo-culted line, a Pokémon catch, and stringly-typed channel/priority. Refactor it into clean, testable code. Work in steps; don't try to fix it all in one edit.

```python
import requests, time

def send_email_notification(user, text, level):
    time.sleep(0.2)                                  # cargo cult: "the example had it"
    if level == "1":                                 # magic string priority
        url = "https://api.notify.com/v2/email"      # hard-coded
        timeout = 30                                 # magic number
    else:
        url = "https://api.notify.com/v2/email"
        timeout = 10
    try:
        requests.post(url, json={"to": user.email, "body": text, "urgent": level == "1"},
                      headers={"Authorization": "Bearer bmNOTIFY_123"}, timeout=timeout)  # hard-coded token
    except:                                           # Pokémon
        pass

def send_sms_notification(user, text, level):
    time.sleep(0.2)                                  # copy-pasted
    if level == "1":                                 # magic string again
        url = "https://api.notify.com/v2/sms"        # hard-coded
        timeout = 30
    else:
        url = "https://api.notify.com/v2/sms"
        timeout = 10
    try:
        requests.post(url, json={"to": user.phone, "body": text, "urgent": level == "1"},
                      headers={"Authorization": "Bearer bmNOTIFY_123"}, timeout=timeout)  # same token, copied
    except:                                           # Pokémon again
        pass
```

**Acceptance criteria**
- **Copy-Paste:** the duplicated send logic lives in one place; only the per-channel difference (endpoint, recipient field) varies.
- **Magic Numbers/Strings:** timeouts named; priority is no longer `"1"`.
- **Hard Coding:** base URL and token come from config/secret, not literals.
- **Cargo Cult:** the `time.sleep` is gone (no justification).
- **Pokémon:** failures are not swallowed — recoverable errors are handled, the rest propagate; the cause is preserved.
- **Stringly-Typed:** channel and priority are enums.
- Each unit is testable without hitting the network.

**Hint:** start by listing the six. Extract the shared POST into one `send` function; model `Channel` and `Priority` as enums; inject the HTTP client and config so tests can pass fakes; replace `except: pass` with a deliberate decision (notifications are often fail-safe — log and continue — but *log*, don't vanish).

<details>
<summary>Solution</summary>

```python
import logging
from dataclasses import dataclass
from enum import Enum

log = logging.getLogger(__name__)

# --- Stringly-typed → enums. Priority is a property; Channel is dispatch. ---
class Priority(Enum):
    NORMAL = "normal"
    URGENT = "urgent"

class Channel(Enum):
    EMAIL = "email"
    SMS   = "sms"

# --- Magic numbers → named constants. ---
NORMAL_TIMEOUT_S = 10
URGENT_TIMEOUT_S = 30

# --- Hard coding → injected config + secret. ---
@dataclass
class NotifyConfig:
    base_url: str        # e.g. from os.getenv("NOTIFY_BASE_URL")
    token: str           # SECRET: from a secrets manager, never a literal

# Per-channel differences captured as data, not duplicated code.
_ENDPOINT = {Channel.EMAIL: "/email", Channel.SMS: "/sms"}

def _recipient(user, channel: Channel) -> str:
    return user.email if channel is Channel.EMAIL else user.phone

class NotifierError(Exception):
    pass

class Notifier:
    def __init__(self, http, config: NotifyConfig):
        self._http = http          # injected client → testable without the network
        self._config = config

    # --- Copy-Paste → one send path; channel is a parameter. ---
    def notify(self, user, text: str, channel: Channel, priority: Priority) -> bool:
        url = self._config.base_url + _ENDPOINT[channel]
        timeout = URGENT_TIMEOUT_S if priority is Priority.URGENT else NORMAL_TIMEOUT_S
        payload = {"to": _recipient(user, channel), "body": text,
                   "urgent": priority is Priority.URGENT}
        headers = {"Authorization": f"Bearer {self._config.token}"}
        try:
            resp = self._http.post(url, json=payload, headers=headers, timeout=timeout)
            resp.raise_for_status()
            return True
        except Exception as e:
            # --- Pokémon → deliberate fail-safe: a failed notification shouldn't crash
            #     the caller, but it must NEVER vanish. Log with context + cause. ---
            log.warning("notification failed channel=%s user=%s: %s",
                        channel.value, getattr(user, "id", "?"), e, exc_info=True)
            return False
```

**What happened to each anti-pattern:**

- **Copy-Paste →** the two near-identical functions collapsed into one `notify`; the only real differences (endpoint, recipient field) became a small lookup table and a one-line helper.
- **Magic Numbers/Strings →** `30`/`10` became `URGENT_TIMEOUT_S`/`NORMAL_TIMEOUT_S`; the `"1"` priority became `Priority.URGENT`.
- **Hard Coding →** base URL and token moved into an injected `NotifyConfig`; the token is flagged as a secret sourced at runtime, not a literal (and so it never enters git — see Exercise 6).
- **Cargo Cult →** the unexplained `time.sleep(0.2)` is deleted.
- **Pokémon →** `except: pass` became a *deliberate* fail-safe: it logs with channel/user context and the cause (`exc_info=True`) and returns `False` so the caller can react — the failure is handled, not hidden.
- **Stringly-Typed →** `Channel` and `Priority` are enums, so an invalid channel or a `"1"` typo can't be passed.

**Why it's better.** You can now unit-test `notify` by injecting a fake `http` whose `.post` records the call (or raises) — no real network, deterministic, fast. Adding a "push" channel is one enum member plus one endpoint-table entry, touching no existing send logic. The failure path is honest: notifications still degrade gracefully (one failed SMS shouldn't break checkout), but every failure leaves a logged trail with its cause, so you can actually diagnose them. The refactor was done as a sequence — enums, then extract the shared send, then inject config, then fix the catch — never as a big-bang rewrite, exactly the discipline from [`middle.md`](middle.md).

</details>

---

## Exercise 13 — Write a pre-commit / lint config

**Anti-pattern:** meta (automated prevention) · **Difficulty:** ★★ medium

A checklist relies on humans remembering. Most bad shortcuts are *mechanically detectable* — so push the fight upstream into tooling. Write a `.pre-commit-config.yaml` (plus the matching linter rules) that automatically blocks the highest-cost shortcuts before they ever reach history: **committed secrets**, **magic numbers**, **bare excepts**, and **copy-paste duplication**.

**Acceptance criteria**
- A real, runnable `pre-commit` config wiring up: a secret scanner, a magic-number lint rule, a bare-except rule, and a duplication detector.
- The single most important hook (the irreversible one) called out and explained.
- A note on which shortcuts tooling *can't* reliably catch (so review still matters).

**Hint:** `gitleaks` for secrets, `pylint`/`ruff` or `flake8` for bare-except and magic numbers, `jscpd` or SonarQube CPD for duplication. Secrets are the one with catastrophic, irreversible cost — make that hook non-negotiable.

<details>
<summary>Solution</summary>

```yaml
# .pre-commit-config.yaml
repos:
  # 1) SECRETS — the non-negotiable hook. A leaked credential is the one shortcut
  #    whose cost (Exercise 6) is catastrophic and irreversible. Block it BEFORE
  #    it ever enters history; nothing downstream can un-leak a pushed secret.
  - repo: https://github.com/gitleaks/gitleaks
    rev: v8.18.0
    hooks:
      - id: gitleaks

  # 2) Magic numbers + bare excepts (Python) via Ruff (fast, covers many linters).
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.5.0
    hooks:
      - id: ruff
        args: [--select, "PLR2004,E722,BLE001"]
        #  PLR2004 = magic value used in comparison
        #  E722    = bare 'except:'
        #  BLE001  = blind 'except Exception'

  # 3) Copy-paste duplication detector.
  - repo: https://github.com/kucherenko/jscpd
    rev: v3.5.10
    hooks:
      - id: jscpd
        args: [--threshold, "0", --min-tokens, "50"]  # fail on any new duplication block
```

Equivalent linter knobs in other ecosystems:

| Shortcut | Tool / rule |
|---|---|
| Committed secret | `gitleaks`, `git-secrets`, `trufflehog` |
| Magic number | `pylint R2004`, ESLint `no-magic-numbers`, Checkstyle `MagicNumber` |
| Bare/blind except | `ruff E722`/`BLE001`, `pylint W0702`, Go `errcheck`/`staticcheck` |
| Copy-paste | `jscpd`, PMD CPD, SonarQube duplication |

**The one that matters most: the secret scanner.** Magic numbers and duplication are *cheap to fix later* — annoying, not dangerous. A committed secret is **irreversible** (it's in history and every clone the instant it's pushed), so the only winning move is to stop it at commit time. Make `gitleaks` a required hook in pre-commit *and* re-run it in CI (developers can skip local hooks with `--no-verify`; CI can't be skipped).

**What tooling can't reliably catch.** Linters flag *syntax*, not *judgment*:
- **Cargo cult** — a line can be perfectly valid syntax and still be unjustifiable; only a human asking "why is this here?" catches it.
- **Coincidental vs real duplication** — `jscpd` flags textual similarity, but it can't tell Exercise 1 (extract!) from Exercise 2 (don't!). That's a `must these change together?` judgment.
- **Stringly-typed** — "this `String` should be an enum" requires domain knowledge of whether the value set is fixed.

So the config carries the mechanical load, and review (Exercise 14) focuses on the judgment calls.

**Why it's better.** The expensive-and-irreversible shortcut is now blocked automatically, and the tedious-but-common ones (magic numbers, bare excepts, duplication) fail the commit instead of relying on a tired reviewer at 6 p.m. Tooling handles what's mechanical; humans are freed to spend review attention on the calls only humans can make.

</details>

---

## Exercise 14 — Write a review checklist

**Anti-pattern:** meta (prevention) · **Difficulty:** ★★ medium

Bad shortcuts are cheapest to stop in code review, while the diff is still small. Write a concise, *actionable* reviewer checklist — phrased as questions a reviewer asks of a diff — that catches all six shortcuts, **including the judgment calls a linter can't make** (coincidental duplication, stringly-typed design). Aim for questions with a clear "if yes, push back" trigger, not vague advice.

**Acceptance criteria**
- One or more concrete, answerable questions per anti-pattern.
- Each question has a clear failure trigger and a suggested action.
- It explicitly covers the two DRY judgment calls (extract vs. don't) and the stringly-typed call.
- Short enough that a reviewer would actually run it on every PR.

<details>
<summary>Solution</summary>

**Bad-Shortcuts PR review checklist**

| # | Question | If the answer is… | Then |
|---|---|---|---|
| 1 | Does this PR duplicate a block that already exists? | "Yes" | Ask the follow-up (row 2) before requesting extraction. **Copy-Paste**. |
| 2 | *If* duplicated: must the two copies change **together** for the same reason? | "Yes → extract" / "No → keep separate" | Yes: extract to one home. No: it's **coincidental duplication** — leave it (Exercise 2). |
| 3 | Is there a bare literal (`42`, `"3"`, `0.08`) doing real work? | "Yes" | Push back: name it. If it differs per environment, it's config, not a constant. **Magic Number/String**. |
| 4 | Is any URL, path, or credential a literal in source? | "Yes" | Push back: move to config; **if it's a secret, block the merge and trigger rotation** (Exercise 6). **Hard Coding**. |
| 5 | Can the author explain every line they added — including borrowed ones? | "No / 'it was in the example'" | Ask them to justify or delete it. **Cargo Cult**. |
| 6 | Is there an empty `catch` / bare `except:` / `catch (Exception){}`? | "Yes" | Push back: classify recoverable vs bug; handle or propagate; preserve the cause. **Pokémon**. |
| 7 | When wrapping/rethrowing, is the original cause chained? | "No" | Push back: `raise ... from e` / `new X(msg, cause)`. **Pokémon (subtle)**. |
| 8 | Does a `String`/`int` parameter accept only a fixed set of values? | "Yes" | Push back: use an enum. **Stringly-Typed**. |
| 9 | Are two same-typed args (id/email, from/to) easy to swap at call sites? | "Yes" | Suggest distinct wrapper types so a swap won't compile. **Stringly-Typed**. |
| 10 | Did this turn *everything* into config / a new type / a wrapped exception? | "Yes" | Push back the *other* way: over-config (Soft Coding), over-typing, over-catching are real failure modes. |

**Author's pre-flight (same list, mirrored):** before requesting review, run questions 1–10 on your own diff, and let the [pre-commit config](#exercise-13--write-a-pre-commit--lint-config) catch the mechanical ones first so the reviewer can focus on rows 2, 8, 9, and 10 — the judgment calls.

**Why this is better than "review for shortcuts."** Each row has a *trigger* and an *action*, so the checklist is mechanical enough to apply under time pressure and specific enough that two reviewers reach the same conclusion. Critically, it encodes the two things linters *can't*: the extract-vs-don't DRY judgment (rows 1–2) and the "is this value set fixed?" enum judgment (row 8) — plus row 10, which guards against over-applying every fix in this file. It catches shortcuts at their cheapest moment — a 40-line diff — instead of after they've compounded into a multi-week cleanup.

</details>

---

## Summary

- These exercises move you from *recognizing* bad shortcuts to *removing* them: extract real duplication (and leave coincidental duplication alone), name magic values and lift fixed sets into enums, move environment values to config and secrets to a manager, justify or delete cargo-culted lines, replace catch-alls with a deliberate error strategy that preserves the cause, and let distinct/invariant types make illegal values unrepresentable.
- **Every fix here has an over-applied trap.** Exercise 2 is the headline: the "obvious" DRY merge is wrong. The same caution applies to over-configuration ([Soft Coding](../03-over-engineering/middle.md)), over-typing, and try/catch-everywhere. The deciding questions — *must these change together? does this value vary by deploy? is this value set fixed?* — beat reflex.
- **The secret is the one irreversible shortcut.** A committed credential must be *rotated first*, then purged from history, then prevented (Exercises 6 and 13) — deleting the line and pushing fixes nothing.
- **Prevention scales better than cure.** The meta-exercises (13, 14) move the fight upstream: a secret scanner and lint rules in pre-commit carry the mechanical load, and a review checklist catches the judgment calls tooling can't.
- The six shortcuts travel together, so a real module (Exercise 12) usually shows several at once. Remove the one in the file you're editing today, and the gravity that pulls in the others weakens.

---

## Related Topics

- [`junior.md`](junior.md) — the six shortcuts and how to recognize them on sight.
- [`middle.md`](middle.md) — when they creep in, the countermoves used here, and each fix's over-applied trap.
- [`find-bug.md`](find-bug.md) — spot-the-shortcut snippets (critical reading practice).
- [`optimize.md`](optimize.md) — more flawed implementations to clean up.
- [`interview.md`](interview.md) — Q&A across all levels for job prep.
- [Clean Code → Error Handling](../../../clean-code/06-error-handling/README.md) — the cure for Pokémon exception handling, done properly.
- [Clean Code → Meaningful Names](../../../clean-code/01-meaningful-names/README.md) — naming away magic values.
- [DRY Principle](../../../clean-code/README.md) — and Sandi Metz's "wrong abstraction" counterpoint (Exercise 2).
- [Secrets Management](../../../../../Architecture/system-design/README.md) — handling credentials safely.
- [Bad Structure](../01-bad-structure/tasks.md) — the sibling category's exercises; Cargo Cult feeds Lava Flow.
- [Over-Engineering](../03-over-engineering/middle.md) — Soft Coding and Speculative Generality: the over-applied versions of these fixes.
