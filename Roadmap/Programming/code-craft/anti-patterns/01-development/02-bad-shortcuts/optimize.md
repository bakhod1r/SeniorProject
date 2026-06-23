# Bad Shortcuts Anti-Patterns — Refactoring Practice

> **Category:** [Development Anti-Patterns](../README.md) → **Bad Shortcuts** — *convenience taken now, paid back many times later.*
> **Covers (collectively):** Copy-Paste Programming · Magic Numbers / Strings · Hard Coding · Cargo Cult Programming · Pokémon Exception Handling · Stringly-Typed Programming

---

These are not "spot the smell" puzzles — [`find-bug.md`](find-bug.md) does that. Here the code is **shortcut-ridden but already working**, and your job is to **transform it into clean code without changing behavior**. The skill on display is the *process*, not just the destination:

1. **Pin behavior first.** Write a *characterization test* — a test that records what the code does *now*, bugs included. You are freezing behavior, not blessing it. (Replacing a swallowed exception is the one place where the *point* is to change behavior — there you pin the observable output, then deliberately widen what escapes.)
2. **Take small, reversible steps.** One named refactoring at a time (Extract Function, Replace Magic Literal with Symbolic Constant, Introduce Configuration, …), tests green after each, commit.
3. **Separate structural from behavioral commits.** A pure refactor preserves behavior; an error-strategy or config change is behavioral and gets its own reviewed commit.

Each worked solution names the **canonical refactoring moves** (Fowler's *Refactoring*, Feathers' *Working Effectively with Legacy Code*) so you build the vocabulary, not just the instinct.

> **How to use this file:** read the "Before" code, write down the move sequence *yourself* before expanding the solution, then compare. The gap between your plan and the worked plan is where the learning is.

---

## Table of Contents

