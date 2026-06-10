# Premature Abstraction at Scale — Practice Tasks

> **Category:** [Anti-Patterns at Scale](../README.md) → **Premature Abstraction at Scale**
> **Covers (collectively):** Speculative Generality · Wrapper-itis & needless indirection · Premature decoupling & one-implementation interfaces · The Wrong Abstraction · AHA / Rule of Three / YAGNI as the cure

These are **judgment-and-removal** exercises. The dominant move is to *subtract* — inline a one-implementation interface back to concrete, collapse a wrong abstraction's flag parameters, and decide which duplications are the same concept (extract) versus coincidental (leave). One exercise deliberately gives you a *justified* abstraction whose correct answer is **keep it** — reflexive deletion is its own anti-pattern, and the skill here is telling the cases apart.

Each exercise has a problem statement, starting code (Go, Java, Python, or TypeScript — the language varies on purpose), acceptance criteria, and a collapsible solution with the reasoning. Try it in your editor *before* expanding. Where a change is mechanical and repeated across many files, the solution notes how you'd do it at scale (see [Automated Large-Scale Refactoring](../04-automated-large-scale-refactoring/junior.md)).

> **Through-line:** abstraction is not free and duplication is not evil. The win condition is *easier to change*, not *fewer characters*. Re-read [`senior.md`](senior.md) for the cost model and the unwinding playbook.

---

## Table of Contents

