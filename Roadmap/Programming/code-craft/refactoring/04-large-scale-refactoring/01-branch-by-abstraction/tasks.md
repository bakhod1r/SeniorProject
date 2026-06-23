# Branch by Abstraction — Tasks

> **Source:** Paul Hammant, "Branch by Abstraction"; Jez Humble & David Farley, *Continuous Delivery*

Hands-on and scenario exercises. Try each before reading the worked solution. Code is Java; the reasoning is language-agnostic.

---

## Task 1 — Extract the seam (Phase 1)

You have a client coupled directly to a concrete class:

```java
public class HttpClient {                       // hand-rolled, concrete
    public String get(String url) { /* uses java.net */ return "..."; }
    public String post(String url, String body) { /* ... */ return "..."; }
    public void close() { /* ... */ }
}

public class WeatherService {
    private final HttpClient http = new HttpClient();   // <-- coupled + self-instantiated
    public Forecast today() { return parse(http.get("/today")); }
    private Forecast parse(String s) { return new Forecast(); }
}
```

**Do:** perform Phase 1 only — introduce the abstraction and make the existing class conform — without changing behavior. State the behavior-preserving steps.

<details><summary>Worked solution</summary>

```java
// 1. Extract an interface from what the client actually uses.
public interface HttpGateway {
    String get(String url);
    String post(String url, String body);
}

// 2. Old class implements it. (Note: close() was NOT in the client's usage,
//    so it's excluded — define the seam by client need, not class surface.)
public class HttpClient implements HttpGateway { /* body unchanged */ }
```

Steps:
1. Run **Extract Interface** on `HttpClient`, selecting only `get`/`post` (the methods `WeatherService` uses).
2. Note `WeatherService` *self-instantiates* `new HttpClient()` — that's a hidden dependency. Leave it for now; Phase 2 will inject the abstraction. Phase 1 changes nothing observable.
3. Run tests — identical behavior. Commit.

Key lesson: the seam is the client's *used* surface (`get`, `post`), not the class's full surface (`close` excluded).
</details>

---

## Task 2 — Invert the dependency (Phase 2)

Continue from Task 1. `WeatherService` still does `new HttpClient()` internally. Route it through the abstraction.

<details><summary>Worked solution</summary>

```java
public class WeatherService {
    private final HttpGateway http;                       // abstraction
    public WeatherService(HttpGateway http) { this.http = http; }  // injected
    public Forecast today() { return parse(http.get("/today")); }
    private Forecast parse(String s) { return new Forecast(); }
}

// Composition root now owns the wiring:
HttpGateway gateway = new HttpClient();
WeatherService service = new WeatherService(gateway);
```

Steps:
1. Add a constructor parameter `HttpGateway`; remove the `new HttpClient()` field initializer.
2. Move the `new HttpClient()` to the composition root.
3. Repeat for every other client of `HttpClient`, one commit each.
4. After this, the *only* place naming `HttpClient` is the composition root — the single point of control you want for the swap. Tests green; commit.
</details>

---

## Task 3 — Ship the new impl dark (Phase 3)

You now want a new HTTP gateway built on a modern client library. Add it behind the same seam, selectable by a flag, defaulting off.

<details><summary>Worked solution</summary>

```java
public class ModernHttpGateway implements HttpGateway {
    private final ModernClient client;
    public ModernHttpGateway(ModernClient client) { this.client = client; }
    @Override public String get(String url) { return client.request("GET", url, null); }
    @Override public String post(String url, String body) { return client.request("POST", url, body); }
}

// Composition root chooses, default OLD:
HttpGateway gateway = flags.isEnabled("use-modern-http")
        ? new ModernHttpGateway(modernClient)
        : new HttpClient();
```

