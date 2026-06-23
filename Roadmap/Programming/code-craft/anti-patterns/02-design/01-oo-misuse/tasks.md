# OO Misuse Anti-Patterns — Exercises

> **Category:** [Design Anti-Patterns](../README.md) → **OO Misuse** — *hands-on practice moving behavior to where it belongs, replacing inheritance with composition, and giving the type system back its job.*
> **Covers (collectively):** Anemic Domain Model · BaseBean · Constant Interface · Poltergeist · Object Orgy · Functional Decomposition · Call Super · Magic Container · Flag Arguments · Telescoping Constructor · Fragile Base Class

---

These are **fix-it** exercises, not recognition quizzes. Each gives you a problem statement, a starting snippet in Go, Java, or Python (the language varies on purpose — these shapes appear in all three), acceptance criteria, and a collapsible solution. The goal is to *make the change*: pull logic into an anemic object, demolish a telescoping constructor with a builder, split a flag argument into two methods, replace a `Map<String,Object>` with a real type, swap a fragile base class for composition, and remove a Poltergeist.

> **How to use this file.** Read the problem, attempt it in your editor *before* opening the solution, then compare. The "why it's better" note under each solution is the payload — these anti-patterns are all the same mistake in different costumes (*responsibility in the wrong place*), and seeing the cure recur is the point. Refer back to [`junior.md`](junior.md) for the shapes and [`middle.md`](middle.md) for the countermoves.

> **One exercise is a trap.** Exercise 12 looks like an anemic-model violation but the right answer is to *leave it alone*. Knowing when an anti-pattern is actually the correct call is a senior skill; do not "fix" code that is already correct for its context.

---

## Table of Contents

