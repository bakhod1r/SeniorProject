# Coupling & State Anti-Patterns — Find the Bug

> **Category:** [Design Anti-Patterns](../README.md) → **Coupling & State** — *modules that know or share too much, so behavior leaks across boundaries no signature admits to.*
> **Covers (collectively):** Singletonitis · Circular Dependency · Action at a Distance · Hidden Dependencies · Sequential Coupling

---

This file is **critical-reading practice**. Each snippet below is a plausible chunk of real-world code in Go, Java, or Python. Read it the way a good reviewer does — slowly, suspicious of what *isn't* on the screen — and answer three questions:

> **What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?**

Coupling-and-state anti-patterns are uniquely nasty because the damage is **non-local**. A function's signature says it needs two arguments; in truth it reads a clock, an env var, and a package-global someone mutated three files away. The compiler is happy. The test passes on your laptop and fails in CI. A method works on Tuesday and crashes on Wednesday because something *else* ran first. These are the bugs labeled "flaky," "spooky," or "works on my machine" — and they are almost always coupling and hidden state in disguise.

So the "bug" here is often a **latent functional or concurrency defect** that only fires under a second thread, a different environment, a particular call order, or a particular import graph. Several snippets contain a real, reproducible bug; at least one looks suspicious but is actually *justified* (a true process-wide singleton, or a sequence safely enforced by `with`/`defer`). Don't pattern-match on shape — trace the **state and the dependencies**.

> **How to use this file:** read each snippet and write your own answer *before* expanding the collapsible. The skill you're training is noticing the coupling, not recalling the name.

---

## Table of Contents