Steps:
1. Write `ModernHttpGateway` with its own direct unit/integration tests (don't test it only through the flag).
2. Add flag `use-modern-http` defaulting to **false**.
3. Run the suite flag-off (matches old) and flag-on (exercises new). Both green.
4. Commit. New code is on trunk, shippable, dormant. Nobody's behavior changed.
</details>

---

## Task 4 — Design the flip & rollback (Phase 4)

Write the rollout plan and the rollback trigger conditions for flipping `use-modern-http` on a customer-facing path.

<details><summary>Worked solution</summary>

**Rollout:** internal traffic → 1% → 5% → 25% → 100%, pausing at each step to watch dashboards.

**Observability (tagged by `impl`):** error rate, latency p50/p95/p99, and any new-downstream saturation.

**Pre-agreed abort conditions (decide before flipping):**
- new-impl error rate exceeds old by > X%, or
- p99 latency regression > Y%, or
- any correctness anomaly.

**Rollback:** flip `use-modern-http` to OFF → 100% routes back to the proven `HttpClient` in seconds; confirm dashboards return to baseline; preserve logs/traces; diagnose off the hot path; re-ramp from a low percentage.

Lesson: the plan is written *before* the ramp. The flag's value is the ramp and the instant rollback — using neither is just a riskier deploy.
</details>

---

## Task 5 — Clean up (Phase 5), keep-or-inline decision

The flip baked at 100% for a month. Perform Phase 5 and justify whether to keep or inline `HttpGateway`.

<details><summary>Worked solution</summary>

```java
// Composition root after cleanup:
HttpGateway gateway = new ModernHttpGateway(modernClient);   // no flag, no old impl
```

Steps:
1. Delete `HttpClient` and its tests (compiler confirms no references).
2. Delete the `use-modern-http` flag and the ternary.
3. **Keep `HttpGateway`.** It's a genuine boundary: it isolates external I/O, aids testing (you can inject a fake gateway), and makes future swaps easy. This is *architecture*, not scaffolding.

Contrast: if the seam had been something like `OrderTotalCalculator` with only ever one real implementation and no testing benefit, you'd inline it instead. The test is "does this boundary earn its keep after the migration?"
</details>

---

## Task 6 — Argue against using the technique

A teammate proposes a full Branch by Abstraction (interface + runtime flag + 5 phases) to rename a method `calc()` to `calculateTotal()` on a class with eight call sites, all in your own module. Should they? Make the case.

<details><summary>Worked solution</summary>

No. This change lands atomically: an IDE **Rename** refactoring updates all eight call sites in one safe, behavior-preserving commit that the compiler verifies. There's no big-bang risk, no coexistence window, nothing to roll back gradually.

A full Branch by Abstraction here would be pure overhead — an interface and a flag that exist for no reason, scaffolding to erect and then tear down for a thirty-second job.

*If* the method were a **published** interface consumed outside your control (other teams/services depend on the name), then you wouldn't do Branch by Abstraction either — you'd do **Parallel Change**: add `calculateTotal()`, deprecate `calc()`, let consumers migrate, then remove `calc()`. See [Parallel Change](../02-parallel-change-expand-contract/junior.md). Branch by Abstraction is for swapping *components*, not renaming methods.
</details>

---

## Task 7 — Shadow-compare a read (verifying variant)

You're swapping a pricing engine and want production confidence before trusting the new one. Implement a comparing wrapper for the read-only `price(Cart)` method.

<details><summary>Worked solution</summary>

```java
public class ComparingPricingEngine implements PricingEngine {
    private final PricingEngine authoritative;   // old, trusted
    private final PricingEngine candidate;        // new
    private final Metrics metrics;

    @Override public Money price(Cart cart) {
        Money real = authoritative.price(cart);
        try {
            Money cand = candidate.price(cart);
            if (!real.equals(cand)) {
                metrics.increment("pricing.mismatch");
                // optionally log cart id + both values for diagnosis
            }
        } catch (RuntimeException e) {
            metrics.increment("pricing.candidate_error");
        }
        return real;   // user always gets the proven price
    }
}
```

Steps:
1. Wire `ComparingPricingEngine` behind the seam during the validation period.
2. Let real traffic flow; the user always gets the authoritative price, so risk is near zero.
3. Watch `pricing.mismatch`. When it's been flat at zero across a representative traffic sample, you've earned confidence to flip for real.

**Caveat:** this works because `price()` is a pure read. You could **not** safely shadow `checkout()` (a write) this way — that would charge twice. Writes need dual-write/reconciliation, not shadowing.
</details>

---

## Task 8 — Sequence two migrations

Your platform needs to swap both the persistence layer and the message broker. Persistence is on a hot path used everywhere; the broker is used by three background workers. Both are independent boundaries. How do you sequence them?

<details><summary>Worked solution</summary>

1. **Run them as two independent Branch-by-Abstraction efforts** — they're on different seams (`OrderRepository`, `MessagePublisher`) and don't collide, so they *can* proceed in parallel.
2. **But cap WIP and stagger the risky flips.** Don't have both at an active traffic ramp on the same week — overlapping cutovers make incident attribution hard.
3. **Start the broker migration's flip first.** Smaller blast radius (three workers), high observability, idempotent-ish — good place to validate your process.
4. **For persistence, migrate reads before writes**, shadow-compare reads, and keep the coexistence window short because it touches a hot path.
5. **Use the [Mikado Method](../03-mikado-method/junior.md)** if you discover hidden dependencies between them (e.g., the workers read from the store the persistence migration is changing) — Mikado surfaces the order; Branch by Abstraction executes each node.

Lesson: parallelize independent seams, serialize the *flips*, finish before starting more.
</details>

---

## Next

- [find-bug.md](find-bug.md) — diagnose misapplied Branch by Abstraction.
- [optimize.md](optimize.md) — turn rough situations into phased plans.
- Back to [junior.md](junior.md) · [middle.md](middle.md) · [interview.md](interview.md)