| # | Exercise | Anti-pattern(s) | Lang | Key moves |
|---|---|---|---|---|
| 1 | [Name the magic literals](#exercise-1--name-the-magic-literals) | Magic Numbers | Java | Replace Magic Literal with Symbolic Constant |
| 2 | [Extract the copy-pasted block](#exercise-2--extract-the-copy-pasted-block) | Copy-Paste | Python | Extract Function, DRY |
| 3 | [Leave the coincidental duplication alone](#exercise-3--leave-the-coincidental-duplication-alone) | Copy-Paste (false positive) | Python | *Restraint* — do NOT merge |
| 4 | [Hard-coded values → configuration](#exercise-4--hard-coded-values--configuration) | Hard Coding | Go | Introduce Configuration; secret handling |
| 5 | [Clean up the cargo-culted snippet](#exercise-5--clean-up-the-cargo-culted-snippet) | Cargo Cult | Python | Justify-or-delete; read the docs |
| 6 | [Catch the Pokémon exception](#exercise-6--catch-the-pokémon-exception) | Pokémon Exceptions | Java | Replace Bare Catch with Typed Handling; preserve cause |
| 7 | [Stringly-typed status → enum](#exercise-7--stringly-typed-status--enum) | Stringly-Typed | Java | Replace Type Code with Enum |
| 8 | [Distinct value types for confusable strings](#exercise-8--distinct-value-types-for-confusable-strings) | Stringly-Typed | Go | Introduce Value Type |
| 9 | [Magic strings → enum dispatch](#exercise-9--magic-strings--enum-dispatch) | Magic Strings + Stringly-Typed | Python | Replace String Dispatch with Enum/Polymorphism |
| 10 | [Copy-paste with a duplicated magic value](#exercise-10--copy-paste-with-a-duplicated-magic-value) | Copy-Paste + Magic Number | Java | Extract Function + Symbolic Constant |
| 11 | [A deliberate typed-error strategy](#exercise-11--a-deliberate-typed-error-strategy) | Pokémon + Stringly-Typed errors | Python | Error classification; wrap-with-cause |
| 12 | [Hard-coded business rules → config + value type](#exercise-12--hard-coded-business-rules--config--value-type) | Hard Coding + Magic + Stringly-Typed | Go | Introduce Configuration + Value Type |
| 13 | [The full shortcut cleanup](#exercise-13--the-full-shortcut-cleanup) | All six | Python | The whole toolbox, in order |

---

## Exercise 1 — Name the magic literals

**Anti-pattern:** Magic Numbers / Strings. **Goal:** give every load-bearing literal a name that documents its meaning. **Constraints:** identical computed result; no behavior change; the constant's *name* must encode the concept, not the value.

```java
// Before — what do 86400, 3, 0.08, and "3" mean?
boolean canRenew(Session s, User u) {
    if (s.ageSeconds() > 86400) {
        return false;
    }
    if (u.failedLogins() >= 3) {
        return false;
    }
    if (u.statusCode().equals("3")) {   // 3 = suspended
        return false;
    }
    return true;
}

double finalPrice(double base) {
    return base * 1.08;                 // 1.08 = ??
}
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize.** A table test: a session at 86399s and 86401s (boundary), a user at 2 and 3 failed logins, a suspended user, and a price computation. Snapshot the exact booleans and the price.
2. **Replace Magic Literal with Symbolic Constant** (Fowler), one literal at a time, tests green after each. Name the *concept*, not the number — `SECONDS_PER_DAY`, not `EIGHTY_SIX_FOUR_HUNDRED`.
3. The `"3"` status is two smells at once (magic *and* stringly-typed). Name it now as `STATUS_SUSPENDED`; Exercise 7 takes it the rest of the way to an enum.

```java
// After — each literal carries its meaning in its name.
static final long   MAX_SESSION_SECONDS  = 86_400;  // one day
static final int    MAX_FAILED_LOGINS    = 3;
static final String STATUS_SUSPENDED     = "3";     // TODO: promote to an enum (Ex. 7)
static final double SALES_TAX_RATE       = 0.08;

boolean canRenew(Session s, User u) {
    if (s.ageSeconds() > MAX_SESSION_SECONDS) return false;
    if (u.failedLogins() >= MAX_FAILED_LOGINS) return false;
    if (u.statusCode().equals(STATUS_SUSPENDED)) return false;
    return true;
}

double finalPrice(double base) {
    return base * (1 + SALES_TAX_RATE);
}
```

**What improved & how to verify.** The reader no longer guesses; a single edit to `SALES_TAX_RATE` updates every use, and a typo like `8640` becomes a named constant a reviewer can sanity-check. **Verify** with the snapshot test — same booleans, same price *byte-for-byte*. Note `base * 1.08` was rewritten as `base * (1 + SALES_TAX_RATE)`; confirm the test still passes, because that is an *algebraic* change that can shift the last floating-point bit. If the contract requires the exact old product, keep `base * SALES_TAX_MULTIPLIER` with `SALES_TAX_MULTIPLIER = 1.08` instead.

> **Don't name a value with a value.** `final int THREE = 3;` documents nothing. The cure is `MAX_FAILED_LOGINS`.

</details>

---

## Exercise 2 — Extract the copy-pasted block

**Anti-pattern:** Copy-Paste Programming. **Goal:** collapse duplicated *knowledge* into one home. **Constraints:** preserve both return values exactly; the shared rule must have exactly one place to change.

```python
# Before — the shipping rule is copied and will drift.
def price_for_member(items):
    total = sum(i.price for i in items)
    if total > 100:
        shipping = 0.0
    else:
        shipping = 9.99
    return round(total * 0.9 + shipping, 2)   # 10% member discount

def price_for_guest(items):
    total = sum(i.price for i in items)
    if total > 100:                            # SAME rule, copied
        shipping = 0.0
    else:
        shipping = 9.99
    return round(total + shipping, 2)
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize.** Test each function at a sub-threshold cart, an above-threshold cart, and exactly at `100` (boundary). Snapshot both rounded totals.
2. **Verify the duplication is *knowledge*, not coincidence.** Ask: *if the free-shipping threshold changes, must it change for both member and guest?* Yes — it is one business rule. Safe to merge. (Contrast with Exercise 3.)
3. **Replace Magic Literal with Symbolic Constant** for the threshold and fee while they are still in one place to find.
4. **Extract Function** `shipping_for(total)` — the one home for the rule. Then **Extract Function** the shared `subtotal`, and unify the two entry points by parameterizing the discount.

```python
# After — the rule lives in exactly one function.
FREE_SHIPPING_THRESHOLD = 100
FLAT_SHIPPING_FEE       = 9.99
MEMBER_DISCOUNT         = 0.10

def shipping_for(total: float) -> float:
    return 0.0 if total > FREE_SHIPPING_THRESHOLD else FLAT_SHIPPING_FEE

def price(items, *, member: bool) -> float:
    total = sum(i.price for i in items)
    discount = MEMBER_DISCOUNT if member else 0.0
    return round(total * (1 - discount) + shipping_for(total), 2)
```

**What improved & how to verify.** A change to the shipping threshold is now a one-line edit that cannot be forgotten in a copy; the member/guest difference is a single explicit parameter, not two parallel functions. **Verify**: route the original `price_for_member`/`price_for_guest` cases through `price(items, member=...)` in the characterization test and assert identical rounded totals. Keep the call-site update (callers now pass `member=`) in the *same* structural commit, and confirm the boundary case at `total == 100` returns the flat fee in both old and new code.

</details>

---

## Exercise 3 — Leave the coincidental duplication alone

**Anti-pattern:** Copy-Paste — the *false positive*. **Goal:** recognize duplication that you must **not** merge, and make that decision explicit. **Constraints:** the two rules must remain independently changeable; no shared abstraction.

```python
# Before — these LOOK identical. Should you DRY them?
def validate_username(s: str) -> bool:
    return 3 <= len(s) <= 20

def validate_coupon_code(s: str) -> bool:
    return 3 <= len(s) <= 20
```

<details>
<summary>Refactored</summary>

**Move sequence — the discipline of *not* refactoring**

1. **Characterize both** independently — a too-short, in-range, and too-long input for each. Two separate tests, deliberately not shared.
2. **Apply the divergence test** (Sandi Metz, *"the wrong abstraction"*): *if the username rule changes, must the coupon rule change too?* A username is a human identity constraint; a coupon code is a marketing/format constraint. They are unrelated rules that happen to share bounds *today*. The answer is **no** → the duplication is **coincidental**.
3. **Do not extract.** Merging into `validate_length(s, 3, 20)` couples two rules that will diverge (usernames may grow to 32; coupons may require exactly 8). The "fix" would force a flag parameter or a later painful split — the [over-DRY trap](middle.md).
4. **Make the *intent* explicit instead.** Replace the bare bounds with *named, per-domain* constants so the next reader sees two independent rules, not one duplicated one.

```python
# After — duplication kept on purpose; intent made explicit.
USERNAME_MIN, USERNAME_MAX = 3, 20   # human-identity rule
COUPON_MIN,   COUPON_MAX   = 3, 20   # marketing-format rule (independent of username)

def validate_username(s: str) -> bool:
    return USERNAME_MIN <= len(s) <= USERNAME_MAX

def validate_coupon_code(s: str) -> bool:
    return COUPON_MIN <= len(s) <= COUPON_MAX
```

**What improved & how to verify.** Nothing about *behavior* changed — and that is the point. The risky move (merging) was correctly *declined*; the literals are now named so the two rules read as distinct concepts that coincidentally share bounds. **Verify**: both characterization tests still pass. The real deliverable is the recorded decision — leave a comment or PR note: *"same bounds are coincidental, not a shared rule; do not DRY."* DRY is about not duplicating *knowledge*; identical *text* encoding *different* knowledge is correctly left alone.

> **Rule of thumb:** DRY couples the things it merges. Only merge things that must change *together*.

</details>

---

## Exercise 4 — Hard-coded values → configuration

**Anti-pattern:** Hard Coding. **Goal:** move environment-specific values out of source, treating secrets correctly. **Constraints:** the function signature stays usable; defaults must reproduce current behavior in dev; a committed secret must be rotated, not just moved.

```go
// Before — credentials in source, a laptop-only path, an env-specific URL.
func newClient() *Client {
	return &Client{
		dsn:       "postgres://admin:S3cr3t!@10.0.0.5:5432/prod", // secret in git history!
		uploadDir: "/Users/alex/dev/app/uploads",                // only on Alex's machine
		apiBase:   "https://api.prod.example.com",               // env-specific
		timeout:   5 * time.Second,                              // arguably fine to keep
	}
}
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize.** A test that, with the dev-equivalent environment set, builds a `Client` with the same effective field values — this pins behavior across the config move.
2. **Classify each value on the config spectrum** (see [middle.md](middle.md)): the DSN is a **secret** (manager / injected env, never committed); `uploadDir` and `apiBase` are **per-environment** (env vars with sane dev defaults); `timeout` is a **stable tuning constant** (a named code constant is fine).
3. **Introduce Configuration**: a `Config` struct loaded from the environment at startup, with explicit defaults for non-secret values. Read it once; pass it in (dependency injection) rather than reaching into `os.Getenv` deep in the code.
4. **Handle the secret deliberately.** The DSN comes from `DATABASE_URL`, injected at runtime by the secrets manager. **Because the old credential is in git history, rotate it** — removing it from source does *not* un-leak it.

```go
// After — configuration loaded at the edge; secret never in source.
type Config struct {
	DSN       string // from secrets manager / injected env — NEVER a default in code
	UploadDir string
	APIBase   string
	Timeout   time.Duration
}

const defaultTimeout = 5 * time.Second // stable; not env-specific

func LoadConfig() (Config, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return Config{}, errors.New("DATABASE_URL is required") // fail fast; no fallback secret
	}
	return Config{
		DSN:       dsn,
		UploadDir: getenvOr("UPLOAD_DIR", "./uploads"),                 // safe dev default
		APIBase:   getenvOr("API_BASE", "https://api.dev.example.com"), // safe dev default
		Timeout:   defaultTimeout,
	}, nil
}

func newClient(cfg Config) *Client {
	return &Client{dsn: cfg.DSN, uploadDir: cfg.UploadDir, apiBase: cfg.APIBase, timeout: cfg.Timeout}
}

func getenvOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
```

**What improved & how to verify.** The same binary now runs in dev, staging, and prod by changing the environment, not the code; the credential no longer ships in every clone. **Verify**: with `DATABASE_URL` plus dev defaults set, the characterization test produces a `Client` with the same effective values; with `DATABASE_URL` unset, `LoadConfig` fails fast (a deliberate, reviewed behavioral addition). **Critical follow-up, not optional:** rotate `S3cr3t!` in the database and add a secret scanner (`gitleaks`) to pre-commit — the leaked credential is valid until rotated, regardless of this refactor.

> **The trap (over-configuration):** `timeout` stayed a constant on purpose. Configure what genuinely varies per environment; making *every* value a knob is [Soft Coding](../03-over-engineering/middle.md).

</details>

---

## Exercise 5 — Clean up the cargo-culted snippet

**Anti-pattern:** Cargo Cult Programming. **Goal:** remove lines kept "because the example had them," keeping only what is justified. **Constraints:** the function's output and the file it reads must be unchanged; every surviving line must be defensible.

```python
# Before — pasted from a blog; nobody knows why half of this is here.
import os
import time
import pandas as pd

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"   # copied; this code never imports TensorFlow

def load_active_users(path):
    time.sleep(0.1)                          # "the tutorial had a sleep"
    df = pd.read_csv(path)
    df = df.copy()                           # "saw this somewhere, seemed safe"
    df = df[df["active"] == True]            # the only line that does real work
    df = df.reset_index().reset_index()      # reset twice "just in case"
    return df
```

<details>
<summary>Refactored</summary>

**Move sequence — justify or delete**

1. **Characterize.** A fixture CSV with active and inactive users; snapshot the returned DataFrame's *content* (values), not its incidental index, so the test pins behavior the caller actually depends on.
2. **Interrogate each suspect line** — the cargo-cult test is *"what breaks if I remove this?"* Remove one line, run the test:
   - `os.environ["TF_CPP_MIN_LOG_LEVEL"]` → no TensorFlow anywhere in the project (`grep -rn tensorflow`); silences a warning that is never emitted. **Delete.**
   - `time.sleep(0.1)` → an artifact of a streaming tutorial; pure latency here. **Delete.**
   - `df.copy()` → `read_csv` already returns a fresh frame; the copy guards against a mutation that does not happen. **Delete.**
   - `.reset_index().reset_index()` → produces two spurious index columns; the second is unjustifiable and the *first* is only needed if a caller relies on a clean integer index. Check callers; here none do. **Replace with a single `reset_index(drop=True)`** to keep a clean index without junk columns.
   - `df[df["active"] == True]` → the actual purpose. **Keep**, and idiomatically simplify to `df[df["active"]]`.
3. **Remove now-unused imports** (`time`, `os`) — they were only there for the deleted lines.

```python
# After — every line earns its place.
import pandas as pd

def load_active_users(path):
    df = pd.read_csv(path)
    return df[df["active"]].reset_index(drop=True)
```

**What improved & how to verify.** Unexplained ritual (a TF env var, a sleep, a redundant copy, a double index reset) is gone; what remains is the one rule the function exists to express. **Verify**: the content-snapshot test is unchanged. The `.reset_index().reset_index()` → `reset_index(drop=True)` step is the one with a *behavioral* edge (it removes the spurious index columns the double-reset created); if any caller read those columns, that surfaces in their tests — which is exactly why you check call sites before deleting. The discipline: *if you cannot explain why a line is there, you cannot safely keep it.*

</details>

---

## Exercise 6 — Catch the Pokémon exception

**Anti-pattern:** Pokémon Exception Handling. **Goal:** replace a catch-everything-and-swallow block with deliberate, typed handling that preserves the diagnostic trail. **Constraints:** *expected* failures stay handled with the same user-facing result; *bugs* must now propagate loudly instead of vanishing; the original cause must be preserved when wrapping.

```java
// Before — "gotta catch 'em all", then silence.
ChargeResult charge(Order order) {
    try {
        int amount = Integer.parseInt(order.amountText());  // may be malformed
        gateway.charge(order.card(), amount);               // may decline, may time out
        return ChargeResult.ok();
    } catch (Exception e) {
        return ChargeResult.failed("could not charge");     // hides decline, timeout, AND bugs
    }
}
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize the observable contract.** What does each *expected* failure currently return? A malformed amount, a declined card, and a gateway timeout all return `failed("could not charge")` today. Pin those three. Then add a *new* expectation that a programming bug (e.g. a `NullPointerException` inside `gateway`) **escapes** — that change is the entire purpose of this exercise.
2. **Classify the catchable exceptions.** Map each real failure to its type: `NumberFormatException` (bad input), `CardDeclinedException` (expected, recoverable), `GatewayTimeoutException` (transient). Everything else is a *bug* and must not be caught.
3. **Replace Bare Catch with Typed Handling**: one `catch` per type you can actually act on, ordered specific-first. Drop the `catch (Exception e)`.
4. **Preserve the cause when translating.** When you turn a low-level exception into a domain result or rethrow, chain the original (`new XException(msg, e)`), never discard it.

```java
// After — each catch handles a real, distinct failure; bugs propagate.
ChargeResult charge(Order order) {
    int amount;
    try {
        amount = Integer.parseInt(order.amountText());
    } catch (NumberFormatException e) {
        return ChargeResult.failed("invalid amount: " + order.amountText());
    }

    try {
        gateway.charge(order.card(), amount);
        return ChargeResult.ok();
    } catch (CardDeclinedException e) {
        return ChargeResult.failed("card declined: " + e.reason());     // expected, recoverable
    } catch (GatewayTimeoutException e) {
        log.warn("gateway timeout for order {}", order.id(), e);         // logged WITH the cause
        throw new ChargeRetryableException("charge timed out", e);       // wrap + preserve cause
    }
    // No catch(Exception): a NullPointerException from a bug now crashes loudly and is found.
}
```

**What improved & how to verify.** A decline and a timeout are now distinguishable (different result, different action), the operator gets a logged stack trace for timeouts, and a latent bug can no longer masquerade as "could not charge." **Verify**: the three expected-failure cases return the same (or strictly more specific) results; assert via a mock gateway. The deliberate behavioral delta — a thrown `RuntimeException` from a bug now escapes — must be called out in the PR; it is the *intended* improvement. This is the rare exercise where the structural and behavioral changes coincide, so commit it as a single, clearly-described behavioral change, not as a "pure refactor."

> **Subtle Pokémon:** wrapping as `throw new RuntimeException("failed")` *without* `, e` is still the anti-pattern — you handled it but deleted the evidence.

</details>

---

## Exercise 7 — Stringly-typed status → enum

**Anti-pattern:** Stringly-Typed Programming. **Goal:** replace a `String` status (a fixed value set) with an enum so the compiler rejects typos and lists valid values. **Constraints:** the persisted/wire representation (`"active"`, `"suspended"`, `"closed"`) stays byte-identical for backward compatibility; public method names unchanged.

```java
// Before — String for a fixed set; "actve" compiles, fails in prod.
class Account {
    private String status;  // "active" | "suspended" | "closed" — by convention only

    void setStatus(String status) { this.status = status; }
    boolean canTransact() { return status.equals("active"); }
    boolean isSuspended() { return status.equals("suspended"); }
}

// elsewhere:
account.setStatus("suspeded");  // typo compiles cleanly; canTransact() silently wrong
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize.** Test each status's effect on `canTransact()`/`isSuspended()`, *and* the serialization round-trip (the string that gets persisted), since the wire format is a contract.
2. **Replace Type Code with Enum** (Fowler). Define `enum Status` with an explicit `wireValue` so the persisted strings stay identical — never rely on `Status.ACTIVE.name()` (`"ACTIVE"` ≠ `"active"`).
3. **Map at the boundaries only.** Convert string → enum on read (from DB/JSON) and enum → string on write; *inside* the domain, pass the enum, never the string. This is the half-fix to avoid: don't enum-ify and then immediately `status.toString().equals("active")` again.
4. Update the field and methods; the typo at the call site now fails to compile.

```java
// After — enum with stable wire values; illegal states unrepresentable.
enum Status {
    ACTIVE("active"), SUSPENDED("suspended"), CLOSED("closed");

    private final String wire;
    Status(String wire) { this.wire = wire; }
    String wireValue() { return wire; }

    static Status fromWire(String s) {
        for (Status v : values()) if (v.wire.equals(s)) return v;
        throw new IllegalArgumentException("unknown status: " + s);
    }
}

class Account {
    private Status status;

    void setStatus(Status status) { this.status = status; }   // setStatus("suspeded") no longer compiles
    boolean canTransact() { return status == Status.ACTIVE; }
    boolean isSuspended() { return status == Status.SUSPENDED; }
}

// boundary mapping (persistence/JSON):
account.setStatus(Status.fromWire(row.get("status")));   // read
row.put("status", account.status().wireValue());          // write
```

**What improved & how to verify.** Typos are now compile errors, the IDE autocompletes the three valid statuses, and `account.setStatus("banana")` is impossible to express. **Verify**: behavior tests unchanged; the serialization round-trip still produces `"active"`/`"suspended"`/`"closed"` exactly (the backward-compat constraint). The one *new* behavior — `fromWire` throwing on an unknown string — is a deliberate tightening; confirm no legitimate stored value falls outside the three, ideally by querying production for `DISTINCT status` before shipping.

> **Don't round-trip back to strings.** Compare `status == Status.ACTIVE`, not `status.wireValue().equals("active")` — that just reintroduces the smell.

</details>

---

## Exercise 8 — Distinct value types for confusable strings

**Anti-pattern:** Stringly-Typed Programming (confusable parameters). **Goal:** stop two `string` parameters that mean different things from being silently swapped, using distinct value types. **Constraints:** runtime representation stays a string; the bug class (transposed arguments) becomes a compile error.

```go
// Before — both are strings; transposing them compiles and corrupts data.
func SendWelcome(userID string, email string) error {
	// ... uses userID for the audit log, email for delivery ...
	audit.Record(userID)
	return mailer.Send(email, "Welcome!")
}

// call site — arguments swapped; compiler says nothing:
SendWelcome("a@b.com", "u_42")   // emails "u_42", audits "a@b.com"
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize.** A test asserting the *correct* call records the right user and mails the right address (using mocks/spies for `audit` and `mailer`).
2. **Introduce Value Type** for each concept. In Go, distinct named types over `string` are zero-cost and make the type checker reject mismatches:

   ```go
   type UserID string
   type Email  string
   ```
3. **Tighten the constructors** if there are invariants worth enforcing (e.g. `NewEmail` validates the `@`), so an invalid `Email` cannot exist. Keep this optional and minimal — the primary win is the distinctness.
4. **Change the signature** to take the value types; update call sites. The transposed call now fails to compile.

```go
// After — distinct types; swapping is a compile error.
type UserID string
type Email  string

func NewEmail(s string) (Email, error) {
	if !strings.Contains(s, "@") {
		return "", fmt.Errorf("invalid email: %q", s)
	}
	return Email(s), nil
}

func SendWelcome(id UserID, to Email) error {
	audit.Record(string(id))
	return mailer.Send(string(to), "Welcome!")
}

// call site — transposition no longer compiles:
SendWelcome(UserID("u_42"), Email("a@b.com"))
// SendWelcome(Email("a@b.com"), UserID("u_42")) // ← compile error: types don't match
```

**What improved & how to verify.** A whole class of bug (passing an email where a user ID is expected, and vice-versa) is now caught by the compiler, at zero runtime cost. **Verify**: the happy-path test is unchanged; additionally, intentionally write the swapped call in a throwaway test file and confirm it *fails to compile* — that compile failure is the proof the refactor works. Note `NewEmail`'s validation is a small behavioral addition; introduce it in a separate commit if any existing data might not contain `@`.

> **The trap (over-typing):** don't wrap *every* string. Reach for value types when a value crosses boundaries, carries an invariant, or is easily confused with a sibling — not for a one-off local.

</details>

---

## Exercise 9 — Magic strings → enum dispatch

**Anti-pattern:** Magic Strings + Stringly-Typed (string-based dispatch). **Goal:** replace an `if/elif` ladder over magic string literals with enum-keyed dispatch (or polymorphism). **Constraints:** identical computed results; an unknown type still raises the same error; behavior open for extension without editing the dispatcher.

```python
# Before — magic strings drive a branching ladder; a typo is a runtime surprise.
def area(shape: str, **dims) -> float:
    if shape == "circle":
        return 3.14159 * dims["r"] ** 2
    elif shape == "square":
        return dims["side"] ** 2
    elif shape == "rect":
        return dims["w"] * dims["h"]
    else:
        raise ValueError(f"unknown shape: {shape}")

area("circel", r=2)   # typo → ValueError at runtime, far from the call
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize.** Test each shape's area, the magic constant `3.14159`, and the unknown-shape error. Snapshot the floats and the exception.
2. **Replace Magic Literal with Symbolic Constant** for `3.14159` → use `math.pi` (the magic number was also slightly *wrong*; if the old imprecise value is a hard contract, keep it as a named constant and note the discrepancy in the test).
3. **Replace String Dispatch with an Enum** (`ShapeKind`) so the set of valid shapes is closed and discoverable.
4. **Replace Conditional with a Lookup Table** keyed by the enum — adding a shape becomes adding one entry, not editing the dispatcher.

```python
# After — enum-keyed table; the dispatcher never changes again.
import math
from enum import Enum

class ShapeKind(Enum):
    CIRCLE = "circle"
    SQUARE = "square"
    RECT   = "rect"

_AREA = {
    ShapeKind.CIRCLE: lambda d: math.pi * d["r"] ** 2,
    ShapeKind.SQUARE: lambda d: d["side"] ** 2,
    ShapeKind.RECT:   lambda d: d["w"] * d["h"],
}

def area(shape: ShapeKind, **dims) -> float:
    return _AREA[shape](dims)

# boundary parse from an external string keeps the old error shape:
def area_from_name(name: str, **dims) -> float:
    try:
        kind = ShapeKind(name)
    except ValueError:
        raise ValueError(f"unknown shape: {name}")
    return area(kind, **dims)
```

**What improved & how to verify.** Internal callers pass a `ShapeKind` the IDE autocompletes (a typo is now caught at the call); the dispatcher's complexity is constant regardless of shape count; the slightly-wrong `3.14159` is replaced by `math.pi`. **Verify**: `area_from_name("circel", r=2)` still raises `ValueError("unknown shape: circel")` (boundary error preserved), and squares/rectangles match exactly. The circle area changes in the last digits (`math.pi` vs `3.14159`) — flag that as an intentional precision fix in a *separate* commit, or keep `PI = 3.14159` as a named constant if exact reproduction is required.

</details>

---

## Exercise 10 — Copy-paste with a duplicated magic value

**Anti-pattern:** Copy-Paste + Magic Number (the two cluster). **Goal:** extract duplicated logic *and* the magic value it carries, so a rate change is a single edit. **Constraints:** same totals; the tax rate must live in exactly one place.

```java
// Before — the tax rate 0.08 is copy-pasted into three methods.
class Invoice {
    double subtotalWithTax(List<Item> items) {
        double sub = 0;
        for (Item i : items) sub += i.price() * i.qty();
        return sub + sub * 0.08;                 // copy 1
    }
    double estimateTax(double amount) {
        return amount * 0.08;                    // copy 2
    }
    double grandTotal(double subtotal, double shipping) {
        return subtotal + shipping + subtotal * 0.08;  // copy 3
    }
}
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize.** Test all three methods with representative inputs; snapshot the doubles. Include a case where the rate matters (non-zero amount).
2. **Replace Magic Literal with Symbolic Constant**: introduce `SALES_TAX_RATE = 0.08` *once*. Replace all three `0.08` occurrences. Tests green — this alone removes the duplicated *value*.
3. **Extract Function** `tax(double base)` so the *computation* (not just the constant) has one home; the three methods now call it. This removes the duplicated *knowledge*.
4. Confirm the three call sites read identically to before, modulo the extracted call.

```java
// After — one rate, one tax computation, three callers.
class Invoice {
    private static final double SALES_TAX_RATE = 0.08;

    private static double tax(double base) {
        return base * SALES_TAX_RATE;
    }

    double subtotalWithTax(List<Item> items) {
        double sub = 0;
        for (Item i : items) sub += i.price() * i.qty();
        return sub + tax(sub);
    }
    double estimateTax(double amount) {
        return tax(amount);
    }
    double grandTotal(double subtotal, double shipping) {
        return subtotal + shipping + tax(subtotal);
    }
}
```

**What improved & how to verify.** A tax-rate change is now a one-line edit that cannot be missed in one of three copies; the rate has a name and the tax computation a single home. **Verify**: the snapshot test for all three methods is byte-identical (the arithmetic is the same `base * 0.08`, just relocated). This is a pure structural commit — resist the urge to also "fix" the `double` money representation here; that is a separate behavioral change with its own test and review.

> **Two smells, one root.** The duplicated `0.08` is both Copy-Paste and a Magic Number; naming the constant cures the magic, extracting the function cures the duplication.

</details>

---

## Exercise 11 — A deliberate typed-error strategy

**Anti-pattern:** Pokémon Exceptions + stringly-typed error signaling. **Goal:** turn a swallow-everything handler that signals failure via magic strings into a classified, typed error strategy that preserves causes and distinguishes recoverable failures from bugs. **Constraints:** the caller's *observable* outcomes for expected failures stay the same; bugs propagate; causes are chained.

```python
# Before — bare except, then a stringly-typed "error code" return.
def process(body: str):
    try:
        data = json.loads(body)
        user = db.get(data["id"])
        charge(user, data["amount"])
        return "OK"
    except Exception:
        return "ERR"        # which error? bad JSON? missing user? a bug? nobody can tell
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize the observable outcomes.** Today: malformed JSON → `"ERR"`; missing `id` key → `"ERR"`; unknown user → `"ERR"`; declined charge → `"ERR"`; *and a bug also → `"ERR"`*. Pin the *expected* failures; the bug-swallowing is what we are removing.
2. **Classify failures.** Bad JSON and a declined charge are *expected and recoverable*; a missing user is a *real domain condition* (handle explicitly); a `KeyError`/`TypeError` from malformed-but-valid-JSON or a bug must *propagate*.
3. **Replace Bare Catch with Typed Handling**, catching one specific type per recoverable case, near where you can act.
4. **Replace the stringly-typed return** with a small result type (or distinct exceptions) so callers branch on a type, not a magic `"ERR"`/`"OK"` string. **Chain the cause** when translating.

```python
# After — classified, typed, cause-preserving.
from dataclasses import dataclass

@dataclass
class Ok: ...
@dataclass
class Rejected:           # expected, recoverable — carries a reason
    reason: str

def process(body: str) -> Ok | Rejected:
    try:
        data = json.loads(body)
    except json.JSONDecodeError as e:
        raise InvalidRequest("malformed JSON") from e   # expected; cause preserved

    if "id" not in data or "amount" not in data:
        return Rejected("missing id or amount")          # domain condition, handled explicitly

    user = db.get(data["id"])
    if user is None:
        return Rejected("unknown user")                  # domain condition

    try:
        charge(user, data["amount"])
    except PaymentDeclined as e:
        return Rejected(f"declined: {e.reason}")         # expected, recoverable
    # any other exception (a bug) propagates to the boundary and is logged with a trace
    return Ok()
```

**What improved & how to verify.** The caller can now distinguish *why* something failed and act on it, the operator gets a real stack trace for bugs instead of a silent `"ERR"`, and the original `JSONDecodeError` is chained into `InvalidRequest`. **Verify**: each expected-failure case maps to the same effective outcome (a `Rejected`/raised `InvalidRequest` the caller treats as the old `"ERR"`); assert a bug (e.g. `charge` raising `RuntimeError`) now escapes rather than returning `"ERR"`. This is a behavioral change by design — commit it with a clear message and update callers to branch on the result type instead of comparing to `"ERR"`.

> **The trap (over-catching):** don't wrap *each* line in its own `try`. Catch the specific recoverable types where you can act; let everything else reach the one boundary that logs and responds.

</details>

---

## Exercise 12 — Hard-coded business rules → config + value type

**Anti-pattern:** Hard Coding + Magic Numbers + Stringly-Typed (combined). **Goal:** lift environment-varying business rules out of source, name the magic, and replace a stringly-typed tier with a value type. **Constraints:** dev defaults reproduce current behavior; backward-compatible config keys; the tier set is closed.

```go
// Before — magic thresholds, a stringly-typed tier, and an env-specific limit baked in.
func DiscountFor(tier string, cartTotal float64) float64 {
	if tier == "gold" {
		if cartTotal > 500 {        // 500 = ?? and differs by region/promo
			return cartTotal * 0.15 // 0.15 = ??
		}
		return cartTotal * 0.10
	} else if tier == "silver" {
		return cartTotal * 0.05
	}
	return 0 // "bronze" or anything unrecognized
}
```

<details>
<summary>Refactored</summary>

**Move sequence**

1. **Characterize.** Test each tier at/above/below the `500` boundary; snapshot the discounts. Include an unrecognized tier (currently → `0`).
2. **Replace Magic Literal with Symbolic Constant** for the rates and threshold, *in place* first (pure rename, tests green).
3. **Classify the values.** The discount rates are stable product rules → constants. The `500` bulk threshold "differs by region/promo" → it is **configuration**, not a constant. Introduce a `DiscountConfig` with a default of `500` (backward-compatible) overridable per environment.
4. **Replace Type Code with a value type** for `tier` (`Tier` enum-like constants) so an unrecognized string can't silently fall through; map the external string at the boundary, preserving the old default-to-zero for unknowns if that is the contract.

```go
// After — named rules, configurable threshold, closed tier set.
type Tier int

const (
	Bronze Tier = iota
	Silver
	Gold
)

func TierFromString(s string) (Tier, bool) {
	switch s {
	case "gold":
		return Gold, true
	case "silver":
		return Silver, true
	case "bronze":
		return Bronze, true
	}
	return Bronze, false // unknown → Bronze (0% discount), preserving old behavior
}

const (
	goldHighRate = 0.15
	goldBaseRate = 0.10
	silverRate   = 0.05
)

type DiscountConfig struct {
	BulkThreshold float64 // per-environment; default 500
}

func LoadDiscountConfig() DiscountConfig {
	return DiscountConfig{BulkThreshold: getenvFloat("BULK_THRESHOLD", 500)}
}

func DiscountFor(tier Tier, cartTotal float64, cfg DiscountConfig) float64 {
	switch tier {
	case Gold:
		if cartTotal > cfg.BulkThreshold {
			return cartTotal * goldHighRate
		}
		return cartTotal * goldBaseRate
	case Silver:
		return cartTotal * silverRate
	default:
		return 0
	}
}
```

**What improved & how to verify.** The bulk threshold can now vary per environment/promo without a redeploy; the rates have names; an unrecognized tier string is mapped explicitly (with `ok`) rather than silently mistreated. **Verify**: with `BULK_THRESHOLD` unset (default `500`), the characterization test for every tier and boundary is identical to before, including unknown-tier → `0`. The config key `BULK_THRESHOLD` is the new public surface — document it. Keep the constant-naming as one structural commit and the config introduction as a second, since the latter adds a new input.

> **Balance, not extremes.** The *rates* stayed hard-coded constants (they are product rules, not env-varying); only the genuinely-varying threshold became config. Over-configuring the rates would be [Soft Coding](../03-over-engineering/middle.md).

</details>

---

## Exercise 13 — The full shortcut cleanup

**Anti-pattern:** all six at once. **Goal:** refactor one function exhibiting copy-paste, magic literals, a hard-coded URL, a cargo-culted line, a Pokémon catch, and a stringly-typed mode. **Constraints:** preserve the observable result for expected inputs; tackle the shortcuts in a safe order; secrets/URLs out of source.

```python
# Before — a bit of every shortcut.
import os, time, requests

def fetch_report(mode, account_id):
    time.sleep(0.2)                                    # cargo cult: copied from a retry tutorial
    try:
        if mode == "json":                             # stringly-typed mode + magic strings
            url = "https://api.prod.example.com/v1/report"   # hard-coded, env-specific
            r = requests.get(url, params={"id": account_id}, timeout=30)  # magic 30
            data = r.json()
            return {"id": data["id"], "score": data["score"] * 1.1}       # magic 1.1
        elif mode == "csv":
            url = "https://api.prod.example.com/v1/report"   # SAME url copy-pasted
            r = requests.get(url, params={"id": account_id, "fmt": "csv"}, timeout=30)
            return r.text
        else:
            return None
    except Exception:                                  # Pokémon: swallows everything
        return None
```

<details>
<summary>Refactored</summary>

**Move sequence — order matters: isolated, low-risk moves first; behavioral changes last and separately**

1. **Characterize.** Mock `requests.get`. Pin: `json` mode returns `{"id", "score"*1.1}`; `csv` mode returns the body text; unknown mode → `None`. Note the current swallow-all → `None` on *any* error; that is the behavior we will deliberately narrow.
2. **Remove the cargo-culted `time.sleep(0.2)`.** It is leftover from a retry example; nothing here retries. `grep` confirms no dependency. Delete (own structural commit). Remove the now-unused `time`/`os` imports.
3. **Replace Magic Literals with Symbolic Constants** — `REQUEST_TIMEOUT = 30`, `SCORE_MULTIPLIER = 1.1`. Pure rename.
4. **Extract Function** for the duplicated request (`_get_report`), curing the copy-pasted URL/call.
5. **Introduce Configuration** for the base URL (`API_BASE` env var, dev default), curing the hard-coding; the URL is now built from config in one place.
6. **Replace Type Code with an Enum** for `mode` (`ReportFormat`), curing the stringly-typed dispatch; map the external string at the boundary, preserving unknown → `None` if that is the contract.
7. **Replace Bare Catch with Typed Handling** *last* and in its own behavioral commit — catch `requests.Timeout`/`requests.HTTPError` where recoverable, chain the cause, and let bugs propagate.

```python
# After — every shortcut addressed; behavior preserved for expected inputs.
import os
from enum import Enum
import requests

REQUEST_TIMEOUT  = 30          # seconds
SCORE_MULTIPLIER = 1.1

class ReportFormat(Enum):
    JSON = "json"
    CSV  = "csv"

def _api_base() -> str:
    return os.getenv("API_BASE", "https://api.dev.example.com")  # configurable; safe dev default

def _get_report(account_id, *, params=None):
    url = f"{_api_base()}/v1/report"
    return requests.get(url, params={"id": account_id, **(params or {})}, timeout=REQUEST_TIMEOUT)

def fetch_report(fmt: ReportFormat, account_id):
    try:
        if fmt is ReportFormat.JSON:
            data = _get_report(account_id).json()
            return {"id": data["id"], "score": data["score"] * SCORE_MULTIPLIER}
        # fmt is ReportFormat.CSV (enum makes this exhaustive):
        return _get_report(account_id, params={"fmt": "csv"}).text
    except requests.Timeout as e:
        raise ReportUnavailable("report request timed out") from e   # recoverable; cause kept
    except requests.HTTPError as e:
        raise ReportUnavailable("upstream error") from e             # cause kept
    # a KeyError (missing "score") or any bug now propagates and gets fixed

def fetch_report_by_name(mode: str, account_id):
    try:
        fmt = ReportFormat(mode)
    except ValueError:
        return None                                                  # unknown mode → None (preserved)
    return fetch_report(fmt, account_id)
```

**What improved & how to verify.** The URL has one home and comes from config (no env-specific string, no copy-paste); the magic `30`/`1.1` are named; the cargo-cult sleep is gone; the mode is a discoverable enum; and failures are classified — recoverable network errors translate with their cause, while a bug like a missing `"score"` key now surfaces instead of vanishing into `None`. **Verify**: the `json`/`csv`/unknown-mode characterization cases pass through `fetch_report_by_name` unchanged; assert that a `Timeout` now raises `ReportUnavailable` (with `__cause__` set) rather than returning `None` — the *intended* behavioral delta. **Commit discipline**: steps 2–6 are structural (one commit each, tests green); step 7 is the single behavioral commit, clearly described, with callers updated to handle `ReportUnavailable`. Never bundle them — if a test regresses, small commits make `git bisect` trivial.

</details>

---

## Refactoring discipline — the recap

Every exercise above runs the same loop. Internalize it and the specific moves become mechanical:

```text
green  →  one named refactoring  →  green  →  commit  →  repeat
          (behavioral change — error strategy, config, precision fix — gets its OWN commit)
```

- **Characterize before you change.** A test that pins current behavior (bugs and all) is the seatbelt. For the Pokémon-exception exercises the *point* is to change behavior — there you pin the observable expected-failure outcomes first, then deliberately widen what escapes, and label the commit behavioral.
- **Small, reversible steps.** Name the constant, run tests, commit. Extract the function, run tests, commit. If green turns red, your *last* step is the suspect — revert it.
- **Separate structural from behavioral commits.** Naming a magic value or extracting a duplicate is structural and must preserve output byte-for-byte (watch algebraic rewrites like `base*1.08` → `base*(1+0.08)` and `3.14159` → `math.pi`). Changing an error strategy, adding validation, or introducing config is behavioral — its own reviewed commit.
- **Name the move.** "Replace Magic Literal with Symbolic Constant," "Extract Function," "Introduce Configuration," "Replace Type Code with Enum," "Introduce Value Type," "Replace String Dispatch with Enum/Polymorphism," "Replace Bare Catch with Typed Handling." A named move is a known-safe, often IDE-automatable transformation — not an improvisation.
- **Restraint is a refactoring too.** Exercise 3's correct answer was *not to merge*. DRY couples what it touches; only merge knowledge that must change together.
- **Secrets are special and irreversible.** Moving a credential out of source does not un-leak it — *rotate* it and add a secret scanner. This is the one shortcut whose cost is catastrophic.

| Move | Cures | Exercises |
|---|---|---|
| Replace Magic Literal with Symbolic Constant | Magic Numbers / Strings | 1, 9, 10, 12, 13 |
| Extract Function / DRY | Copy-Paste | 2, 10, 13 |
| *Restraint* — recognize coincidental duplication | Copy-Paste (false positive) | 3 |
| Introduce Configuration (+ secret rotation) | Hard Coding | 4, 12, 13 |
| Justify-or-delete; read the docs | Cargo Cult | 5, 13 |
| Replace Bare Catch with Typed Handling (+ chain cause) | Pokémon Exceptions | 6, 11, 13 |
| Replace Type Code with Enum | Stringly-Typed | 7, 9, 12, 13 |
| Introduce Value Type | Stringly-Typed (confusable values) | 8 |
| Replace String Dispatch with Enum/Polymorphism | Magic Strings + Stringly-Typed | 9, 13 |

---

## Related Topics

- [`tasks.md`](tasks.md) — guided exercises building these moves from scratch.
- [`find-bug.md`](find-bug.md) — the *spotting* counterpart: identify the shortcut, don't fix it.
- [`junior.md`](junior.md) · [`middle.md`](middle.md) · [`senior.md`](senior.md) — recognize → countermove → refactor-at-scale.
- [Refactoring → Refactoring Techniques](../../../refactoring/02-refactoring-techniques/README.md) — the mechanical catalog for every move named above.
- [Refactoring → Code Smells](../../../refactoring/01-code-smells/README.md) — Duplicate Code, Magic Number, Primitive Obsession at the smell level.
- [Clean Code → Error Handling](../../../clean-code/06-error-handling/README.md) — the target state for the Pokémon-exception exercises.
- [Clean Code → Meaningful Names](../../../clean-code/01-meaningful-names/README.md) — naming away magic values.
- [DRY Principle](../../../clean-code/README.md) — and its limit, the coincidental-duplication trap (Exercise 3).
- [Secrets Management](../../../../../Architecture/system-design/README.md) — handling and rotating credentials (Exercise 4).
- [Over-Engineering](../03-over-engineering/middle.md) — Soft Coding, the over-correction to avoid when introducing configuration.
- [Bad Structure](../01-bad-structure/optimize.md) — the sibling refactoring file; same discipline, different anti-patterns.
