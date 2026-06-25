> Exercises to build judgment about abstraction and generalization. The skill being trained is not "make things generic" — it's deciding *what to hide*, *what to ignore*, and crucially *when not to abstract at all*. **Global constraints:** for every task, write down (a) what detail you chose to ignore and why, (b) the axis of change you're betting on, and (c) one case where your abstraction would be the *wrong* call. Several tasks have a code component — keep examples small and concrete. There is no single right answer; defend your trade-off.

---

## Task 1 — Find the essence

Pick three real-world things you interact with daily (a subway map, a TV remote, a thermostat). For each, list five concrete details and label each **kept** (essence for the thing's job) or **thrown away** (irrelevant). Then change the *job* (e.g. the subway map's job becomes "estimate walking distance between stations") and re-label. Show that the essence moved when the problem moved. One paragraph of conclusions: why "the essence" is relative to the problem, not a property of the thing.

## Task 2 — Spot the mixed levels

The function below mixes business policy, encoding, and I/O. Rewrite it so each level lives in its own named helper and the top-level function reads as a story.

```python
def export_active_users(users):
    out = ""
    for u in users:
        if u.status == 1 and u.deleted_at is None and u.email:   # policy
            name = u.name.replace(",", " ").replace("\n", " ")    # CSV safety
            out += f"{u.id},{name},{u.email}\n"                   # formatting
    with open("/mnt/share/users.csv", "w") as f:                 # I/O
        f.write(out)
```

State which lines were at which altitude, and how many distinct levels you found.

## Task 3 — Apply the rule of three

Below are three snippets that appeared in a codebase over six months. Decide whether to abstract now, and if so, what the *parameterized variation* is. Show the extracted function. Then show a fourth, *different-looking* snippet and argue whether it belongs in the same abstraction or is a trap.

```python
# month 1
def discount_student(p): return p * 0.9
# month 3
def discount_senior(p):  return p * 0.85
# month 6
def discount_staff(p):   return p * 0.7
```

## Task 4 — Catch the premature generalization

Review this code, written when there was exactly **one** report type. Identify every piece of speculative generality (config that never varies, hooks with no implementation, a "strategy" with one strategy). Rewrite it as the simplest thing that serves the single real case. Note what you'd add back, and *when*, if a second report type appeared.

```python
class ReportEngine:
    def __init__(self, config, formatters=None, hooks=None, plugins=None):
        self.config = config or {"mode": "default"}
        self.formatters = formatters or {"default": DefaultFormatter()}
        self.hooks = hooks or []
        self.plugins = plugins or []

    def run(self, kind="default"):
        for h in self.hooks: h.before(kind)
        data = self.plugins or self._load()
        fmt = self.formatters.get(self.config["mode"], DefaultFormatter())
        out = fmt.render(data)
        for h in self.hooks: h.after(kind)
        return out
```

## Task 5 — Diagnose the wrong abstraction

This `notify` function started as a clean DRY-up of two call sites and rotted. Identify the symptom (the flag swamp), count the interacting paths the flags create, and write the **unwind plan** per Metz: inline back into the real call sites, then describe the smaller thing they actually share.

```python
def notify(user, kind, *, urgent=False, digest=False, sms_fallback=False,
           legacy_template=False, locale=None, suppress_quiet_hours=False):
    if legacy_template and digest:
        ...
    if urgent and not suppress_quiet_hours and in_quiet_hours(user):
        if sms_fallback: ...
        else: ...
    ...
```

You don't need to fully implement the rewrite — produce the inlined call sites (sketch) and name the genuinely shared piece.

## Task 6 — Fix the leaky abstraction

A `Cache.get(key)` is documented as "returns the value, or computes and stores it." In production it leaks: under a hot-key expiry, hundreds of requests all miss and recompute simultaneously (a thundering herd). The "simple get" hid concurrency the callers now need to control.

1. Name precisely what leaked (which hidden detail surfaced).
2. Decide: do you hide it *better* (e.g. single-flight inside `get`) or *expose a control* (e.g. `get(key, stale_ok=True)`)? Argue from the §"choose the leaks" principle.
3. Sketch the chosen fix. Write down the new, *documented* contract — including how it now degrades under stress.

## Task 7 — Name it right

Each name below leaks a lie about cost or failure. Rename it so the name encodes what it does *and* its cost/failure surface, and say what the old name misled the caller into assuming.

| Current name | What it actually does |
|--------------|-----------------------|
| `getUser(id)` | makes an HTTP call, can throw, ~80ms |
| `config.value(k)` | re-reads and re-parses a file every call |
| `list.contains(x)` | O(n) scan over a 1M-element list |
| `save(order)` | enqueues; persistence is async and may fail later |

## Task 8 — Choose the altitude for the audience

You're exposing "send a transactional email." Design **two** API signatures: one for app developers, one for the internal library authors who implement delivery. Show how the same capability is framed at two altitudes, and identify one concern that must be **hidden** from the app developer but **visible** to the library author (e.g. idempotency key, retry budget, provider selection). State which signature would be a *defect* if handed to the wrong audience.

## Task 9 — Kill the indirection tax

Here is a "clean architecture" slice. Find the layers that hide *no decision* and are pure pass-through, and collapse them. State, for each layer you keep, the specific decision it hides.

```python
class UserRepository:               # interface, ONE impl
    def get(self, id): ...
class UserRepositoryImpl(UserRepository):
    def get(self, id): return self.orm.query(User).get(id)   # forwards, no logic
class UserService:                  # ONE caller
    def __init__(self, repo): self.repo = repo
    def get(self, id): return self.repo.get(id)              # forwards, no logic
class UserController:
    def get(self, id): return self.service.get(id)          # forwards, no logic
```

What's the minimum that survives, and what real change (a second data source? a test seam?) would justify adding a layer back?

## Task 10 — Decide: abstract or stay concrete

For each scenario, decide abstract-now vs stay-concrete, and give the deciding reason (rule of three / YAGNI / hot path / unstable variation / shared reason to change):

1. A 4-line date-formatting block used in exactly one place.
2. The same retry-with-backoff loop copy-pasted across three services run by three teams.
3. A tight inner loop where a `Shape.area()` virtual call shows up as 30% of CPU in the profiler.
4. Two parsing functions that look 80% identical but one is for a stable file format and one for a format the vendor changes monthly.

## Task 11 — Platform-scale generalization gate (design)

Three teams have each independently built a feature-flag mechanism. You're considering extracting a shared platform service. Write the gate decision: what evidence justifies platform-izing now (use the "three production copies" rule), what the three copies tell you about the true axis of variation, and how you'd ship it to avoid the org-wide wrong abstraction (late, versioned, with an escape hatch). Name one signal that would tell you, post-launch, that you chose the *wrong* abstraction.

## Task 12 — Deprecation program (design)

An old `HttpClient.request()` abstraction hides timeout and retry config that 25 teams now need to tune — a leak bad enough to replace. Draft the deprecation **program**, not a code change: (1) how you quantify the blast radius (including Hyrum's-Law behaviors), (2) the bridge/adapter that keeps old callers working, (3) how you make the new path the path of least resistance, (4) the staged cutover, (5) your explicit decision on the long tail (fund the last 5% or freeze it behind a legacy boundary). One sentence each.