| # | Exercise | Anti-pattern(s) | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Inline the one-implementation interface](#exercise-1--inline-the-one-implementation-interface) | One-impl interface | Go | ★ easy |
| 2 | [Rule of Three: extract or wait?](#exercise-2--rule-of-three-extract-or-wait) | Premature extraction (judgment) | Python | ★ easy |
| 3 | [Four duplications — which are the same concept?](#exercise-3--four-duplications--which-are-the-same-concept) | DRY vs coincidental | TS | ★★ medium |
| 4 | [Inline the wrong abstraction](#exercise-4--inline-the-wrong-abstraction) | The Wrong Abstraction | Java | ★★ medium |
| 5 | [Collapse the wrapper chain](#exercise-5--collapse-the-wrapper-chain) | Wrapper-itis | Go | ★★ medium |
| 6 | [Keep it or kill it? (the trap)](#exercise-6--keep-it-or-kill-it-the-trap) | Justified abstraction (judgment) | Go | ★★ medium |
| 7 | [Strip the speculative plugin system](#exercise-7--strip-the-speculative-plugin-system) | Speculative Generality | Python | ★★★ hard |
| 8 | [Unwind a wrong abstraction across call sites](#exercise-8--unwind-a-wrong-abstraction-across-call-sites) | Wrong Abstraction at scale | Java | ★★★ hard |

---

## Exercise 1 — Inline the one-implementation interface

**Anti-pattern:** One-implementation interface · **Language:** Go · **Difficulty:** ★ easy

A teammate "decoupled" a slug generator behind an interface "in case we need a different slugging strategy." There is one implementation, no second on the roadmap, and the impl is pure (no I/O). Restore the concrete form.

```go
package slug

type Slugger interface {
    Slug(s string) string
}

type DefaultSlugger struct{}

func (DefaultSlugger) Slug(s string) string {
    s = strings.ToLower(strings.TrimSpace(s))
    return strings.ReplaceAll(s, " ", "-")
}

// Wired everywhere:
//   var sl slug.Slugger = slug.DefaultSlugger{}
//   path := sl.Slug(title)
```

**Acceptance criteria**

- No interface; one exported function.
- Call sites become `slug.Make(title)` (or similar) with no instance to construct.
- Behavior identical.

<details><summary>Solution</summary>

```go
package slug

func Make(s string) string {
    s = strings.ToLower(strings.TrimSpace(s))
    return strings.ReplaceAll(s, " ", "-")
}

// Call sites:
//   path := slug.Make(title)
```

**Why.** The interface promised substitutability that doesn't exist — one implementor, pure logic, nothing to mock (no I/O boundary). It cost a second hop on every jump-to-definition and an instance to thread around, for zero benefit. Go's idiom is to define interfaces *at the consumer* when polymorphism is actually needed, not export them next to their sole implementation.

**At scale.** Replacing `sl.Slug(x)` → `slug.Make(x)` across the codebase is a one-line `gofmt -r 'sl.Slug(a) -> slug.Make(a)'`-style rewrite or a Comby pattern, applied in a single mechanical PR after the construction sites are removed. If a *real* second strategy ever lands, reintroduce the interface then — at three real cases it's a cheap, evidence-backed refactor.
</details>

---

## Exercise 2 — Rule of Three: extract or wait?

**Anti-pattern:** Premature extraction (judgment) · **Language:** Python · **Difficulty:** ★ easy

You're reviewing a PR. The author found two functions that both compute a "display total" and wants to extract a shared `compute_total`. Apply the Rule of Three and the same-knowledge test to decide.

```python
# In cart.py
def cart_display_total(items):
    subtotal = sum(i.price * i.qty for i in items)
    return round(subtotal * 1.08, 2)   # 8% sales tax

# In invoice.py
def invoice_display_total(lines):
    subtotal = sum(l.amount for l in lines)
    return round(subtotal * 1.08, 2)   # 8% sales tax
```

**Acceptance criteria**

- Decide: extract now, or wait? Justify with the same-knowledge test, not the syntax.
- If you extract, say *what* is shared and what isn't.

<details><summary>Solution</summary>

**Extract — but only the tax, and only because it's the same knowledge.** This is a case where waiting for a third instance would be *wrong*, because the duplicated `* 1.08` is a single piece of business knowledge (the sales-tax rate) that must stay consistent — if the rate changes by law and you fix one copy, you ship the wrong number from the other. That's a correctness bug, not a maintenance annoyance.

But notice what is **not** shared: the subtotal computation differs (`price*qty` over items vs `amount` over lines) and is genuinely different knowledge — leave it duplicated.

```python
# tax.py — the single authoritative representation of the tax rule
SALES_TAX_RATE = 0.08

def apply_sales_tax(subtotal):
    return round(subtotal * (1 + SALES_TAX_RATE), 2)

# cart.py
def cart_display_total(items):
    return apply_sales_tax(sum(i.price * i.qty for i in items))

# invoice.py
def invoice_display_total(lines):
    return apply_sales_tax(sum(l.amount for l in lines))
```

**The lesson.** The Rule of Three is a heuristic about *uncertainty*; override it when the duplication is the same knowledge and divergence is a defect. Don't over-extract: merging the two functions wholesale (`compute_total(items_or_lines, accessor)`) would couple two different subtotal concepts and start a wrong abstraction. Extract the *concept that's truly shared* (the tax), leave the rest.
</details>

---

## Exercise 3 — Four duplications — which are the same concept?

**Anti-pattern:** DRY vs coincidental duplication · **Language:** TypeScript · **Difficulty:** ★★ medium

Below are four pairs of near-identical code. For each, decide **extract** (same knowledge) or **leave** (coincidental), using one test: *if the requirement behind one changed, would the other have to change too?*

```typescript
// PAIR A — two validators
function isValidEmail(s: string) { return /^[^@]+@[^@]+\.[^@]+$/.test(s); }
function isValidContactEmail(s: string) { return /^[^@]+@[^@]+\.[^@]+$/.test(s); }

// PAIR B — two "is this a weekend" checks
function reportIsWeekend(d: Date) { const x = d.getDay(); return x === 0 || x === 6; }
function billingIsWeekend(d: Date) { const x = d.getDay(); return x === 0 || x === 6; }

// PAIR C — two DTO shapes that currently match
interface CreateUserRequest { name: string; email: string; age: number; }
interface UserRow         { name: string; email: string; age: number; }

// PAIR D — two retry loops
async function fetchWithRetry(fn: () => Promise<Resp>) {
  for (let i = 0; i < 3; i++) { try { return await fn(); } catch { await sleep(2 ** i * 100); } }
  throw new Error("exhausted");
}
async function publishWithRetry(fn: () => Promise<void>) {
  for (let i = 0; i < 3; i++) { try { return await fn(); } catch { await sleep(2 ** i * 100); } }
  throw new Error("exhausted");
}
```

**Acceptance criteria**

- A verdict (extract / leave) for each pair, with the one-sentence justification.

<details><summary>Solution</summary>

| Pair | Verdict | Why |
|------|---------|-----|
| **A — email regex** | **Extract** | Same knowledge: "what is a valid email" is one rule. If the regex is wrong (it is — but that's a separate fix), both must change together; you never want one validator to accept what the other rejects. Extract `isValidEmail` and have the contact path call it. |
| **B — isWeekend** | **Extract** | Same knowledge: the definition of "weekend" is a single domain fact. If the business adds Friday to "weekend," both reporting and billing must agree. Extract `isWeekend(d)`. |
| **C — DTO shapes** | **Leave** | *Coincidental.* `CreateUserRequest` is a wire/API concept; `UserRow` is a persistence concept. They match *today* by accident. The day the API adds `acceptedTos: boolean` (request-only) or the table adds `createdAt` (row-only), they must diverge — and a shared interface would fight that. Keep them separate; let them drift independently. |
| **D — retry loops** | **Extract** | Same knowledge: the retry *policy* (3 attempts, exponential backoff base 100ms) is a single operational decision. If ops says "5 attempts, jitter," you want one place to change. Extract `withRetry(fn, opts?)` generic over the return type. |

**The trap is C.** Syntactically it's the *most* identical pair, which is exactly why naive DRY merges it — and exactly why that merge is the wrong abstraction. Identical letters, different concepts. The discriminator is always *causality of change*, never textual similarity. Three of four extract; the most-similar-looking one is the one to leave alone.
</details>

---

## Exercise 4 — Inline the wrong abstraction

**Anti-pattern:** The Wrong Abstraction · **Language:** Java · **Difficulty:** ★★ medium

A `formatName` method was extracted from two call sites long ago. Since then it has grown flags as each caller needed "almost the same" output. No caller uses more than one path. Inline it back to honest, concrete methods.

```java
public String formatName(Person p, boolean lastFirst, boolean withTitle, boolean initialsOnly) {
    String first = p.getFirst();
    String last = p.getLast();
    if (initialsOnly) {
        return ("" + first.charAt(0) + last.charAt(0)).toUpperCase();
    }
    String name = lastFirst ? last + ", " + first : first + " " + last;
    if (withTitle && p.getTitle() != null) {
        name = p.getTitle() + " " + name;
    }
    return name;
}

// The only three call sites in the codebase:
//   greeting   = formatName(p, false, true,  false);   // "Dr. Ada Lovelace"
//   sortKey    = formatName(p, true,  false, false);   // "Lovelace, Ada"
//   avatarText = formatName(p, false, false, true);    // "AL"
```

**Acceptance criteria**

- Three concrete methods, each with no boolean parameters.
- Each method contains only the logic its caller actually exercises.
- The flags disappear entirely.

<details><summary>Solution</summary>

Apply Metz's move: inline into each caller, specialize to its constant flags, delete the dead branches.

```java
public String greetingName(Person p) {           // was formatName(p,false,true,false)
    String name = p.getFirst() + " " + p.getLast();
    return p.getTitle() != null ? p.getTitle() + " " + name : name;
}

public String sortKey(Person p) {                // was formatName(p,true,false,false)
    return p.getLast() + ", " + p.getFirst();
}

public String avatarInitials(Person p) {         // was formatName(p,false,false,true)
    return ("" + p.getFirst().charAt(0) + p.getLast().charAt(0)).toUpperCase();
}
```

**Why this is better.** Each method now reads top-to-bottom with no branching for cases it doesn't have. The three were never one concept — a greeting, a sort key, and avatar initials are three different jobs that happened to start from first/last name. The shared `formatName` had become a four-way fork where every caller paid to read paths it never took, and the next "almost fits" requirement would have added a fifth flag.

**The remaining duplication is fine.** `p.getFirst()`/`p.getLast()` appears in all three — that's coincidental field access, not shared knowledge; leave it. Don't immediately re-extract a `fullName(p)` helper unless a real third caller needs *exactly* "first space last" and would have to stay consistent with it.

**At scale.** With only three call sites this is a hand edit. With dozens, you'd migrate one caller per PR (specialize + delete branches), then once a flag is constant at *all* remaining sites, drop the parameter via a Semgrep/OpenRewrite rewrite — see [Expand-Contract](../06-expand-contract-refactors/junior.md) for removing a parameter across callers safely.
</details>

---

## Exercise 5 — Collapse the wrapper chain

**Anti-pattern:** Wrapper-itis / needless indirection · **Language:** Go · **Difficulty:** ★★ medium

A request to fetch a user travels through four layers, each of which only forwards the call. Collapse the chain to the one layer that does real work.

```go
type UserController struct{ svc *UserService }
func (c *UserController) Get(id string) (*User, error) { return c.svc.GetUser(id) }

type UserService struct{ mgr *UserManager }
func (s *UserService) GetUser(id string) (*User, error) { return s.mgr.FetchUser(id) }

type UserManager struct{ repo *UserRepository }
func (m *UserManager) FetchUser(id string) (*User, error) { return m.repo.LoadUser(id) }

type UserRepository struct{ db *sql.DB }
func (r *UserRepository) LoadUser(id string) (*User, error) {
    row := r.db.QueryRow("SELECT id, name FROM users WHERE id = $1", id)
    var u User
    if err := row.Scan(&u.ID, &u.Name); err != nil {
        return nil, err
    }
    return &u, nil
}
```

**Acceptance criteria**

- Eliminate layers that only forward.
- Keep the layer that does real work (the SQL).
- The controller calls the repository directly (or through at most one layer that earns its place).

<details><summary>Solution</summary>

Only `UserRepository` does anything — the SQL and scan. `UserManager` and `UserService` are pure pass-throughs (`return next.Method(id)`), and the `Controller` is the HTTP entry point. Collapse the two empty middle layers:

```go
type UserController struct{ repo *UserRepository }

func (c *UserController) Get(id string) (*User, error) {
    return c.repo.LoadUser(id)
}

type UserRepository struct{ db *sql.DB }

func (r *UserRepository) LoadUser(id string) (*User, error) {
    row := r.db.QueryRow("SELECT id, name FROM users WHERE id = $1", id)
    var u User
    if err := row.Scan(&u.ID, &u.Name); err != nil {
        return nil, err
    }
    return &u, nil
}
```

**Why.** Each removed layer added a file to read, a struct to construct and wire, and a hop on every trace — for zero behavior. "Controller → Service → Manager → Repository" is cargo-culted layering, not separation of concerns; concerns are only separated if each layer *has* a concern. The repository owns persistence; the controller owns HTTP; there is no business logic in between to host.

**When a middle layer *would* earn its place.** The moment `UserService` gains a real job — authorization, caching, combining the user with another aggregate, a transaction boundary — reintroduce it *with that logic in it*. The rule isn't "no layers"; it's "no *empty* layers." A layer that forwards is a tax; a layer that transforms is a feature.
</details>

---

## Exercise 6 — Keep it or kill it? (the trap)

**Anti-pattern:** Justified abstraction (judgment) · **Language:** Go · **Difficulty:** ★★ medium

A reviewer flagged this interface as "premature decoupling — delete it, there's one implementation." Decide whether to delete it. Read the surrounding facts carefully.

```go
// Clock lets time-dependent code be tested deterministically.
type Clock interface {
    Now() time.Time
}

type SystemClock struct{}
func (SystemClock) Now() time.Time { return time.Now() }

// In tests:
type fakeClock struct{ t time.Time }
func (f fakeClock) Now() time.Time { return f.t }

// Used by token-expiry logic, rate limiters, and scheduled-job code.
func (s *Session) Expired(c Clock) bool {
    return c.Now().After(s.ExpiresAt)
}
```

**Acceptance criteria**

- A verdict: keep or delete.
- Justify against the "earns its keep" checklist — don't reflexively delete.

<details><summary>Solution</summary>

**Keep it. Deleting this would be the actual mistake.** The reviewer pattern-matched "one production implementation → one-impl interface → delete," but the checklist passes decisively:

- **There is a genuine second implementation:** `fakeClock`, used in tests. A test double is a *real, exercised* implementation, not a hypothetical. Without the interface, time-dependent logic (token expiry, rate limits, schedules) can only be tested with `time.Sleep` or by mutating the system clock — flaky and slow.
- **It wraps a real boundary:** the system clock is non-determinism injected from outside the program — exactly the kind of I/O-ish dependency seams exist for.
- **Multiple real callers** use it the same way; no flags, no opt-outs.
- **It's tiny and stable:** one method, no divergence pressure.

This is the difference the chapter keeps drawing: a one-impl interface over *pure domain logic* with no boundary is speculative generality; a one-(prod)-impl interface over a *non-deterministic boundary with a real fake in tests* is a justified seam. The skill is judgment. **Reflexive deletion of abstraction is its own anti-pattern** — here the right move is to leave it and explain to the reviewer why the fake counts as a second implementation.
</details>

---

## Exercise 7 — Strip the speculative plugin system

**Anti-pattern:** Speculative Generality · **Language:** Python · **Difficulty:** ★★★ hard

A "pluggable report exporter framework" was built to support future formats. Two years on, there is exactly one plugin (CSV), and the registry/discovery machinery has never had a second entry. Strip it to the concrete behavior, preserving the public `export_report` call.

```python
import importlib, pkgutil

class ExporterPlugin:
    name: str
    def export(self, report) -> bytes:
        raise NotImplementedError

class ExporterRegistry:
    def __init__(self):
        self._plugins = {}
    def register(self, plugin: ExporterPlugin):
        self._plugins[plugin.name] = plugin
    def discover(self, package):
        for _, modname, _ in pkgutil.iter_modules(package.__path__):
            mod = importlib.import_module(f"{package.__name__}.{modname}")
            if hasattr(mod, "PLUGIN"):
                self.register(mod.PLUGIN)
    def get(self, name): return self._plugins[name]

# plugins/csv_exporter.py
class CsvExporter(ExporterPlugin):
    name = "csv"
    def export(self, report) -> bytes:
        rows = ["{},{}".format(r.label, r.value) for r in report.rows]
        return "\n".join(rows).encode("utf-8")
PLUGIN = CsvExporter()

# Public API, the only call site:
def export_report(report, fmt="csv"):
    registry = ExporterRegistry()
    registry.discover(plugins)
    return registry.get(fmt).export(report)
```

**Acceptance criteria**

- `export_report(report)` keeps working and returns the same bytes.
- No registry, no plugin base class, no dynamic discovery.
- A clear comment on *where* the extension point goes if a second format ever becomes real.

<details><summary>Solution</summary>

```python
def export_report(report, fmt="csv"):
    if fmt != "csv":
        raise ValueError(f"unsupported format: {fmt}")
    rows = ["{},{}".format(r.label, r.value) for r in report.rows]
    return "\n".join(rows).encode("utf-8")
```

**Why.** The framework — base class, registry, `pkgutil`/`importlib` discovery — exists to make adding formats easy, but no second format was ever added, so the entire apparatus is carrying cost for a benefit never collected. Worse, the dynamic discovery is *actively harmful*: it imports modules by reflection (invisible to static analysis and IDEs), can fail at runtime, and makes the one real code path hard to find under indirection.

**Where the seam goes when it's real.** If a second format genuinely arrives, the minimal honest abstraction is a dict dispatch — no base class, no discovery:

```python
def export_report(report, fmt="csv"):
    exporters = {"csv": _to_csv, "json": _to_json}
    try:
        return exporters[fmt](report)
    except KeyError:
        raise ValueError(f"unsupported format: {fmt}")
```

That's the Rule of Three in action: the abstraction grows to fit the *actual* second case, and even then stops at a dict — not a plugin runtime. A true plugin system (entry-points, third-party packages registering formats *you don't ship*) earns its keep only when external parties extend you without modifying your code. Inside one repo, it's speculative generality.
</details>

---

## Exercise 8 — Unwind a wrong abstraction across call sites

**Anti-pattern:** Wrong Abstraction at scale · **Language:** Java · **Difficulty:** ★★★ hard

A shared `NotificationSender.send` is called from 30+ places. It grew a `channel` enum and per-channel branches; callers always pass a constant channel. The branches have diverged so far that the "shared" method shares almost nothing. Outline and demonstrate the *safe, incremental* unwinding — not a big-bang rewrite.

```java
public enum Channel { EMAIL, SMS, PUSH }

public class NotificationSender {
    public void send(Channel ch, User u, String body) {
        if (ch == Channel.EMAIL) {
            String html = renderHtml(body);
            smtp.send(u.getEmail(), subjectFor(u), html);
            audit.log("email", u.getId());
        } else if (ch == Channel.SMS) {
            String text = truncate(body, 160);
            twilio.sms(u.getPhone(), text);
        } else if (ch == Channel.PUSH) {
            fcm.push(u.getDeviceToken(), new Payload(body));
            metrics.increment("push.sent");
        }
    }
}

// Call sites, always constant channel:
//   sender.send(Channel.EMAIL, user, "Your order shipped");
//   sender.send(Channel.SMS,   user, "Code: 1234");
//   sender.send(Channel.PUSH,  user, "You have a match");
```

**Acceptance criteria**

- Describe the steps so each is independently shippable and behavior-preserving.
- Show the target shape (three concrete senders, no `Channel` parameter).
- Note how you'd execute the call-site migration mechanically and where fitness functions/budgets lock it in.

<details><summary>Solution</summary>

**The diagnosis.** Three channels share only the method name and the `(User, String)` arguments — no rendering, no transport, no side-effects in common. The `Channel` enum and `if`-ladder are a wrong abstraction: each branch is a different concept (HTML email + audit; truncated SMS; push + metrics), and every caller already knows its channel at compile time, so the runtime dispatch buys nothing.

**Target shape — three concrete, single-purpose senders:**

```java
public class EmailNotifier {
    public void send(User u, String body) {
        smtp.send(u.getEmail(), subjectFor(u), renderHtml(body));
        audit.log("email", u.getId());
    }
}
public class SmsNotifier {
    public void send(User u, String body) {
        twilio.sms(u.getPhone(), truncate(body, 160));
    }
}
public class PushNotifier {
    public void send(User u, String body) {
        fcm.push(u.getDeviceToken(), new Payload(body));
        metrics.increment("push.sent");
    }
}
```

**The incremental, safe sequence (no flag day):**

1. **Characterize first.** Add tests pinning current behavior of all three branches (see [Strangler Fig & Seams](../05-strangler-fig-and-seams/junior.md)) — you can't safely unwind what you can't observe. Capture the exact SMTP/Twilio/FCM calls and the audit/metrics side-effects.
2. **Introduce the three concrete senders alongside the old one** (expand). The old `NotificationSender.send` stays and keeps working — nothing breaks yet. This is parallel change ([Expand-Contract](../06-expand-contract-refactors/junior.md)).
3. **Migrate call sites one channel at a time, one PR each.** Replace `sender.send(Channel.EMAIL, u, b)` with `emailNotifier.send(u, b)` at the EMAIL sites. Mechanical and pattern-matchable — an OpenRewrite recipe or Semgrep rule does the rewrite across all EMAIL call sites in one reviewable diff (see [Automated Large-Scale Refactoring](../04-automated-large-scale-refactoring/junior.md)). Repeat for SMS, then PUSH.
4. **Contract.** Once no caller references `NotificationSender.send`, delete the method, the `if`-ladder, and the `Channel` enum. This collapse is the *last* step and is trivial because the dependencies are already gone.
5. **Ratchet so it can't regrow.** Add a [fitness function](../01-architecture-fitness-functions/junior.md) (e.g. ArchUnit) that fails the build if any method takes a `Channel`-style behavior-selector enum and branches on it, and a [budget](../02-anti-pattern-budgets-and-ratcheting/junior.md) freezing the count of such dispatch-on-enum methods at zero.

**Why incremental matters at scale.** A single PR that deletes the enum and rewrites 30 call sites is unreviewable, conflicts with everything in flight, and is all-or-nothing to roll back. The staged version ships value continuously, keeps the build green at every step, and lets you stop or reverse at any point. The collapse is cheap *because* you did the spreading work first — the opposite order is where teams get stuck.
</details>

---

## Summary

- The dominant move against premature abstraction is **subtraction**: inline one-impl interfaces, collapse empty wrapper layers, and re-introduce honest duplication to dissolve a wrong abstraction.
- **DRY targets the same knowledge, not the same text.** Exercise 3's most-identical pair (the DTOs) is the one to *leave*; the discriminator is always "would a change to one force a change to the other?", never syntactic similarity.
- **The Rule of Three is a heuristic about uncertainty** — override it (extract at two) when the duplication is the same knowledge and divergence is a correctness bug (Exercise 2).
- **Not every abstraction is premature.** Exercise 6's `Clock` is a justified seam — a real fake in tests over a non-deterministic boundary. Reflexive deletion is its own anti-pattern; the skill is judgment.
- **At scale, unwind incrementally:** characterize → expand (new concrete forms) → migrate call sites mechanically, one slice per PR → contract (delete the dead abstraction) → ratchet. The collapse is the cheap last step, not the risky first one.

---

## Related Topics

- [Over-Engineering → Tasks](../../01-development/03-over-engineering/tasks.md) — the in-the-file simplification drills these scale up.
- [Automated Large-Scale Refactoring](../04-automated-large-scale-refactoring/junior.md) — the tooling to collapse flags and migrate call sites mechanically.
- [Expand-Contract Refactors](../06-expand-contract-refactors/junior.md) — removing a parameter or interface across many callers safely.
- [Strangler Fig & Seams](../05-strangler-fig-and-seams/junior.md) — characterization tests, the safety net for any unwinding.
- [Hotspot Analysis](../03-hotspot-analysis/junior.md) — decide *which* wrong abstraction is worth the unwinding budget.
- [Architecture → Anti-Patterns](../../../../../Architecture/anti-patterns/README.md) — system-level over-abstraction.
- Level files: [`senior.md`](senior.md) — the cost model and full unwinding playbook these exercises practice.