1. [The counter everyone shares](#snippet-1--the-counter-everyone-shares)
2. [Two packages that need each other](#snippet-2--two-packages-that-need-each-other)
3. [The parser that opens, reads, closes](#snippet-3--the-parser-that-opens-reads-closes)
4. [A discount that knows what day it is](#snippet-4--a-discount-that-knows-what-day-it-is)
5. [The sort that reaches across the room](#snippet-5--the-sort-that-reaches-across-the-room)
6. [The connection pool, globally](#snippet-6--the-connection-pool-globally)
7. [The two modules and their init order](#snippet-7--the-two-modules-and-their-init-order)
8. [The uploader with three steps](#snippet-8--the-uploader-with-three-steps)
9. [The price formatter that reads the locale](#snippet-9--the-price-formatter-that-reads-the-locale)
10. [The registry that imports its plugins](#snippet-10--the-registry-that-imports-its-plugins)
11. [The metrics object everybody pokes](#snippet-11--the-metrics-object-everybody-pokes)
12. [The HTTP client builder](#snippet-12--the-http-client-builder)
13. [The logger, the config, and the clock](#snippet-13--the-logger-the-config-and-the-clock)
14. [The cache singleton with a setter](#snippet-14--the-cache-singleton-with-a-setter)

---

## Snippet 1 — The counter everyone shares

```go
// Go — a request-ID generator used by every handler in the service
package idgen

var counter int64

func Next() int64 {
	counter++          // "it's just an increment"
	return counter
}
```

```go
// used from many concurrent HTTP handlers:
func handler(w http.ResponseWriter, r *http.Request) {
	id := idgen.Next()
	// ... attach id to logs, response, trace ...
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Singletonitis** (a mutable package-global as a de-facto singleton) causing a **data race**.

`counter` is shared mutable state with no synchronization, and `Next()` is called from many goroutines (one per HTTP request). `counter++` is *not atomic* — it compiles to load, add, store. Two goroutines can both read `41`, both write `42`, and you've handed out **the same request ID twice** while losing one. Worse, concurrent unsynchronized writes to an `int64` are undefined behavior in Go's memory model: `go test -race` flags it, and on some architectures you can read a torn value.

The signature `Next() int64` advertises a pure-looking generator. Nothing tells the caller it mutates hidden global state shared across the whole process.

**Concrete bug:** duplicate IDs under load → collided log/trace correlation, and (if the ID keys a map somewhere) overwritten records.

**Fix — make the mutation atomic; better, make the generator an injectable value, not a global:**

```go
type IDGen struct{ counter int64 }

func (g *IDGen) Next() int64 {
	return atomic.AddInt64(&g.counter, 1)   // atomic; no torn reads, no lost updates
}
// Construct one and inject it; tests get their own, no shared global to race.
```

If you genuinely want a package-level helper, at minimum guard it with `atomic` — but injecting an `*IDGen` also kills the testability problem (each test gets a fresh sequence).

</details>

---

## Snippet 2 — Two packages that need each other

```go
// Go — package user
package user

import "myapp/order"

type User struct {
	ID     int64
	Orders []*order.Order
}

func (u *User) LatestOrder() *order.Order { return order.Latest(u.ID) }
```

```go
// Go — package order
package order

import "myapp/user"

type Order struct {
	ID    int64
	Buyer *user.User    // back-reference to the owner
}

func Latest(userID int64) *Order { /* ... */ }
func OwnerOf(o *Order) *user.User { return user.Load(o.Buyer.ID) }
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Circular Dependency.** `user` imports `order`; `order` imports `user`. In Go this **does not compile** — the toolchain rejects import cycles outright (`import cycle not allowed`). In Java or Python it *would* compile, only to bite you later (see Snippet 7 for the runtime version of this hazard).

Even where the language tolerates it, the cycle is a design defect: the two packages can no longer be understood, tested, versioned, or reused independently. You cannot mock `order` when testing `user` without dragging the whole cycle in, and any change to either ripples into both.

**Concrete problem:** in Go, an immediate build failure; everywhere else, two modules fused into one un-decomposable blob where a "small" change to `order` forces a recompile/retest of `user` and vice versa.

**Fix — break the cycle.** Three standard moves:

1. **Extract the shared types** into a third leaf package both depend on:

```go
// package domain — no imports of user/order
type UserID int64
type Order struct { ID int64; BuyerID UserID }
type User  struct { ID UserID }
```

2. **Invert with an interface**: `order` defines a small `UserLookup` interface it needs and accepts it; it no longer imports `user` at all. `user` (or wiring code) supplies the implementation.

3. **Move the boundary-crossing function** (`OwnerOf`, `LatestOrder`) up into a higher-level package that's allowed to import both.

The dependency graph must be a DAG. If A and B point at each other, introduce C.

</details>

---

## Snippet 3 — The parser that opens, reads, closes

```python
# Python — reads and parses a config file
class ConfigFile:
    def __init__(self, path):
        self._path = path
        self._fh = None

    def __enter__(self):
        self._fh = open(self._path, "r")
        return self

    def __exit__(self, *exc):
        if self._fh:
            self._fh.close()
            self._fh = None

    def read_all(self):
        return self._fh.read()    # only valid between __enter__ and __exit__


# usage
with ConfigFile("app.toml") as cfg:
    text = cfg.read_all()
    settings = parse(text)
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Trick snippet: this is NOT a smell — it's Sequential Coupling done *right*.**

There is a strict required order here: `__enter__` (open) → `read_all` (use) → `__exit__` (close). `read_all` is meaningless before open and after close — that *is* sequential coupling. But the order is **enforced by the language**, not left to the caller's discipline. The `with` statement guarantees `__enter__` runs before the body and `__exit__` runs after it, *even if the body raises*. The caller literally cannot call `read_all()` outside the managed scope without going out of their way to misuse the object.

This is the textbook cure for Sequential Coupling: take an implicit "you must call these in this order" contract and bind it to a construct (`with` in Python, `try-with-resources` in Java, `defer` in Go, RAII in C++) so the runtime enforces it.

**What *would* make it a real anti-pattern:** exposing `open()` / `read_all()` / `close()` as three public methods the caller must remember to invoke in order — with nothing stopping `read_all()` after `close()` (returning garbage or raising on a `None` handle). That's Snippet 8's failure mode. Here, the contract is encoded, so it's safe.

**The lesson for critical reading:** sequential coupling isn't bad *because there's an order* — almost every resource has one. It's bad only when the order is **unenforced and implicit**. A documented sequence wrapped in `with`/`defer`/RAII is the fix, not the disease. Don't flag it.

> Minor hardening, not a fix: you could guard `read_all` with `if self._fh is None: raise RuntimeError("use within 'with'")` to give a clear error if someone smuggles the object out of scope.

</details>

---

## Snippet 4 — A discount that knows what day it is

```python
# Python — computes a "happy hour" discount
from datetime import datetime

def happy_hour_price(base_price):
    now = datetime.now()                  # reaches out to the wall clock
    if 16 <= now.hour < 18:               # 4pm–6pm local time
        return round(base_price * 0.8, 2)
    return base_price


# the test that "passes":
def test_happy_hour():
    assert happy_hour_price(100) == 80     # green at 5pm, red at 9am
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Hidden Dependency** on the system clock (and, lurking behind `datetime.now()`, on the machine's local timezone).

The signature `happy_hour_price(base_price)` claims to be a pure function of one argument. It lies: the result depends on `datetime.now()`, an ambient input the caller can neither see nor control. The function behaves *differently depending on when and where it runs*.

**Concrete bugs this causes:**
- **The test is non-deterministic.** `test_happy_hour` passes only when CI happens to run between 16:00 and 18:00 in the server's local time. Run it at 09:00, or on a build agent in UTC, and it fails — the classic "flaky test" that's actually a hidden-dependency test.
- **Timezone bug in production.** `datetime.now()` is *local* time. Move the service to a UTC container or a different region and "happy hour" silently shifts by hours — a real revenue/pricing defect with no code change.

**Fix — inject the dependency; make the ambient input an explicit parameter:**

```python
def happy_hour_price(base_price, now):           # time is now an argument
    if 16 <= now.hour < 18:
        return round(base_price * 0.8, 2)
    return base_price

# production passes a real clock; tests pass a fixed instant — deterministic:
def test_happy_hour():
    five_pm = datetime(2026, 6, 9, 17, 0)
    assert happy_hour_price(100, five_pm) == 80
```

Now the signature tells the truth, the test is repeatable, and the timezone is the caller's explicit decision. The same fix applies to hidden reads of `os.environ`, `time.time()`, `random`, and the filesystem: **pass them in.**

</details>

---

## Snippet 5 — The sort that reaches across the room

```python
# Python — a reporting module
rows = []                       # module-level "current working set"

def load(report_rows):
    global rows
    rows = report_rows

def sort_by_date():
    rows.sort(key=lambda r: r["date"])      # in place, mutates the shared list

def top_n(n):
    return rows[:n]


# elsewhere, in an unrelated feature:
def export_csv(data):
    rows_local = data
    rows_local.sort(key=lambda r: r["name"])   # same list object if caller passed `rows`
    write_csv(rows_local)
```

```python
# the call site that breaks:
load(fetch_rows())
sort_by_date()
export_csv(rows)          # someone passes the module global to the exporter
print(top_n(3))           # expected: 3 earliest by date — but they're now by name
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Action at a Distance** through a shared mutable module-global, layered on **Hidden Dependencies** (`sort_by_date` and `top_n` silently operate on a global nobody passed them).

The corruption is *spooky*: `export_csv` looks self-contained — it sorts "its" `data` by name. But the caller handed it the very same list object that the reporting module holds in `rows`. Python passes references; `list.sort()` mutates **in place**. So sorting inside `export_csv` reorders the reporting module's global. `top_n(3)` then returns the three rows that happen to be first *by name*, not *by date* — even though nothing in the reporting module changed and `sort_by_date` was called correctly.

**The actual bug:** the final `top_n(3)` returns the wrong rows, and the cause lives in a *different function in a different feature* that merely shared a reference to the same mutable object. This is the defining quality of Action at a Distance: editing one place changes behavior somewhere with no visible connection. Debugging it is miserable because `top_n` "looks fine."

**Fix — eliminate the shared global; pass data explicitly and avoid in-place mutation of inputs you don't own:**

```python
def sorted_by_date(report_rows):
    return sorted(report_rows, key=lambda r: r["date"])   # returns a new list

def export_csv(data):
    write_csv(sorted(data, key=lambda r: r["name"]))      # sorted(), not .sort()

# call site — explicit flow, no aliasing surprises:
data = fetch_rows()
print(sorted_by_date(data)[:3])
export_csv(data)        # cannot disturb anyone else's view of the data
```

State is now passed in and returned out; `sorted()` produces new lists instead of mutating shared ones, so no caller can reach across the room and reorder another's data.

</details>

---

## Snippet 6 — The connection pool, globally

```go
// Go — the database access layer
package db

import "database/sql"

var pool *sql.DB     // one pool for the whole process

func Init(dsn string) error {
	p, err := sql.Open("postgres", dsn)
	if err != nil {
		return err
	}
	p.SetMaxOpenConns(20)
	pool = p
	return nil
}

func Pool() *sql.DB { return pool }
```

```go
// main.go
func main() {
	if err := db.Init(os.Getenv("DATABASE_URL")); err != nil {
		log.Fatal(err)
	}
	// ... start server; handlers call db.Pool().QueryContext(...) ...
}
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Trick snippet — mostly justified, with one real defect to fix.**

A single `*sql.DB` per process is **correct and recommended**: `sql.DB` is a concurrency-safe connection *pool*, designed to be created once and shared. Creating one per request would defeat pooling and exhaust the database. So the "one global pool" instinct here is *not* Singletonitis in the pejorative sense — it's a genuine process-wide resource, the legitimate exception the [category README](../README.md) calls out. Don't reflexively flag it.

**But there are two real problems hiding in the justified shape:**

1. **An uninitialized-global landmine (Sequential Coupling on `Init`).** `Pool()` returns `pool`, which is `nil` until someone calls `Init`. Any code path that calls `db.Pool()` before `Init` — a test, an early `init()`, a CLI subcommand — gets a `nil *sql.DB` and a nil-pointer panic at first query. The required order ("Init before Pool") is implicit and unenforced.

2. **Hidden global coupling for tests.** Because `pool` is package-global, two tests can't point at two different databases; they fight over one global, and test order starts to matter.

**Fix — keep the single pool, but make it an injected value with no "call Init first" trap:**

```go
type Store struct{ pool *sql.DB }

func New(dsn string) (*Store, error) {
	p, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}
	p.SetMaxOpenConns(20)
	return &Store{pool: p}, nil     // a Store is never half-built; no nil-pool window
}

func (s *Store) Users() *sql.DB { return s.pool }
// main constructs one *Store and passes it down; tests construct their own.
```

You still have exactly one pool in production (you construct one `Store`), but there's no global, no init-order hazard, and tests can inject a `Store` pointed at a throwaway database. The resource is singular; its *plumbing* is dependency injection, not a mutable package var.

</details>

---

## Snippet 7 — The two modules and their init order

```python
# Python — module config.py
import registry

DEFAULTS = registry.build_defaults()   # runs at import time

TIMEOUT = DEFAULTS["timeout"]
```

```python
# Python — module registry.py
import config

_REGISTRY = {}

def build_defaults():
    return {"timeout": config.TIMEOUT, "retries": 3}    # reads config.TIMEOUT

def register(name, obj):
    _REGISTRY[name] = obj
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Circular Dependency** producing a **module-initialization-order bug** — the runtime cousin of Snippet 2, and the reason cycles are dangerous even in languages that compile them.

`config` imports `registry` and, *at import time*, calls `registry.build_defaults()`. But `build_defaults()` reads `config.TIMEOUT` — which is assigned *after* the `DEFAULTS = registry.build_defaults()` line in `config.py`. Trace the actual sequence:

1. Something imports `config`.
2. `config` line 2 runs `import registry`.
3. `registry` line 2 runs `import config` — but `config` is only *partway* through its own module body, so Python returns the **half-initialized** `config` module object (this is how Python breaks the cycle: it hands back the incomplete module rather than re-running it).
4. Back in `config`, `registry.build_defaults()` runs and evaluates `config.TIMEOUT` — **which doesn't exist yet**, because the `TIMEOUT = ...` line hasn't executed.

**The actual bug:** `AttributeError: module 'config' has no attribute 'TIMEOUT'` at import time — a crash that depends entirely on *which module gets imported first*. Flip the import order elsewhere in the app and the failure can move, vanish, or reappear. These are the worst bugs to diagnose: the stack trace points at innocent-looking module-level code, and the cause is the import graph plus evaluation order.

**Fix — break the cycle and stop doing real work at import time.** Both halves matter:

```python
# registry.py — no import of config; takes what it needs as an argument
_REGISTRY = {}

def build_defaults(timeout):
    return {"timeout": timeout, "retries": 3}
```

```python
# config.py — define plain values first; compose lazily, not at import time
import registry

TIMEOUT = 30

def defaults():                       # function, evaluated on demand
    return registry.build_defaults(TIMEOUT)
```

Now `registry` is a leaf (no cycle), `config.TIMEOUT` exists before anyone reads it, and nothing order-sensitive runs during import. The general rule: **module top-level code should define, not execute** — defer side-effecting composition into functions called explicitly after imports settle.

</details>

---

## Snippet 8 — The uploader with three steps

```java
// Java — multipart upload to object storage
public class Uploader {
    private String uploadId;
    private List<String> parts = new ArrayList<>();
    private boolean finished;

    public void begin(String key) {
        this.uploadId = storage.initiate(key);   // must be first
    }

    public void addPart(byte[] chunk) {
        String etag = storage.upload(uploadId, chunk);   // NPE if begin() not called
        parts.add(etag);
    }

    public String complete() {
        finished = true;
        return storage.complete(uploadId, parts);   // garbage if addPart never ran
    }
}
```

```java
// a caller, refactored under time pressure:
Uploader u = new Uploader();
u.addPart(firstChunk);     // forgot begin()
u.begin("report.csv");
u.complete();              // "completes" an upload with zero parts
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Sequential Coupling** in its dangerous, *unenforced* form (contrast with the safe `with`-wrapped version in Snippet 3), with a side of **Hidden Dependencies** on the mutable fields `uploadId`/`parts`/`finished` that thread state between calls.

The object only works if you call `begin()` → `addPart()`* → `complete()` **in that exact order**, but **nothing enforces it**. The compiler accepts any order. There's no state machine, no guard, no construct that binds the sequence.

**The actual bugs the refactored caller hits:**
- `addPart` before `begin` → `storage.upload(uploadId, ...)` with `uploadId == null` → `NullPointerException` (or an invalid-upload-id error from storage). The state's "you must call begin first" contract is invisible at the call site.
- Even with the right order, `complete()` happily finalizes with an empty `parts` list if no `addPart` ran — uploading a **zero-byte object** and reporting success. A silent data-loss bug.

This is exactly what Sequential Coupling produces: out-of-order calls that crash or, worse, *succeed wrongly*.

**Fix — make illegal orders unrepresentable.** Two good options:

*Type-state via the Builder / phased API* — you can't get an `addPart`-capable object without first beginning:

```java
public final class Uploader {
    public static Session begin(String key) {       // entry point returns the next state
        return new Session(storage.initiate(key));
    }
    public static final class Session {
        private final String uploadId;
        private final List<String> parts = new ArrayList<>();
        private Session(String id) { this.uploadId = id; }

        public Session addPart(byte[] chunk) {        // only callable on a live Session
            parts.add(storage.upload(uploadId, chunk));
            return this;
        }
        public String complete() {
            if (parts.isEmpty()) throw new IllegalStateException("no parts uploaded");
            return storage.complete(uploadId, parts);
        }
    }
}

// caller cannot call addPart/complete without begin — the type system enforces order:
String etag = Uploader.begin("report.csv").addPart(firstChunk).complete();
```

The phased type makes `begin` the only door in, `addPart` impossible before it, and `complete` reject the empty case. The required sequence is now encoded in the API, not in a tribal-knowledge comment.

</details>

---

## Snippet 9 — The price formatter that reads the locale

```python
# Python — formats money for display
import locale

def format_price(amount):
    locale.setlocale(locale.LC_ALL, "")     # use the process's current locale
    return locale.currency(amount)


# called from two places in the same process:
def invoice_line(amount):
    return format_price(amount)

def admin_report(amount):
    # a different feature set the locale earlier for German number formatting:
    # locale.setlocale(locale.LC_ALL, "de_DE.UTF-8")
    return format_price(amount)
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Hidden Dependency** on global process state (the C-level locale) *plus* **Action at a Distance** — `setlocale` mutates a single global shared by the entire process.

`format_price(amount)` claims to depend only on `amount`. In reality it depends on, and *mutates*, the process-wide locale via `locale.setlocale(..., "")`. That call is doubly bad: it reads ambient state (whatever `LC_ALL`/`LANG` the environment provides) *and* it changes a global that every other thread and module sees.

**The concrete bugs:**
- **Environment-dependent output.** `setlocale(LC_ALL, "")` adopts the environment's locale. The same code prints `$1,234.50` on a US dev box and `1.234,50 €` (or raises on an unsupported locale) in a differently-configured container — with no code change. Tests pass locally, fail in CI.
- **Action at a Distance / thread safety.** `setlocale` is process-global and **not thread-safe**. If `admin_report` (or any other code) set `de_DE` earlier, `invoice_line` now formats in German too — a feature it never touched. Under threads, one request's `setlocale` corrupts another request's formatting mid-flight. Spooky, intermittent, environment-shaped.

**Fix — pass the locale/currency explicitly; never mutate process-global state for a per-call concern:**

```python
from babel.numbers import format_currency   # locale-aware without global mutation

def format_price(amount, *, currency: str, locale: str) -> str:
    return format_currency(amount, currency, locale=locale)

def invoice_line(amount):
    return format_price(amount, currency="USD", locale="en_US")

def admin_report(amount):
    return format_price(amount, currency="EUR", locale="de_DE")
```

The dependency is now explicit in the signature, deterministic across environments, and thread-safe because nothing touches a shared global. The same rule covers any hidden read/write of `os.environ`, the working directory, or `signal`/`locale`/`timezone` process state: take it as a parameter, don't reach into the process.

</details>

---

## Snippet 10 — The registry that imports its plugins

```python
# Python — handlers/__init__.py, a plugin registry
HANDLERS = {}

def register(event_type):
    def deco(fn):
        HANDLERS[event_type] = fn
        return fn
    return deco

def dispatch(event):
    return HANDLERS[event["type"]](event)    # KeyError if plugin not imported


# handlers/email.py
from handlers import register

@register("email.send")
def send_email(event): ...
```

```python
# main.py
from handlers import dispatch

dispatch({"type": "email.send", "to": "a@b.com"})   # at startup
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Hidden Dependency** on **import side effects**, with a flavor of **Sequential Coupling** (the registry is only usable *after* every plugin module has been imported — an order nothing enforces).

The `HANDLERS` dict is populated by a **side effect**: importing `handlers/email.py` runs the `@register("email.send")` decorator, which mutates the global dict. But `main.py` imports only `handlers` (the package) and `dispatch`. It **never imports `handlers.email`**. So at the moment `dispatch` runs, `HANDLERS` is empty and the call raises `KeyError: 'email.send'`.

**The actual bug:** the registry "works" only if some earlier code happened to import every plugin module first — a dependency that is invisible at the call site and absent from any signature. It's order-dependent (Sequential Coupling) and side-effect-dependent (Hidden Dependency) at once. Symptom: a handler that's clearly defined in the codebase is mysteriously "not registered" at runtime, and the fix is "add an import you can't see you need." Reordering imports, lazy-loading, or a tree-shaking bundler can make it appear or vanish.

**Fix — make registration explicit, not a side effect of importing.** Either explicitly import-and-register the plugin set in one obvious place, or pass handlers in:

```python
# explicit assembly — the dependency is visible and ordered on purpose
from handlers.email import send_email
from handlers.sms import send_sms

def build_dispatcher():
    handlers = {
        "email.send": send_email,
        "sms.send": send_sms,
    }
    def dispatch(event):
        handler = handlers.get(event["type"])
        if handler is None:
            raise ValueError(f"no handler for {event['type']!r}")
        return handler(event)
    return dispatch

dispatch = build_dispatcher()    # all handlers present before first dispatch
```

Now nothing depends on the invisible side effect of an import having run, the wiring is in one greppable place, and a missing handler is a clear `ValueError`, not a spooky `KeyError` that depends on import order.

</details>

---

## Snippet 11 — The metrics object everybody pokes

```java
// Java — application-wide metrics
public final class Metrics {
    public static int requestsInFlight = 0;     // public, static, mutable
    public static long totalErrors = 0;
}
```

```java
// in the request filter:
Metrics.requestsInFlight++;
try {
    chain.doFilter(req, resp);
} catch (Exception e) {
    Metrics.totalErrors++;
    throw e;
} finally {
    Metrics.requestsInFlight--;
}
```

```java
// in a background reporter thread, every 10s:
log.info("in flight: " + Metrics.requestsInFlight + ", errors: " + Metrics.totalErrors);
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Singletonitis** (public static mutable global) causing a **data race with lost updates and torn reads**.

`Metrics` is a global bag of mutable counters touched by every request thread *and* a background reporter thread, with **no synchronization at all**. Three separate concurrency defects:

- `requestsInFlight++` and `totalErrors++` are read-modify-write on shared `int`/`long`, executed concurrently by many request threads → **lost updates**. Under load, your "in flight" gauge drifts permanently wrong and "total errors" undercounts — exactly when you need the numbers to be trustworthy.
- `long totalErrors` is **not guaranteed atomic** for reads/writes under the Java Memory Model (64-bit longs may be written as two 32-bit halves). The reporter thread can observe a **torn value** that was never actually held.
- Without `volatile` or a happens-before edge, the reporter thread may read a **stale** `requestsInFlight` indefinitely — there's no memory-visibility guarantee between the writers and the reader.

**The actual bug:** observability data that is silently, non-deterministically wrong — the worst kind, because dashboards look plausible while lying. A reviewer reading the filter in isolation sees a tidy try/finally and misses that the *globals* it pokes are unsynchronized shared state.

**Fix — use atomics (or proper concurrent counters); better, inject the registry rather than reaching a global:**

```java
public final class Metrics {
    private final AtomicInteger requestsInFlight = new AtomicInteger();
    private final LongAdder      totalErrors      = new LongAdder();  // high-contention counter

    public void enter()  { requestsInFlight.incrementAndGet(); }
    public void exit()   { requestsInFlight.decrementAndGet(); }
    public void error()  { totalErrors.increment(); }

    public int  inFlight() { return requestsInFlight.get(); }
    public long errors()   { return totalErrors.sum(); }
}
// Construct one Metrics, inject it into the filter and the reporter — no public static state.
```

`AtomicInteger`/`LongAdder` make the increments atomic and the reads consistent, and injecting the instance kills the global so tests get isolated counters.

</details>

---

## Snippet 12 — The HTTP client builder

```java
// Java — a configurable HTTP client; fields set fluently, then used
public class ApiClient {
    private String baseUrl;
    private Duration timeout;
    private String authToken;

    public ApiClient baseUrl(String u)   { this.baseUrl = u; return this; }
    public ApiClient timeout(Duration t) { this.timeout = t; return this; }
    public ApiClient token(String t)     { this.authToken = t; return this; }

    public Response get(String path) {
        // builds the request from the fields set so far
        return transport.send(baseUrl + path, timeout, authToken);
    }
}
```

```java
// two call sites in the codebase:
ApiClient client = new ApiClient().baseUrl("https://api.example.com").token(tok);
Response a = client.get("/users");      // timeout is null

// elsewhere, the SAME shared client instance (it's a @Singleton bean):
client.timeout(Duration.ofSeconds(2));  // someone "configures" it at runtime
Response b = client.get("/orders");     // now everyone's timeout changed
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Sequential Coupling** (you must call the setters before `get`, and a forgotten one is silently `null`) compounded by **Action at a Distance** (the client is a shared singleton bean, so one caller's `timeout(...)` mutates configuration for *every other caller*).

This is a "builder" that never built anything — it mixes configuration and use on one mutable object. Two distinct failures:

- **Unenforced order → null field.** The first call site never sets `timeout`, so `get("/users")` sends `timeout == null` to `transport.send` — an NPE or an unbounded request depending on the transport. Nothing required `timeout(...)` to be called first; the sequential contract is implicit.
- **Shared mutable config → spooky cross-talk.** Because `ApiClient` is a `@Singleton`, the second call site's `client.timeout(Duration.ofSeconds(2))` reaches across the whole application and changes the timeout *for request `a`'s code path too*, on the next call. Two unrelated features now race to configure one shared object; behavior depends on which ran last. Classic Action at a Distance through a mutable singleton.

**The actual bug:** request `b` (and every subsequent request anywhere) inherits a timeout it never asked for, and request `a` can NPE on a null field — both because configuration was left mutable on a shared instance.

**Fix — separate building from using; make the built client immutable so it can be shared safely:**

```java
public final class ApiClient {                 // immutable once built
    private final String baseUrl;
    private final Duration timeout;
    private final String authToken;

    private ApiClient(Builder b) {
        this.baseUrl = Objects.requireNonNull(b.baseUrl);
        this.timeout = Objects.requireNonNull(b.timeout);   // missing config fails at build, not at get()
        this.authToken = b.authToken;
    }
    public Response get(String path) { return transport.send(baseUrl + path, timeout, authToken); }

    public static final class Builder {
        private String baseUrl, authToken; private Duration timeout;
        public Builder baseUrl(String u)   { this.baseUrl = u; return this; }
        public Builder timeout(Duration t) { this.timeout = t; return this; }
        public Builder token(String t)     { this.authToken = t; return this; }
        public ApiClient build()           { return new ApiClient(this); }
    }
}

// build once, fully validated; share the immutable instance freely — no one can re-mutate it:
ApiClient client = new ApiClient.Builder()
    .baseUrl("https://api.example.com").timeout(Duration.ofSeconds(2)).token(tok).build();
```

`build()` validates required fields (no silent `null`), and the resulting client is immutable, so a singleton bean is now genuinely safe to share — no caller can reach across and change it.

</details>

---

## Snippet 13 — The logger, the config, and the clock

```go
// Go — writes an audit entry
package audit

import (
	"fmt"
	"os"
	"time"
)

func Record(action string) error {
	env := os.Getenv("APP_ENV")               // hidden dep #1: environment
	if env == "" {
		env = "dev"
	}
	line := fmt.Sprintf("[%s] %s %s\n",
		time.Now().UTC().Format(time.RFC3339), // hidden dep #2: wall clock
		env, action)
	f, err := os.OpenFile(auditPath(), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.WriteString(line)               // hidden dep #3: filesystem path
	return err
}

func auditPath() string { return "/var/log/app/audit.log" }   // hard-coded
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Hidden Dependencies, stacked three deep** — the signature `Record(action string) error` admits to needing a string and returns an error, while secretly depending on (1) the `APP_ENV` environment variable, (2) the wall clock, and (3) a hard-coded filesystem path.

Each hidden input is a separate liability:
- **Env var** → behavior changes based on ambient process configuration the caller can't see or override per call.
- **`time.Now()`** → output is non-deterministic; you cannot write a test that asserts the exact line without monkeypatching time globally.
- **Hard-coded `/var/log/app/audit.log`** → the function is **untestable and non-portable**. On a CI runner or a dev laptop that path doesn't exist or isn't writable, so `Record` returns an error (or, worse, tests that *do* run pollute a real shared file). It also can't run on Windows, in a read-only container, or twice in parallel against isolated outputs.

**The concrete bug:** unit tests for any code that calls `Record` fail or flake outside production (no `/var/log/app`, wrong `APP_ENV`, time you can't pin). The dependencies are real and necessary — the defect is that they're *hidden* instead of *declared*.

**Fix — promote every hidden input to an explicit, injected dependency:**

```go
type Auditor struct {
	Env   string
	Now   func() time.Time   // inject the clock; tests pass a fixed one
	Out   io.Writer          // inject the sink; tests pass a bytes.Buffer
}

func (a *Auditor) Record(action string) error {
	line := fmt.Sprintf("[%s] %s %s\n",
		a.Now().UTC().Format(time.RFC3339), a.Env, action)
	_, err := io.WriteString(a.Out, line)
	return err
}

// production wires real values; a test wires a fake clock + buffer and asserts the exact line:
a := &Auditor{Env: "test", Now: func() time.Time { return fixed }, Out: &buf}
```

Now the signature tells the whole truth: an `Auditor` carries its env, clock, and output explicitly. The function is deterministic, testable without touching the filesystem, and portable across environments — and you can point production at a file `io.Writer` without `Record` knowing or caring.

</details>

---

## Snippet 14 — The cache singleton with a setter

```python
# Python — a global cache used across the app
class Cache:
    _instance = None

    @classmethod
    def instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self._store = {}

    def get(self, key):
        return self._store.get(key)

    def set(self, key, value):
        self._store[key] = value


# feature A — caches the *current tenant's* permission set under a fixed key:
def load_permissions(tenant_id):
    perms = Cache.instance().get("permissions")
    if perms is None:
        perms = db.fetch_permissions(tenant_id)
        Cache.instance().set("permissions", perms)    # one global key for all tenants
    return perms
```

> What anti-pattern(s) are present? What concrete problem(s) does it cause? How would you fix it?

<details>
<summary>Answer</summary>

**Singletonitis** (a global, hidden, mutable single instance reached via `Cache.instance()`) producing a **cross-tenant data leak via Action at a Distance** — arguably the most serious bug in this file, because it's a security defect.

`Cache` is a process-wide singleton every feature reaches into through `instance()`. `load_permissions` caches results under the **fixed key `"permissions"`** — not keyed by `tenant_id`. So the first tenant whose request runs populates `Cache.instance().get("permissions")` with *their* permission set, and **every subsequent tenant gets the first tenant's permissions** until the process restarts.

**The actual bug:** Tenant B sees Tenant A's permissions. That's authorization bypass / data leakage caused entirely by coupling: a shared mutable global plus a non-tenant-scoped key. Each individual line "looks fine" — the cache works, the DB call works — but the *interaction* of a global singleton and a too-broad key corrupts state across requests that have no visible connection (Action at a Distance). It also depends on order/timing: whoever warms the cache first wins, so it can pass in single-threaded tests and explode in production.

The hidden-dependency angle compounds it: `load_permissions(tenant_id)` reads from `Cache.instance()` — a dependency absent from its signature — so tests can't substitute a fresh cache without resetting the global `_instance`, and one test leaks cached state into the next.

**Fix — scope the key correctly, inject the cache, and don't share request/tenant data through a global:**

```python
class Cache:                                  # a plain object, not a hidden global
    def __init__(self):
        self._store = {}
    def get(self, key):       return self._store.get(key)
    def set(self, key, value): self._store[key] = value

def load_permissions(tenant_id, cache):       # cache injected, not Cache.instance()
    key = ("permissions", tenant_id)          # scoped per tenant — no cross-leak
    perms = cache.get(key)
    if perms is None:
        perms = db.fetch_permissions(tenant_id)
        cache.set(key, perms)
    return perms
```

Two independent fixes, both required: the **per-tenant key** closes the leak, and **injecting the cache** removes the hidden global so tests are isolated and you could later swap in a real `redis`/`lru` backing without touching callers. If you do need one shared cache process-wide, that's fine — construct one and inject it; the danger was never "one instance," it was *global reach plus a shared key for per-tenant data*.

</details>

---

## Summary — patterns of spotting

You don't spot coupling-and-state anti-patterns by reading a single line — you spot them by asking **"what does this depend on that the signature doesn't admit, and who else can change what it touches?"** The repeatable moves from these fourteen snippets:

- **Read the signature, then hunt for inputs it doesn't declare.** A clock (`now()`), an env var (`getenv`), a locale, a filesystem path, a global registry, `random` — every ambient read is a **Hidden Dependency** that makes the function behave differently in tests and in another environment (Snippets 4, 9, 13). The cure is always the same: **pass it in**.
- **Find the shared mutable state and trace who writes it.** A package-global counter (Snippet 1), a global list aliased into another feature (Snippet 5), a process-wide locale (Snippet 9), a mutable singleton config/cache (Snippets 12, 14) — when two unrelated places write the same state, editing one mysteriously changes the other. That's **Action at a Distance**; the bug is non-local and "each function looks fine alone."
- **Under concurrency, every unsynchronized shared write is a bug.** `counter++`, `requestsInFlight++`, a plain `HashMap`/`int`/`long` touched by many threads → lost updates and torn reads (Snippets 1, 11). `go test -race` and the Java Memory Model are not optional. Make it atomic *and* prefer injecting the state over globalizing it.
- **Map the import graph; it must be a DAG.** A→B→A is a **Circular Dependency** — a compile error in Go (Snippet 2), and a far nastier *init-order crash* in Python/Java where the cycle is tolerated until module-level code reads a half-initialized neighbor (Snippet 7). Break it with a third leaf package or an inverted interface, and keep real work out of import-time code.
- **For every "you must call these in order" object, ask: is the order enforced?** Unenforced sequences crash or silently succeed wrong (Snippets 8, 12) — **Sequential Coupling**. The cure is to make illegal orders unrepresentable: a phased/Builder API, a state machine, or a scope construct. A sequence already wrapped in `with`/`defer`/RAII (Snippet 3) is the *fix*, not the disease — don't flag it.
- **Resist false positives.** Not every global is Singletonitis: a single `*sql.DB` pool per process is *correct* (Snippet 6), and a true process-wide resource is the legitimate exception. The danger is **global reach + mutable shared state**, not the count of instances. Inject even your singletons so tests stay isolated.

The meta-lesson: **coupling bugs are bugs of omission and reach.** The defect isn't a line you can point at — it's an input nobody declared, a global someone else mutated, an order nobody enforced, or an import cycle that decided initialization order for you. A hidden clock made a test flaky; a shared list reordered another feature's data; an unsynchronized counter handed out duplicate IDs; a global cache leaked one tenant's permissions to all of them. When behavior depends on *where*, *when*, *in what order*, or *who ran first* — look for the coupling, because the bug is hiding in the state nobody passed explicitly.

---

## Related Topics

- [`junior.md`](junior.md) — what each of the five coupling shapes looks like and why it's bad.
- [`middle.md`](middle.md) — when these creep in and the small countermove that reverses them.
- [`senior.md`](senior.md) — detecting and migrating these at scale in review.
- [`tasks.md`](tasks.md) — exercises that build the same muscles from the writing side.
- [`optimize.md`](optimize.md) — flawed designs to redesign end-to-end.
- [`interview.md`](interview.md) — Q&A across all levels.
- [Clean Code → Classes](../../../clean-code/09-classes/README.md) — SRP and the dependency-injection cure for hidden globals.
- [Clean Code → Immutability](../../../clean-code/14-immutability/README.md) — immutable config that's safe to share kills Action at a Distance.
- [Clean Code → Concurrency](../../../clean-code/11-concurrency/README.md) — the memory-model rules behind the data races above.
- [Clean Code → Modules and Packages](../../../clean-code/19-modules-and-packages/README.md) — keeping the dependency graph a DAG.
- [Design Patterns → Creational](../../../design-patterns/01-creational/README.md) — Builder and the state machine that encode required call order.
- [OO Misuse — Find the Bug](../01-oo-misuse/find-bug.md) and [Abstraction Failures — Find the Bug](../03-abstraction-failures/find-bug.md) — the sibling find-bug files in this chapter.