| # | Exercise | Anti-pattern(s) | Lang | Difficulty |
|---|---|---|---|---|
| 1 | [Give the anemic account some behavior](#exercise-1--give-the-anemic-account-some-behavior) | Anemic Domain Model | Java | ★ easy |
| 2 | [Split the flag argument into two methods](#exercise-2--split-the-flag-argument-into-two-methods) | Flag Arguments | Go | ★ easy |
| 3 | [Demolish the telescoping constructor](#exercise-3--demolish-the-telescoping-constructor) | Telescoping Constructor | Java | ★ easy |
| 4 | [Type the magic container](#exercise-4--type-the-magic-container) | Magic Container | Python | ★★ medium |
| 5 | [Remove the Poltergeist](#exercise-5--remove-the-poltergeist) | Poltergeist | Python | ★★ medium |
| 6 | [Tighten the Object Orgy](#exercise-6--tighten-the-object-orgy) | Object Orgy | Go | ★★ medium |
| 7 | [Replace BaseBean inheritance with composition](#exercise-7--replace-basebean-inheritance-with-composition) | BaseBean + Fragile Base Class | Java | ★★ medium |
| 8 | [Kill the Constant Interface](#exercise-8--kill-the-constant-interface) | Constant Interface | Java | ★ easy |
| 9 | [Replace the flag with a strategy](#exercise-9--replace-the-flag-with-a-strategy) | Flag Arguments | Python | ★★ medium |
| 10 | [Re-objectify the functional decomposition](#exercise-10--re-objectify-the-functional-decomposition) | Functional Decomposition + Anemic | Python | ★★★ hard |
| 11 | [Cure Call Super with a template method](#exercise-11--cure-call-super-with-a-template-method) | Call Super + Fragile Base Class | Java | ★★★ hard |
| 12 | [Judgment call: leave the boundary DTO alone](#exercise-12--judgment-call-leave-the-boundary-dto-alone) | Anemic (acceptable!) | Go | ★★ judgment |
| 13 | [Mini-project: rescue the `BookingManager`](#exercise-13--mini-project-rescue-the-bookingmanager) | Several at once | Python | ★★★★ project |
| 14 | [Write an OO-misuse review checklist](#exercise-14--write-an-oo-misuse-review-checklist) | meta | — | ★★ medium |

---

## Exercise 1 — Give the anemic account some behavior

**Anti-pattern:** Anemic Domain Model · **Language:** Java · **Difficulty:** ★ easy

`BankAccount` is a bag of getters and setters. The actual *rules* — you cannot overdraw, you cannot deposit a negative amount — live in a separate service that reaches in and mutates the object's fields. Move the behavior onto the object so the rules cannot be bypassed.

```java
public class BankAccount {
    private long balanceCents;
    private boolean frozen;

    public long getBalanceCents()          { return balanceCents; }
    public void setBalanceCents(long b)    { this.balanceCents = b; }
    public boolean isFrozen()              { return frozen; }
    public void setFrozen(boolean f)       { this.frozen = f; }
}

public class AccountService {
    public void withdraw(BankAccount acc, long amount) {
        if (acc.isFrozen()) throw new IllegalStateException("frozen");
        if (amount <= 0)    throw new IllegalArgumentException("amount must be positive");
        if (acc.getBalanceCents() < amount) throw new IllegalStateException("insufficient funds");
        acc.setBalanceCents(acc.getBalanceCents() - amount);   // mutating from outside
    }
}
```

**Acceptance criteria**
- The withdrawal rule lives on `BankAccount`; `withdraw` is a method on the object, not on a service.
- The balance field has no public setter — nothing outside the class can put it into an illegal state.
- The behavior is identical (same exceptions, same order).

**Hint:** the setter `setBalanceCents` is the leak. Once `withdraw` lives on the object and the field is private with no setter, the only way to change the balance is *through a rule*. This is the [Tell, Don't Ask](../../../clean-code/05-objects-and-data-structures/README.md) principle.

<details>
<summary>Solution</summary>

```java
public class BankAccount {
    private long balanceCents;
    private boolean frozen;

    public BankAccount(long openingBalanceCents) {
        this.balanceCents = openingBalanceCents;
    }

    public void withdraw(long amount) {
        if (frozen)                 throw new IllegalStateException("frozen");
        if (amount <= 0)            throw new IllegalArgumentException("amount must be positive");
        if (balanceCents < amount)  throw new IllegalStateException("insufficient funds");
        balanceCents -= amount;
    }

    public void freeze() { this.frozen = true; }

    public long balanceCents() { return balanceCents; }   // read-only accessor, no setter
    public boolean isFrozen()  { return frozen; }
}
```

The `AccountService.withdraw` method is deleted; callers now write `account.withdraw(amount)`.

**Why it's better.** The invariant ("balance never goes negative, frozen accounts can't pay out") now lives *with the data it protects*, so there is no way to reach a `BankAccount` and put it into an illegal state — the `setBalanceCents` escape hatch is gone. The class is responsible for its own consistency, which is the whole point of encapsulation. The service was not adding value; it was a place for logic that had been *evicted* from the object. With behavior restored, `BankAccount` is testable on its own (`new BankAccount(100).withdraw(150)` → throws) and the rules cannot drift out of sync across multiple services that each "ask then mutate."

</details>

---

## Exercise 2 — Split the flag argument into two methods

**Anti-pattern:** Flag Arguments · **Language:** Go · **Difficulty:** ★ easy

`Render` takes a boolean that flips it between two genuinely different behaviors. At every call site you have to read the function body to know what `true` means.

```go
// Render in draft mode (true) skips images and watermarks the page;
// in final mode (false) it renders everything. The bool decides which.
func Render(doc Document, draft bool) []byte {
	var buf bytes.Buffer
	if draft {
		buf.WriteString(watermark)
		renderText(&buf, doc)           // text only, no images
	} else {
		renderText(&buf, doc)
		renderImages(&buf, doc)         // full fidelity
	}
	return buf.Bytes()
}

// Call sites: what does `true` mean here without reading the body?
//   Render(doc, true)
//   Render(doc, false)
```

**Acceptance criteria**
- The two behaviors are reachable through two clearly named functions.
- No caller passes a bare boolean whose meaning is invisible at the call site.
- Shared work is not duplicated.

**Hint:** a boolean parameter that selects between two behaviors *is* two functions. Split it, and extract any genuinely shared logic into a private helper.

<details>
<summary>Solution</summary>

```go
func RenderDraft(doc Document) []byte {
	var buf bytes.Buffer
	buf.WriteString(watermark)
	renderText(&buf, doc)
	return buf.Bytes()
}

func RenderFinal(doc Document) []byte {
	var buf bytes.Buffer
	renderText(&buf, doc)
	renderImages(&buf, doc)
	return buf.Bytes()
}
```

Call sites now read themselves: `RenderDraft(doc)` and `RenderFinal(doc)`.

**Why it's better.** `RenderDraft(doc)` says at the call site exactly what it does; `Render(doc, true)` did not — the reader had to open the function and decode which side of the `if` `true` lands on. Each function now has a single, linear body with no branch, so it is simpler to read and test. If the two modes diverge further (drafts gain a "DRAFT" header, finals gain a table of contents), they evolve independently instead of growing more flags. The rule of thumb: *if a boolean parameter is always passed as a literal `true`/`false`, it is selecting behavior and should be two functions.* (A boolean that is genuinely *data* — e.g. `user.SetActive(isActive)` where `isActive` comes from a variable — is fine.)

</details>

---

## Exercise 3 — Demolish the telescoping constructor

**Anti-pattern:** Telescoping Constructor · **Language:** Java · **Difficulty:** ★ easy

`Pizza` grew a chain of overloaded constructors. Each new option spawned another overload, and `new Pizza(12, "thin", true, false, true)` is unreadable at the call site — which boolean is the cheese?

```java
public class Pizza {
    private final int size;
    private final String crust;
    private final boolean cheese;
    private final boolean pepperoni;
    private final boolean mushrooms;

    public Pizza(int size) { this(size, "regular"); }
    public Pizza(int size, String crust) { this(size, crust, true); }
    public Pizza(int size, String crust, boolean cheese) { this(size, crust, cheese, false); }
    public Pizza(int size, String crust, boolean cheese, boolean pepperoni) {
        this(size, crust, cheese, pepperoni, false);
    }
    public Pizza(int size, String crust, boolean cheese, boolean pepperoni, boolean mushrooms) {
        this.size = size; this.crust = crust; this.cheese = cheese;
        this.pepperoni = pepperoni; this.mushrooms = mushrooms;
    }
}

// new Pizza(12, "thin", true, false, true)  // ...mushrooms? pepperoni? who can tell?
```

**Acceptance criteria**
- Constructing a pizza reads as named options at the call site.
- `size` (required) is mandatory; the toppings (optional) default sensibly.
- The constructed object is immutable — no setters introduced.

**Hint:** this is the textbook motivation for the [Builder pattern](../../../design-patterns/01-creational/03-builder/junior.md). Make the required field a builder constructor parameter and each option a fluent `withX` method; the private constructor takes the builder.

<details>
<summary>Solution</summary>

```java
public final class Pizza {
    private final int size;
    private final String crust;
    private final boolean cheese, pepperoni, mushrooms;

    private Pizza(Builder b) {
        this.size = b.size;
        this.crust = b.crust;
        this.cheese = b.cheese;
        this.pepperoni = b.pepperoni;
        this.mushrooms = b.mushrooms;
    }

    public static final class Builder {
        private final int size;                 // required
        private String crust = "regular";       // optional, with defaults
        private boolean cheese = true;
        private boolean pepperoni = false;
        private boolean mushrooms = false;

        public Builder(int size) { this.size = size; }

        public Builder crust(String c)    { this.crust = c; return this; }
        public Builder cheese(boolean c)  { this.cheese = c; return this; }
        public Builder pepperoni()        { this.pepperoni = true; return this; }
        public Builder mushrooms()        { this.mushrooms = true; return this; }

        public Pizza build() { return new Pizza(this); }
    }
}

// The call site is now self-documenting:
Pizza p = new Pizza.Builder(12)
        .crust("thin")
        .mushrooms()
        .build();
```

**Why it's better.** The call site names every choice, so `new Pizza.Builder(12).crust("thin").mushrooms().build()` is unambiguous where `new Pizza(12, "thin", true, false, true)` was a guessing game. Adding a topping is one new field plus one `withX` method — no constructor overload explosion (the telescoping version doubled its overloads with every optional flag). Required vs. optional is enforced by the API shape: `size` is a `Builder` constructor argument you cannot skip, while toppings have defaults. And `Pizza` stays immutable — there are no setters; the builder assembles the final object in one shot. (For 2–3 parameters a plain constructor is still fine; reach for the builder when the optional set grows or readability at the call site suffers.)

</details>

---

## Exercise 4 — Type the magic container

**Anti-pattern:** Magic Container · **Language:** Python · **Difficulty:** ★★ medium

This code passes a `dict[str, Any]` everywhere. The keys are stringly-typed, undocumented, and a typo (`"usr_id"` vs `"user_id"`) is a runtime `KeyError` discovered in production. Replace the magic container with a real type.

```python
def create_session(data: dict) -> dict:
    # what keys does `data` need? read every caller to find out.
    return {
        "user_id": data["user_id"],
        "token": generate_token(data["user_id"]),
        "expires_at": now() + data.get("ttl", 3600),
        "ip": data.get("ip"),
    }

def is_expired(session: dict) -> bool:
    return now() > session["expires_at"]      # hope nobody renamed the key

# caller — nothing checks these keys until runtime:
s = create_session({"user_id": 42, "ttl": 600, "ip": "1.2.3.4"})
```

**Acceptance criteria**
- `create_session` accepts and returns typed objects with named fields, not `dict[str, Any]`.
- A typo'd or missing field is a *construction-time* error (or a type-checker error), not a deep `KeyError`.
- Optional fields (`ip`, `ttl`) are expressed as defaults on the type.

**Hint:** a `@dataclass` (or `pydantic.BaseModel` at a trust boundary) gives you named fields, defaults, and a constructor that rejects unknown arguments. Let the type system tell you what's required.

<details>
<summary>Solution</summary>

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class SessionRequest:
    user_id: int
    ttl: int = 3600          # optional with a default
    ip: str | None = None

@dataclass(frozen=True)
class Session:
    user_id: int
    token: str
    expires_at: float
    ip: str | None = None

    def is_expired(self) -> bool:
        return now() > self.expires_at      # behavior travels with the data

def create_session(req: SessionRequest) -> Session:
    return Session(
        user_id=req.user_id,
        token=generate_token(req.user_id),
        expires_at=now() + req.ttl,
        ip=req.ip,
    )

# caller — a typo is caught immediately:
s = create_session(SessionRequest(user_id=42, ttl=600, ip="1.2.3.4"))
# SessionRequest(user_id=42, tll=600)  ->  TypeError at construction: unexpected keyword 'tll'
```

**Why it's better.** The fields are now *named and typed*, so an editor autocompletes them, a type checker (mypy/pyright) flags a missing or wrong field before the code runs, and `SessionRequest(tll=600)` fails loudly at construction instead of surfacing as a `KeyError` three calls deep in production. The `dict[str, Any]` told the reader nothing about its shape — you had to grep every caller to learn the contract; the dataclass *is* the contract. Behavior (`is_expired`) lives on `Session` rather than as a free function that re-indexes the dict, so it cannot drift from the data. Notice this also cures a latent Anemic Model: the `dict` had no behavior because a `dict` can't; a real type can. (At an external boundary — parsing untrusted JSON — use a validating model like `pydantic` so bad input is rejected, not just mistyped.)

</details>

---

## Exercise 5 — Remove the Poltergeist

**Anti-pattern:** Poltergeist · **Language:** Python · **Difficulty:** ★★ medium

`OrderProcessorStarter` is a Poltergeist: a short-lived object that exists only to call a method on another object and then vanishes. It holds no state and adds no behavior — it is pure ceremony. Remove it.

```python
class OrderProcessor:
    def process(self, order):
        # the real work lives here
        ...

class OrderProcessorStarter:
    """Created, used once, and discarded. Contributes nothing but a method call."""
    def __init__(self, order):
        self.order = order

    def begin(self):
        processor = OrderProcessor()
        processor.process(self.order)

# caller:
starter = OrderProcessorStarter(order)
starter.begin()
```

**Acceptance criteria**
- The `OrderProcessorStarter` class is gone.
- The caller invokes the real work directly.
- No state or behavior is lost (the Poltergeist had none to lose).

**Hint:** inline the Poltergeist. Ask what the intermediate object *holds* (nothing durable) and what it *does* (forwards one call). If both answers are "nothing of value," delete it and call through.

<details>
<summary>Solution</summary>

```python
class OrderProcessor:
    def process(self, order):
        ...

# caller — no ghost in between:
OrderProcessor().process(order)
```

**Why it's better.** The Poltergeist was a transient middleman: constructed, used for exactly one call, then garbage-collected, holding no state worth a class and forwarding a single method. Removing it deletes a layer of indirection that the reader had to trace through (`starter.begin()` → "what does begin do?" → "oh, it just calls process"). Now the call site says what happens. Poltergeists usually appear when someone models a *verb* ("starting", "managing", "driving") as a noun/class; the cure is to recognize that the verb is just a method on the object that does the work. If `OrderProcessor` itself is stateless and only ever has `process` called, the next simplification is to make `process` a plain function — but that is a separate decision (see Exercise 10 on Functional Decomposition, the *opposite* failure).

</details>

---

## Exercise 6 — Tighten the Object Orgy

**Anti-pattern:** Object Orgy · **Language:** Go · **Difficulty:** ★★ medium

Every field of `Wallet` is exported, so any package can mutate the balance directly, bypassing every rule. Encapsulation is fiction. Tighten visibility so the only way to change the balance is through a method that enforces the invariant.

```go
package wallet

type Wallet struct {
	Balance      int64   // exported — anyone can set it to anything
	Transactions []Txn   // exported — anyone can append/clear it
	Frozen       bool     // exported — anyone can unfreeze
}

// elsewhere, in some unrelated handler:
//   w.Balance -= 5000          // no overdraft check, no transaction recorded
//   w.Frozen = false           // silently unfreezes a fraud-locked wallet
//   w.Transactions = nil       // wipes the audit trail
```

**Acceptance criteria**
- The fields are unexported; outside packages cannot read or write them directly.
- Mutations go through methods that enforce invariants (no overdraft, record the transaction, respect frozen).
- Read access (where legitimately needed) is via accessor methods, not exported fields.

**Hint:** lowercase the field names to make them package-private, then expose a small, intention-revealing API (`Debit`, `Freeze`, `Balance()`). In Go, encapsulation is a package boundary, not a `private` keyword.

<details>
<summary>Solution</summary>

```go
package wallet

import "errors"

type Txn struct {
	AmountCents int64
	Memo        string
}

type Wallet struct {
	balanceCents int64    // unexported: only this package can touch it
	transactions []Txn
	frozen       bool
}

func New(openingCents int64) *Wallet {
	return &Wallet{balanceCents: openingCents}
}

func (w *Wallet) Debit(amountCents int64, memo string) error {
	if w.frozen {
		return errors.New("wallet frozen")
	}
	if amountCents <= 0 {
		return errors.New("amount must be positive")
	}
	if w.balanceCents < amountCents {
		return errors.New("insufficient funds")
	}
	w.balanceCents -= amountCents
	w.transactions = append(w.transactions, Txn{AmountCents: -amountCents, Memo: memo})
	return nil
}

func (w *Wallet) Freeze() { w.frozen = true }

// Read access through accessors that hand out copies, not internal slices.
func (w *Wallet) BalanceCents() int64 { return w.balanceCents }
func (w *Wallet) Transactions() []Txn {
	out := make([]Txn, len(w.transactions))
	copy(out, w.transactions)               // defensive copy: callers can't mutate our slice
	return out
}
```

**Why it's better.** With the fields unexported, the *only* way to move money is `Debit`, which enforces the overdraft check, refuses frozen wallets, and records the transaction — the audit trail can no longer be silently wiped, and a fraud-locked wallet can no longer be unfrozen by a stray assignment in an unrelated handler. The earlier version's exported fields meant every invariant lived on the honor system; any of dozens of packages could break it, and you would have no idea where. Note the `Transactions()` accessor returns a *copy*: handing out the internal slice would re-open the orgy (a caller could `append` to or clear it). Encapsulation in Go is enforced at the package boundary, so the discipline is "export the smallest API that callers genuinely need, and nothing else."

</details>

---

## Exercise 7 — Replace BaseBean inheritance with composition

**Anti-pattern:** BaseBean (+ latent Fragile Base Class) · **Language:** Java · **Difficulty:** ★★ medium

`ReportJob` and `EmailJob` both extend `BaseUtilities` purely to reach its helper methods — `log()` and `now()`. That is *inheritance for code reuse*, not for an is-a relationship. A `ReportJob` is not a `BaseUtilities`. Replace the inheritance with composition.

```java
public class BaseUtilities {
    protected void log(String msg) { System.out.println("[" + getClass().getSimpleName() + "] " + msg); }
    protected long now()           { return System.currentTimeMillis(); }
    // 15 other unrelated helpers a subclass might "need someday"...
}

public class ReportJob extends BaseUtilities {
    public void run() {
        log("generating report");          // inherited only to reach the helper
        long start = now();
        // ...generate...
        log("done in " + (now() - start) + "ms");
    }
}

public class EmailJob extends BaseUtilities {
    public void run() {
        log("sending email");
        // ...send...
    }
}
```

**Acceptance criteria**
- `ReportJob` and `EmailJob` no longer extend `BaseUtilities`.
- The helpers they actually use are injected as collaborators (a logger, a clock).
- Each job depends only on what it uses, not on 15 unrelated helpers.

**Hint:** "I extend the base class to call its methods" is the BaseBean smell. The cure is composition: turn the helpers into small collaborators (`Logger`, `Clock`) and pass them in. This also kills the [Fragile Base Class](../README.md) risk — a change to `BaseUtilities` can no longer ripple into every job.

<details>
<summary>Solution</summary>

```java
public interface Logger { void log(String msg); }
public interface Clock  { long now(); }

public final class ReportJob {
    private final Logger log;
    private final Clock clock;

    public ReportJob(Logger log, Clock clock) {
        this.log = log;
        this.clock = clock;
    }

    public void run() {
        log.log("generating report");
        long start = clock.now();
        // ...generate...
        log.log("done in " + (clock.now() - start) + "ms");
    }
}

public final class EmailJob {
    private final Logger log;

    public EmailJob(Logger log) {      // depends only on what it uses
        this.log = log;
    }

    public void run() {
        log.log("sending email");
        // ...send...
    }
}
```

**Why it's better.** The jobs now express their *real* dependencies: `ReportJob` needs a `Logger` and a `Clock`; `EmailJob` needs only a `Logger`. Under the old `extends BaseUtilities`, both inherited all 17 helpers and were welded to a base class whose every edit could break them ([Fragile Base Class](../README.md)) — adding a method to `BaseUtilities` that happened to clash with a subclass method, or changing `now()`'s units, would silently ripple outward. Composition severs that coupling: `BaseUtilities` no longer exists, and a job can be unit-tested by passing a fake `Clock` that returns a fixed time (impossible to mock when `now()` was an inherited final-ish method). The litmus test for inheritance is *is-a*, not *uses* — `ReportJob` **uses** a logger; it **is not** a utility bag. (See [Composition over inheritance](../../../design-patterns/02-structural/README.md).)

</details>

---

## Exercise 8 — Kill the Constant Interface

**Anti-pattern:** Constant Interface · **Language:** Java · **Difficulty:** ★ easy

`HttpConstants` is an interface that defines only constants, and classes "implement" it solely to import those names without qualification. This is the Constant Interface anti-pattern: it pollutes the implementing class's public API with constants, and the `implements` clause lies about a behavioral relationship that does not exist.

```java
public interface HttpConstants {
    int OK = 200;
    int NOT_FOUND = 404;
    int SERVER_ERROR = 500;
}

// "implements" the interface only to write OK instead of HttpConstants.OK:
public class ApiHandler implements HttpConstants {
    public Response handle(Request r) {
        if (r.isValid()) return new Response(OK);
        return new Response(SERVER_ERROR);
    }
}
```

**Acceptance criteria**
- `ApiHandler` no longer `implements` an interface just to reach constants.
- The constants are grouped in a type that cannot be instantiated or implemented.
- Where the values form a closed set, prefer an enum over loose `int`s.

**Hint:** for a genuinely open set of named values, a `final class` with a private constructor (or `static import`) is the idiom. For a *closed* set like HTTP status, an `enum` is stronger — it gives you type safety and exhaustiveness.

<details>
<summary>Solution</summary>

```java
// Closed, meaningful set -> an enum, not loose ints.
public enum HttpStatus {
    OK(200), NOT_FOUND(404), SERVER_ERROR(500);

    private final int code;
    HttpStatus(int code) { this.code = code; }
    public int code() { return code; }
}

public final class ApiHandler {
    public Response handle(Request r) {
        if (r.isValid()) return new Response(HttpStatus.OK);
        return new Response(HttpStatus.SERVER_ERROR);
    }
}
```

If you genuinely need bare integer constants (e.g. interop with a numeric API), use an un-implementable holder and a static import instead:

```java
public final class HttpStatus {
    public static final int OK = 200, NOT_FOUND = 404, SERVER_ERROR = 500;
    private HttpStatus() {}                 // cannot be instantiated or extended
}
// import static com.example.HttpStatus.OK;
```

**Why it's better.** `ApiHandler implements HttpConstants` claimed a type relationship that does not exist — nothing treats an `ApiHandler` *as a* `HttpConstants`, and the constants leaked into `ApiHandler`'s own API (any subclass would inherit them, and tools would list them as members). The enum version is strictly better for a closed set: `Response(HttpStatus.OK)` cannot be passed a meaningless `int` like `999`, a `switch` over it can be checked for exhaustiveness, and each value can carry behavior (`code()`). The `final class` with a private constructor is the fallback when you truly need raw constants — it can be neither instantiated nor implemented, so the anti-pattern cannot recur. (The constant interface dates from pre-`static-import` Java; it has no remaining justification.)

</details>

---

## Exercise 9 — Replace the flag with a strategy

**Anti-pattern:** Flag Arguments · **Language:** Python · **Difficulty:** ★★ medium

This one is *not* a simple two-method split. The flag selects between behaviors that callers want to choose at runtime, and the set of behaviors is growing. Splitting into `ship_standard`/`ship_express`/`ship_overnight` would push the choice up to a fan of `if`s at every call site. Replace the flag with a strategy instead.

```python
def shipping_cost(weight_kg: float, method: str) -> float:
    # `method` is a stringly-typed flag that keeps growing
    if method == "standard":
        return 5.0 + 0.5 * weight_kg
    elif method == "express":
        return 12.0 + 1.2 * weight_kg
    elif method == "overnight":
        return 30.0 + 2.5 * weight_kg
    else:
        raise ValueError(f"unknown method {method}")

# caller chooses at runtime from config / user input:
cost = shipping_cost(2.0, user_selected_method)
```

**Acceptance criteria**
- The behavior is selected by passing an object/function, not a string flag the body must decode.
- Adding a new shipping method does not require editing `shipping_cost`.
- The caller can pass a runtime-chosen strategy without a fan of `if`s.

**Hint:** when the flag selects a *runtime-chosen, growing* family of behaviors, the cure is the [Strategy pattern](../../../design-patterns/03-behavioral/08-strategy/junior.md), not two methods. Model each method as a small object (or a function) that knows how to price itself.

<details>
<summary>Solution</summary>

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class ShippingMethod:
    name: str
    base: float
    per_kg: float

    def cost(self, weight_kg: float) -> float:
        return self.base + self.per_kg * weight_kg

# The registry of methods is data, extensible without touching pricing logic.
STANDARD  = ShippingMethod("standard", 5.0, 0.5)
EXPRESS   = ShippingMethod("express", 12.0, 1.2)
OVERNIGHT = ShippingMethod("overnight", 30.0, 2.5)

METHODS = {m.name: m for m in (STANDARD, EXPRESS, OVERNIGHT)}

def shipping_cost(weight_kg: float, method: ShippingMethod) -> float:
    return method.cost(weight_kg)

# caller resolves a runtime string to a strategy once, at the boundary:
method = METHODS[user_selected_method]      # KeyError here = bad input, caught at the edge
cost = shipping_cost(2.0, method)
```

When the methods are pure formulas like these, a plain function is an even lighter strategy:

```python
PRICERS = {
    "standard":  lambda w: 5.0 + 0.5 * w,
    "express":   lambda w: 12.0 + 1.2 * w,
    "overnight": lambda w: 30.0 + 2.5 * w,
}
def shipping_cost(weight_kg: float, pricer) -> float:
    return pricer(weight_kg)
```

**Why it's better.** The growing `if/elif` chain became a registry of small, self-pricing objects, so adding "two-day" shipping is one new `ShippingMethod(...)` plus one map entry — `shipping_cost` itself never changes (open/closed). The string flag had two costs the strategy removes: the body had to *decode* it on every call, and an invalid value (`"expres"`) wasn't caught until it fell through to the `else`. Now the string is resolved to a strategy *once*, at the input boundary, where a bad value is an obvious `KeyError` you can map to a 400. The strategy is also independently testable — `EXPRESS.cost(2.0)` needs no dispatcher. (Contrast with Exercise 2: that flag chose between two *fixed* behaviors, so two methods sufficed; this flag chooses from a *runtime-selected, growing* family, which is exactly when Strategy pays off.)

</details>

---

## Exercise 10 — Re-objectify the functional decomposition

**Anti-pattern:** Functional Decomposition (+ Anemic Domain Model) · **Language:** Python · **Difficulty:** ★★★ hard

This is an OO codebase that is really a pile of free functions: a data class with nothing but fields, and a module of functions that pass that dumb object around. The state and the behavior have been pulled apart. Re-unite them into a real object.

```python
@dataclass
class Inventory:
    items: dict[str, int]      # sku -> quantity. Just data, no behavior.

# A module of functions that operate ON the data, passing it everywhere:
def add_stock(inv: Inventory, sku: str, qty: int) -> None:
    if qty <= 0:
        raise ValueError("qty must be positive")
    inv.items[sku] = inv.items.get(sku, 0) + qty

def remove_stock(inv: Inventory, sku: str, qty: int) -> None:
    if inv.items.get(sku, 0) < qty:
        raise ValueError("insufficient stock")
    inv.items[sku] -= qty

def total_units(inv: Inventory) -> int:
    return sum(inv.items.values())

def is_in_stock(inv: Inventory, sku: str) -> bool:
    return inv.items.get(sku, 0) > 0

# every call drags `inv` along as the first argument:
#   add_stock(inv, "A1", 10); remove_stock(inv, "A1", 3)
```

**Acceptance criteria**
- The behavior moves onto `Inventory` as methods; the free functions are gone.
- `items` is no longer directly mutable from outside (no reaching in to `inv.items[...]`).
- Each rule (positive qty, no over-removal) is enforced by the object.

**Hint:** every free function whose first parameter is `inv` is a method in disguise. Move it onto the class, drop the `inv` parameter (it becomes `self`), and make `items` private so the rules cannot be bypassed. This simultaneously cures the Anemic Model — the data finally has behavior.

<details>
<summary>Solution</summary>

```python
class Inventory:
    def __init__(self) -> None:
        self._items: dict[str, int] = {}     # private: outsiders can't mutate it

    def add_stock(self, sku: str, qty: int) -> None:
        if qty <= 0:
            raise ValueError("qty must be positive")
        self._items[sku] = self._items.get(sku, 0) + qty

    def remove_stock(self, sku: str, qty: int) -> None:
        if qty <= 0:
            raise ValueError("qty must be positive")
        if self._items.get(sku, 0) < qty:
            raise ValueError("insufficient stock")
        self._items[sku] -= qty

    def total_units(self) -> int:
        return sum(self._items.values())

    def is_in_stock(self, sku: str) -> bool:
        return self._items.get(sku, 0) > 0

    def quantity(self, sku: str) -> int:     # read accessor instead of exposing the dict
        return self._items.get(sku, 0)

# the call site reads as messages to an object that owns its state:
inv = Inventory()
inv.add_stock("A1", 10)
inv.remove_stock("A1", 3)
```

**Why it's better.** State and behavior are reunited: the rules that protect `items` now live *with* `items`, and because `_items` is private, no caller can do `inv.items["A1"] = -5` and corrupt the invariant behind the functions' backs (the old version's `items` was a public dict — the rules were optional). The free-function module was OO in syntax only; every function dragged `inv` along as its first argument, which is the tell-tale sign of a method that has been exiled from its class. Now `inv.remove_stock("A1", 3)` is a *message to an object*, and `Inventory` is responsible for its own consistency and testable as a unit. Note the opposite tension with Exercise 5: a Poltergeist is a *class that should be a function*; this is a *set of functions that should be a class*. The deciding question is always *where does the state live?* — if functions cluster around one piece of data, that data wants to be an object.

</details>

---

## Exercise 11 — Cure Call Super with a template method

**Anti-pattern:** Call Super (+ Fragile Base Class) · **Language:** Java · **Difficulty:** ★★★ hard

The base class *requires* every subclass to call `super.handle()` first, or a critical invariant (auditing) is silently skipped. This is the Call Super anti-pattern: correctness depends on subclass authors remembering an undocumented ritual the compiler does not enforce. Restructure it so the base class controls the flow and the subclass only fills in a hook.

```java
public abstract class RequestHandler {
    public void handle(Request r) {
        audit(r);                 // MUST run for every request — compliance requirement
        // subclasses are told: "always call super.handle(r) first"
    }
    private void audit(Request r) { /* write to the audit log */ }
}

public class PaymentHandler extends RequestHandler {
    @Override
    public void handle(Request r) {
        super.handle(r);          // if a dev forgets this line, auditing silently vanishes
        chargeCard(r);
    }
    private void chargeCard(Request r) { ... }
}

public class RefundHandler extends RequestHandler {
    @Override
    public void handle(Request r) {
        // oops — forgot super.handle(r). No audit. No error. Compliance gap ships.
        issueRefund(r);
    }
}
```

**Acceptance criteria**
- Auditing runs for every subclass automatically; it cannot be skipped by forgetting a call.
- The subclass implements only its own work via a clearly named hook, and cannot override the control flow.
- A new handler is correct by construction — there is no `super` call to forget.

**Hint:** this is the [Template Method pattern](../../../design-patterns/03-behavioral/09-template-method/junior.md). Make `handle` `final` in the base class so it owns the order (audit → do work); expose an abstract `doHandle(Request)` hook that the subclass *must* implement and that the base calls. No `super` ritual remains to forget.

<details>
<summary>Solution</summary>

```java
public abstract class RequestHandler {
    // final: subclasses cannot override the flow, only the hook.
    public final void handle(Request r) {
        audit(r);              // the base class guarantees this runs, every time
        doHandle(r);           // the subclass's contribution
    }

    private void audit(Request r) { /* write to the audit log */ }

    // The hook. The compiler forces every subclass to implement it;
    // there is no super-call ritual to remember or forget.
    protected abstract void doHandle(Request r);
}

public class PaymentHandler extends RequestHandler {
    @Override
    protected void doHandle(Request r) {
        chargeCard(r);
    }
    private void chargeCard(Request r) { ... }
}

public class RefundHandler extends RequestHandler {
    @Override
    protected void doHandle(Request r) {
        issueRefund(r);        // auditing already happened — guaranteed by the base
    }
    private void issueRefund(Request r) { ... }
}
```

**Why it's better.** The base class now *owns the control flow*: `handle` is `final`, so no subclass can replace the audit-then-work ordering, and it calls the abstract `doHandle` hook itself — the `super.handle(r)` ritual that `RefundHandler` forgot simply no longer exists to forget. Correctness is now *structural*: the compiler forces every subclass to implement `doHandle`, and the audit step is unconditionally invoked by code the subclass cannot touch. The original was doubly dangerous — it was a Call Super (skip the call, lose the invariant) *and* a Fragile Base Class (the contract "always call super first" was undocumented and unenforced, so it broke silently the moment someone added a handler without reading the lore). Template Method converts an honor-system contract into a compiler-checked one. (See [Behavioral patterns → Template Method](../../../design-patterns/03-behavioral/09-template-method/junior.md).)

</details>

---

## Exercise 12 — Judgment call: leave the boundary DTO alone

**Anti-pattern:** Anemic Domain Model — *but acceptable here* · **Language:** Go · **Difficulty:** ★★ judgment

A reviewer flags the struct below as an "anemic domain model — it has no behavior, just fields. Move logic onto it." Your task is to decide whether they are right, and to justify the decision. This is a *judgment* exercise: the correct answer may be **leave it as is**.

```go
// transport/dto.go — shapes the JSON request/response at the HTTP boundary.
type CreateUserRequest struct {
	Email    string `json:"email"`
	Name     string `json:"name"`
	Timezone string `json:"timezone"`
}

type UserResponse struct {
	ID        string `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
}

// the handler decodes into CreateUserRequest, maps to the domain User
// (which DOES have behavior), and encodes the domain User back into UserResponse.
```

The real domain type, `domain.User`, *does* have rich behavior (validation, state transitions, invariants). These structs exist only to carry data across the HTTP boundary and define the wire format.

**Acceptance criteria**
- A clear decision: refactor or leave it.
- A justification grounded in the *role* of these types, not a blanket rule.
- A statement of what would *change* your decision.

<details>
<summary>Solution</summary>

**Decision: leave it as is.** The reviewer is misapplying the rule.

**Why these structs are correctly anemic.** `CreateUserRequest` and `UserResponse` are **Data Transfer Objects** — their entire job is to define the *wire format* at the system boundary and carry bytes between the network and the domain. They are deliberately dumb:

- **They are not the domain model.** The anemic-domain-model anti-pattern is about *domain entities* — the objects that hold business state and should enforce business rules — being reduced to getter/setter bags while the rules leak into service classes. These DTOs are not domain entities; `domain.User` is, and it *does* carry the behavior. The rule is satisfied where it matters.
- **Behavior on a DTO would be a liability.** If `CreateUserRequest` validated itself or computed things, it would couple the transport layer to business rules, duplicate logic that belongs on `domain.User`, and make the wire contract harder to evolve independently of the domain. The mapping handler is the right seam: decode → map to domain (which validates) → encode.
- **They are a stable, serializable contract.** DTOs are intentionally plain so they serialize predictably and can change with the API version without dragging domain behavior along.

**What would change the decision.** If these structs started accumulating business logic — if `UserResponse` computed entitlements, or `CreateUserRequest.validate()` enforced domain invariants instead of mere shape/format checks — *that* would be the anemic-model smell reappearing (logic in the wrong layer), and the fix would be to push that behavior into `domain.User`. Likewise, if there were no real `domain.User` at all and these DTOs *were* the only "model," with services mutating their fields and enforcing rules externally — then the reviewer would be right, and the cure is to grow a real domain model behind the boundary.

**Why this matters.** "Objects must have behavior" is a heuristic, not a law. Applied blindly it produces *worse* code — fat DTOs that entangle transport and domain. The senior skill is reading the *role* of a type: a domain entity with no behavior is a smell; a boundary DTO with no behavior is correct design. (Compare [Premature Abstraction](../README.md) — another case where the "obvious" cleanup is the wrong move.)

</details>

---

## Exercise 13 — Mini-project: rescue the `BookingManager`

**Anti-pattern:** several OO-misuse patterns at once · **Language:** Python · **Difficulty:** ★★★★ project

The module below packs in a stack of OO-misuse anti-patterns: an **anemic** `Booking` (data only), a **magic container** (`dict` config passed around), a **telescoping** constructor, a **flag argument**, and a **Poltergeist** (`BookingFinalizer`). Refactor it into clean, behavior-bearing objects. Work in steps — fix one anti-pattern at a time, keeping behavior green after each.

```python
class Booking:
    # anemic: pure data, all rules live elsewhere
    def __init__(self, guest, room, nights, breakfast, late_checkout, parking):
        self.guest = guest
        self.room = room
        self.nights = nights
        self.breakfast = breakfast
        self.late_checkout = late_checkout
        self.parking = parking
        self.confirmed = False

class BookingFinalizer:
    # Poltergeist: created, calls one method, discarded
    def __init__(self, booking):
        self.booking = booking
    def finalize(self):
        BookingManager().confirm(self.booking)

class BookingManager:
    def price(self, booking, config: dict) -> float:
        # magic container: stringly-typed config dict
        total = config["room_rates"][booking.room] * booking.nights
        if booking.breakfast:
            total += config["breakfast_fee"] * booking.nights
        if booking.parking:
            total += config["parking_fee"] * booking.nights
        if booking.late_checkout:
            total += config["late_fee"]
        return total

    def confirm(self, booking):
        if booking.nights <= 0:
            raise ValueError("nights must be positive")
        booking.confirmed = True

# usage:
#   b = Booking("Ada", "deluxe", 3, True, False, True)   # which bool is which?
#   BookingFinalizer(b).finalize()
```

**Acceptance criteria**
- **Anemic Model:** the booking's rules (validity, confirmation) live on `Booking`.
- **Magic Container:** the `dict` config becomes a typed object.
- **Telescoping Constructor:** the long positional constructor is replaced with a readable construction API.
- **Flag Arguments:** the boolean add-ons are no longer ambiguous positional booleans.
- **Poltergeist:** `BookingFinalizer` is removed.
- Each unit is testable in isolation.

**Hint:** model the add-ons as a set/enum (kills the boolean soup *and* the telescoping toppings), make `Rates` a typed config object, move `price`/`confirm` onto `Booking`, and delete the finalizer by calling `booking.confirm()` directly. Tackle them one at a time.

<details>
<summary>Solution</summary>

```python
from dataclasses import dataclass, field
from enum import Enum

# --- Magic Container -> a typed config object. ---
@dataclass(frozen=True)
class Rates:
    room_rates: dict[str, float]
    breakfast_fee: float
    parking_fee: float
    late_fee: float

# --- Flag Arguments + Telescoping -> a small enum + a set of add-ons. ---
class AddOn(Enum):
    BREAKFAST = "breakfast"
    PARKING = "parking"
    LATE_CHECKOUT = "late_checkout"

# --- Anemic Model cured: Booking now owns its rules. ---
@dataclass
class Booking:
    guest: str
    room: str
    nights: int
    add_ons: set[AddOn] = field(default_factory=set)
    confirmed: bool = False

    def __post_init__(self):
        if self.nights <= 0:
            raise ValueError("nights must be positive")   # invalid bookings can't exist

    def price(self, rates: Rates) -> float:
        total = rates.room_rates[self.room] * self.nights
        if AddOn.BREAKFAST in self.add_ons:
            total += rates.breakfast_fee * self.nights
        if AddOn.PARKING in self.add_ons:
            total += rates.parking_fee * self.nights
        if AddOn.LATE_CHECKOUT in self.add_ons:
            total += rates.late_fee
        return total

    def confirm(self) -> None:
        self.confirmed = True

# --- Usage: self-documenting construction; the Poltergeist is gone. ---
b = Booking(
    guest="Ada",
    room="deluxe",
    nights=3,
    add_ons={AddOn.BREAKFAST, AddOn.PARKING},   # named, order-independent, no boolean soup
)
b.confirm()                                      # was: BookingFinalizer(b).finalize()

rates = Rates(room_rates={"deluxe": 200.0}, breakfast_fee=15.0, parking_fee=20.0, late_fee=40.0)
total = b.price(rates)
```

**What happened to each anti-pattern:**

- **Anemic Model →** `price` and `confirm` moved *onto* `Booking`; the `BookingManager` god-service that owned the rules is gone. `__post_init__` enforces the "positive nights" invariant at construction, so an invalid `Booking` can never exist.
- **Magic Container →** the stringly-typed `config: dict` became the typed `Rates` dataclass — a typo in a fee name is now an attribute error caught early, not a `KeyError` at pricing time.
- **Telescoping Constructor →** the six-positional-argument constructor became keyword construction with a defaulted `add_ons` set; you no longer guess which positional `True` is breakfast.
- **Flag Arguments →** the three booleans collapsed into a `set[AddOn]`. `{AddOn.BREAKFAST, AddOn.PARKING}` is unambiguous and order-independent, and adding a "spa" add-on is one enum value, not a fourth positional boolean.
- **Poltergeist →** `BookingFinalizer` is deleted; `b.confirm()` is the direct call it was hiding.

**Why it's better.** The data and its rules are reunited on `Booking`, so the object guards its own consistency and is testable without any manager (`Booking("Ada", "deluxe", 0)` → raises at construction; `b.price(rates)` needs only a `Rates`). The construction call site documents itself, the config is type-checked, the boolean combinatorics are gone, and a layer of ghostly indirection has been removed. Crucially, this was done as a *sequence* of small steps — type the config, enum the add-ons, move the methods, delete the finalizer — each leaving the module working, never a big-bang rewrite.

</details>

---

## Exercise 14 — Write an OO-misuse review checklist

**Anti-pattern:** meta (prevention) · **Difficulty:** ★★ medium

OO misuse is cheapest to catch in code review, before the wrong shape calcifies. Write a concise, *actionable* reviewer checklist — phrased as questions a reviewer asks of a diff — that catches the eleven OO-misuse anti-patterns before they merge. Each question needs a clear "if yes, push back" trigger, not vague advice like "is this good OO?"

**Acceptance criteria**
- One or more concrete, answerable questions covering the eleven anti-patterns.
- Each question has a clear failure trigger and a suggested action.
- Short enough that a reviewer would actually run it on every PR.

<details>
<summary>Solution</summary>

**OO-misuse PR review checklist**

| # | Question | If the answer is… | Then | Catches |
|---|---|---|---|---|
| 1 | Is this a domain class that's only fields + getters/setters, with the rules in a separate `*Service`? | "Yes" | Push back: move the behavior onto the class (Tell, Don't Ask). *Unless it's a boundary DTO.* | Anemic Domain Model |
| 2 | Does a new constructor parameter take the count past ~3, or is a new overload being added? | "Yes" | Suggest a builder, named args, or a parameter object. | Telescoping Constructor |
| 3 | Does any changed method take a boolean that flips behavior, always passed as a literal? | "Yes" | Split into two methods, or pass an enum/strategy. | Flag Arguments |
| 4 | Is a `Map<String,Object>` / `dict[str,Any]` / `Bundle` being passed between functions? | "Yes" | Ask for a typed struct/dataclass with named fields. | Magic Container |
| 5 | Does this class `extends`/embeds a base purely to reach helper methods (not is-a)? | "Yes" | Replace inheritance with composition / injected collaborators. | BaseBean, Fragile Base Class |
| 6 | Does an overridden method *require* a `super.x()` call to stay correct? | "Yes" | Restructure to Template Method: `final` flow + abstract hook. | Call Super |
| 7 | Does a change to a base class risk silently breaking subclasses, with no documented contract? | "Yes" | Mark `final` by default; document the inheritance contract or favor composition. | Fragile Base Class |
| 8 | Is there a class that's constructed, used for one call, and discarded, holding no state? | "Yes" | Inline it; call the real object directly. | Poltergeist |
| 9 | Are an object's fields public (or a slice/map handed out without a copy)? | "Yes" | Tighten visibility; expose intention-revealing methods; copy on read. | Object Orgy |
| 10 | Is this a class wrapping a set of free functions that all take the same data as their first arg? | "Yes" | Make it a real object: move the functions onto the data as methods. | Functional Decomposition |
| 11 | Is an interface defined only to hold constants, "implemented" to import names? | "Yes" | Use an enum, `static import`, or an un-instantiable constants holder. | Constant Interface |

**Author's pre-flight (same list, mirrored):** before requesting review, run questions 1–11 on your own diff. The recurring theme is *where does responsibility live?* — behavior with its data, dependencies passed not constructed, the type system doing the documenting.

**Why this is better than "review for good OO."** Each row has a *trigger* and an *action*, so the checklist is mechanical enough to apply under time pressure and specific enough that two reviewers reach the same verdict. Note row 1's escape hatch (boundary DTOs) — the checklist encodes *judgment*, not blanket rules, exactly the distinction Exercise 12 trains. It catches these shapes at their cheapest moment — a small diff — before they harden into a refactor that spans the codebase.

</details>

---

## Summary

- OO misuse is, at root, **one mistake wearing eleven costumes: responsibility ends up in the wrong place.** Behavior gets exiled from the data it protects (Anemic Model, Functional Decomposition), the type system is bypassed (Magic Container, Constant Interface, Flag Arguments), inheritance is used for reuse instead of is-a (BaseBean, Call Super, Fragile Base Class), or ceremony replaces value (Poltergeist, Telescoping Constructor, Object Orgy).
- **The recurring cure is to put behavior with its data and to let the compiler do the documenting:** move methods onto the object, replace boolean/stringly-typed flags with enums and strategies, replace magic dicts with typed structs, replace inheritance-for-reuse with composition, and replace honor-system `super` calls with Template Method.
- **Match the cure to the *kind* of choice.** A boolean between two fixed behaviors → two methods (Ex. 2); a runtime-chosen growing family → Strategy (Ex. 9). A class that should be a function → inline it (Ex. 5); functions that should be a class → objectify them (Ex. 10). Reading the situation, not applying a reflex, is the skill.
- **Know when the anti-pattern is the right answer.** A boundary DTO is *correctly* anemic (Ex. 12); "objects must have behavior" is a heuristic, not a law. Senior judgment is recognizing role, not pattern-matching shape.
- **Refactor in small green steps.** The mini-project (Ex. 13) fixes five anti-patterns one at a time, never as a big-bang rewrite — type the config, then the enum, then move the methods, then delete the ghost.
- **Prevention scales better than cure.** The review checklist (Ex. 14) moves the fight upstream, catching the wrong shape while the diff is still small and cheap to reshape.

---

## Related Topics

- [`junior.md`](junior.md) — the eleven shapes and how to recognize them on sight.
- [`middle.md`](middle.md) — the forces that create these shapes and the countermoves used here.
- [`find-bug.md`](find-bug.md) — spot-the-anti-pattern snippets (critical reading practice).
- [`optimize.md`](optimize.md) — more flawed designs to redesign.
- [`interview.md`](interview.md) — Q&A across all levels for job prep.
- [Design Patterns → Builder](../../../design-patterns/01-creational/03-builder/junior.md) — the cure for the Telescoping Constructor (Ex. 3).
- [Design Patterns → Strategy](../../../design-patterns/03-behavioral/08-strategy/junior.md) — the cure for a runtime-selected Flag Argument (Ex. 9).
- [Design Patterns → Template Method](../../../design-patterns/03-behavioral/09-template-method/junior.md) — the cure for Call Super (Ex. 11).
- [Design Patterns → Structural patterns](../../../design-patterns/02-structural/README.md) — composition over inheritance, the cure for BaseBean (Ex. 7).
- [Clean Code → Objects and Data Structures](../../../clean-code/05-objects-and-data-structures/README.md) — Tell, Don't Ask, the principle behind the Anemic Model cure.
- [Clean Code → Immutability](../../../clean-code/14-immutability/) — read-only accessors and defensive copies (Ex. 6).
- [Design Anti-Patterns overview](../README.md) — the sibling categories; Coupling & State's Hidden Dependencies shares a border with Object Orgy.
