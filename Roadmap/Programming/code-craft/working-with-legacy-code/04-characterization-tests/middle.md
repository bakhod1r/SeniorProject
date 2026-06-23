# Characterization Tests — Middle Level

## Table of Contents

- [The algorithm, stated precisely](#the-algorithm-stated-precisely)
- [Worked iteration: characterizing an invoice calculator](#worked-iteration-characterizing-an-invoice-calculator)
- [Choosing inputs: covering paths, not values](#choosing-inputs-covering-paths-not-values)
- [Golden Master / Approval Testing](#golden-master--approval-testing)
- [Combinatorial input generation](#combinatorial-input-generation)
- [Handling messy output](#handling-messy-output)
- [Sensing behavior through seams](#sensing-behavior-through-seams)
- [Characterization vs TDD, made concrete](#characterization-vs-tdd-made-concrete)
- [A checklist for a solid characterization suite](#a-checklist-for-a-solid-characterization-suite)
- [Mini Glossary](#mini-glossary)
- [Review questions](#review-questions)

---

## The algorithm, stated precisely

At the junior level you met the four-step recipe. Now we make it rigorous, because the details are where the value lives.

```
WHILE there are behaviors near my change that are not yet pinned:
    1. Pick an input that exercises an UNCOVERED code path.
    2. Write an assertion with a value you KNOW is wrong (a sentinel).
    3. Run. The failure message reveals the ACTUAL output O.
    4. Replace the sentinel with O. Run again → green.
    5. Read the assertion back. Ask: "Does this surprise me?"
         - If yes, you just learned something about the system. Note it.
    6. Mark that path covered (mentally, or via a coverage tool).
```

Two refinements over the junior version matter.

First, **step 5 is not optional.** A characterization test is a *learning instrument*. When the runner reveals that `discount(0)` returns `null` instead of `0.0`, that surprise is signal: there is an edge case the original authors handled (or failed to handle) in a way you would not have guessed. Pause and record it. The tests you write are valuable; the *understanding* you gain writing them is often more valuable.

Second, **the loop is driven by code paths, not by random inputs.** You are not trying to test "everything." You are trying to pin the behavior **near the change you are about to make**, plus enough surrounding behavior that you would notice collateral damage. This is the discipline from the [legacy change algorithm](../02-the-legacy-change-algorithm/): identify change points, find the inflection of effects, then cover that region.

> **Key idea:** Characterization is goal-directed. You pin the behavior you are about to put at risk — not the whole universe of the codebase.

---

## Worked iteration: characterizing an invoice calculator

Let us characterize a gnarlier function in Java, showing the real iterate-and-paste loop rather than a finished suite.

```java
// LegacyInvoice.java — no tests, about to be modified
public class LegacyInvoice {
    public String summarize(int qty, double unitPrice, String customerType) {
        double subtotal = qty * unitPrice;
        double discount = 0;
        if ("VIP".equals(customerType)) {
            discount = subtotal > 100 ? 0.20 : 0.10;
        } else if ("MEMBER".equals(customerType)) {
            discount = 0.05;
        }
        double total = subtotal * (1 - discount);
        double tax = total * 0.08;
        return String.format("subtotal=%.2f discount=%.0f%% total=%.2f tax=%.2f",
                             subtotal, discount * 100, total, tax);
    }
}
```

**Iteration 1.** Pick the simplest path — a non-VIP, non-member. Assert garbage:

```java
@Test
void characterizeRegularCustomer() {
    assertEquals("WRONG", new LegacyInvoice().summarize(2, 30.0, "REGULAR"));
}
```

Run. JUnit reports:

```
org.opentest4j.AssertionFailedError:
expected: <WRONG>
 but was: <subtotal=60.00 discount=0% total=60.00 tax=4.80>
```

Paste the truth:

```java
@Test
void characterizeRegularCustomer() {
    assertEquals("subtotal=60.00 discount=0% total=60.00 tax=4.80",
                 new LegacyInvoice().summarize(2, 30.0, "REGULAR"));
}
```

**Iteration 2 — the VIP-over-100 branch.** This is the path our upcoming change will touch, so it matters most.

```java
@Test
void characterizeVipAboveThreshold() {
    assertEquals("WRONG", new LegacyInvoice().summarize(5, 30.0, "VIP"));
}
// run → but was: <subtotal=150.00 discount=20% total=120.00 tax=9.60>
```

Paste it in. **Iteration 3 — the VIP-at-or-below-threshold branch**, to nail down where the threshold actually flips:

```java
@Test
void characterizeVipAtThreshold() {
    // subtotal exactly 100 — is the 20% boundary inclusive or exclusive?
    assertEquals("WRONG", new LegacyInvoice().summarize(4, 25.0, "VIP"));
}
// run → but was: <subtotal=100.00 discount=10% total=90.00 tax=7.20>
```

**Surprise (step 5).** The code uses `subtotal > 100`, so at *exactly* 100 you get the **10%** tier, not 20%. If you had written this test by reading the spec ("VIP gets 20% on large orders"), you would have written the wrong expected value. The runner saved you. We note: *boundary is exclusive at 100.* That note is gold when we later change the discount logic.

The final pinned suite:

```java
class LegacyInvoiceTest {
    private final LegacyInvoice inv = new LegacyInvoice();

    @Test void regular()       { assertEquals("subtotal=60.00 discount=0% total=60.00 tax=4.80",  inv.summarize(2, 30.0, "REGULAR")); }
    @Test void member()        { assertEquals("subtotal=60.00 discount=5% total=57.00 tax=4.56",  inv.summarize(2, 30.0, "MEMBER")); }
    @Test void vipAbove100()   { assertEquals("subtotal=150.00 discount=20% total=120.00 tax=9.60", inv.summarize(5, 30.0, "VIP")); }
    @Test void vipAt100()      { assertEquals("subtotal=100.00 discount=10% total=90.00 tax=7.20",  inv.summarize(4, 25.0, "VIP")); }
    @Test void unknownType()   { assertEquals("subtotal=60.00 discount=0% total=60.00 tax=4.80",  inv.summarize(2, 30.0, "GHOST")); }
}
```

Five tests, five branches, the boundary behavior nailed down. We can now change `summarize` with confidence.

---

## Choosing inputs: covering paths, not values

The skill that separates a beginner's characterization suite from a competent one is **input selection**. You are not trying to enumerate every value; you are trying to hit every *behavior*. Useful heuristics:

- **One input per branch.** Each `if`/`else`/`case`/early-return is a behavior. Aim for at least one input that lands in each.
- **Boundaries.** Wherever the code compares (`>`, `>=`, `==`, length checks), put inputs *just below*, *at*, and *just above* the boundary. This is where the "surprises" cluster (the `> 100` example above).
- **Degenerate inputs.** Empty string, empty list, `null`, zero, negative numbers. Legacy code often handles these in surprising ways — sometimes by throwing, sometimes by silently returning a weird value. Pin whatever it actually does.
- **A coverage tool as a guide.** Run the suite under JaCoCo / coverage.py / Istanbul and look at which lines are still red. Each uncovered line is a path you have not photographed yet. Coverage is the *map*; it tells you where the unphotographed regions are.

> **Key idea:** Line coverage is not the goal — it is a *checklist of unphotographed regions*. 100% coverage of a characterization suite means "I have a photo of every line's behavior," which is exactly the safety net you want before refactoring.

---

## Golden Master / Approval Testing

The recipe so far produces one assertion per input. That is fine for a five-branch function. But what about a report generator that produces 2,000 lines of output, or a function that returns a deeply nested object? Hand-pasting that into an `assertEquals` is absurd.

This is where **Golden Master** testing (also called **Approval Testing** or **Snapshot Testing**) comes in. The idea:

1. Run the code, capture its **entire output** (a big string, a file, a serialized object, an HTML page).
2. Save that output to disk as the **approved baseline** — the "golden master."
3. On every future run, generate fresh output and **diff it against the approved file**.
4. If they match, the test passes. If they differ, the test fails and shows you the diff so a human can decide: *is this change intended (approve the new version) or a regression (fix the code)?*

```
   First run (no baseline yet)
   ┌──────────┐   produce    ┌───────────────┐  save   ┌────────────────┐
   │  Code    │ ───────────▶ │  received.txt │ ──────▶ │  approved.txt  │
   └──────────┘              └───────────────┘ (human  └────────────────┘
                                                approves)

   Every later run
   ┌──────────┐   produce    ┌───────────────┐  diff   ┌────────────────┐
   │  Code    │ ───────────▶ │  received.txt │ ◀─────▶ │  approved.txt  │
   └──────────┘              └───────────────┘         └────────────────┘
                                       │
                            match → PASS │ differ → FAIL (show diff)
```

A characterization test *is* a tiny golden master where the "master" is a single value pasted into an assertion. Approval testing just scales the same idea to large outputs. Here it is with Python's `pytest` and the lightweight pattern by hand (tooling covered in [professional.md](./professional.md)):

```python
# A by-hand golden master, to show the mechanics
from pathlib import Path
from report import generate_monthly_report

APPROVED = Path(__file__).parent / "approved" / "monthly_report.txt"

def test_monthly_report_golden_master():
    received = generate_monthly_report(month="2026-05", seed_data=load_fixture())

    if not APPROVED.exists():
        # First run: write the baseline, then fail loudly so a human reviews it
        APPROVED.parent.mkdir(exist_ok=True)
        APPROVED.write_text(received)
        raise AssertionError(
            f"No approved master. Wrote one to {APPROVED}. "
            "REVIEW it by eye, then re-run to lock it in."
        )

    assert received == APPROVED.read_text()
```

The crucial human step is *approving the first baseline by eye*. The golden master is only as trustworthy as your initial review of it. A garbage baseline that you blindly approve gives you a test that faithfully guards garbage.

> **Key idea:** Approval testing inverts where the expected value lives — instead of in code, it lives in a checked-in file. The test asks one question: *did the output change?* A human, not the test, decides whether a change is acceptable.

---

## Combinatorial input generation

A golden master over a *single* input only photographs one path. To characterize a complex function broadly, you drive it with **many** generated inputs and capture all the outputs into one master file. Feathers' classic example: generate thousands of input combinations, feed them through the legacy function, and record every result.

```python
import itertools

def test_characterize_pricing_grid():
    quantities   = [0, 1, 2, 10, 11, 100]
    prices       = [0.0, 0.01, 9.99, 1000.0]
    customers    = ["REGULAR", "MEMBER", "VIP", "GHOST"]

    lines = []
    for q, p, c in itertools.product(quantities, prices, customers):
        out = LegacyInvoice().summarize(q, p, c)   # actual current behavior
        lines.append(f"({q}, {p}, {c}) -> {out}")

    received = "\n".join(lines)
    verify_against_approved(received, "pricing_grid.txt")  # golden master
```

`itertools.product` here yields `6 × 4 × 4 = 96` combinations in one master file. With well-chosen value sets (especially boundary values), a few dozen lines of generation can exercise far more behavior than you could ever hand-write as separate `assertEquals` calls. The output file becomes a dense, human-readable photograph of the function across its whole input grid.

The art is in choosing the value sets so that the cross-product hits the interesting paths without exploding. Six quantities × four prices × four types is manageable; six × twenty × twenty would be 2,400 lines and start to lose its value as a reviewable artifact. We discuss this combinatorial-explosion risk in [senior.md](./senior.md).

---

## Handling messy output

Real legacy output is rarely clean. It contains values that change every run for reasons that have nothing to do with the behavior you care about — timestamps, generated IDs, memory addresses, absolute file paths, map/dict ordering, floating-point jitter. If you golden-master raw output, the test fails on *every* run for the wrong reasons. The cure is **scrubbing** (also called *normalizing* or *sanitizing*): deterministically replace volatile substrings before comparison.

```python
import re

def scrub(text: str) -> str:
    # ISO timestamps -> placeholder
    text = re.sub(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", "<TIMESTAMP>", text)
    # UUIDs -> placeholder
    text = re.sub(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
                  "<UUID>", text)
    # absolute home paths -> placeholder
    text = re.sub(r"/Users/[^/ ]+", "<HOME>", text)
    return text

def test_report_golden_master():
    received = scrub(generate_monthly_report("2026-05"))
    verify_against_approved(received, "monthly_report.txt")
```

| Source of noise | Symptom | Fix |
|---|---|---|
| `now()` / timestamps | Diff on every run | Scrub to `<TIMESTAMP>`, or inject a fixed clock (see below) |
| UUIDs / generated IDs | New value each run | Scrub to `<ID>`, or inject a deterministic ID generator |
| Hash-map ordering | Lines reorder randomly | Sort before serializing |
| Floating point | `0.30000000000004` jitter | Round / format to fixed precision |
| Absolute paths | Differs per machine/CI | Scrub to a relative placeholder |

Scrubbing has a sharp edge: scrub too aggressively and you blind the test to *real* changes (if you replace every number with `<N>`, you can no longer detect a wrong total). Scrub the *narrowest* thing that is genuinely non-deterministic, and prefer **making the input deterministic** over scrubbing the output, which is the next section.

---

## Sensing behavior through seams

Some behavior you want to characterize is not visible in a return value. The function writes to a database, sends an email, calls a payment gateway, reads the wall clock. To photograph that behavior you need a **seam**: a place where you can sense or replace what the code does without editing the code in the middle.

This is the heart of [03-seams-and-enabling-points](../03-seams-and-enabling-points/) and the techniques in [05-dependency-breaking-techniques](../05-dependency-breaking-techniques/), so we will not duplicate them — but the connection is essential: *characterization tests are the reason you go looking for seams in the first place.* You introduce a seam so the legacy code becomes observable, then you characterize through it.

A quick illustration. Suppose the function notifies a gateway. We pass a *sensing* fake at a seam and characterize *which calls happen*, not a return value:

```python
class RecordingGateway:
    def __init__(self): self.calls = []
    def charge(self, amount, currency): self.calls.append(("charge", amount, currency))

def test_characterize_checkout_side_effects():
    gw = RecordingGateway()
    checkout(cart=sample_cart(), gateway=gw)   # gateway injected at a seam

    # assert wrong, then paste what the runner reveals the calls actually are
    assert gw.calls == [("charge", 42.00, "USD")]
```

We photograph the *interaction* (a charge of 42.00 USD), not a value. Same recipe — assert wrong, read the reveal, paste — but the thing we pin is a recorded side effect surfaced through a seam.

---

## Characterization vs TDD, made concrete

These two practices both produce tests, run on the same frameworks, and look superficially alike. They are opposites in *direction* and *intent*.

| | TDD (Test-Driven Development) | Characterization testing |
|---|---|---|
| Code exists yet? | **No** — test comes first | **Yes** — code already exists |
| What drives the expected value? | The behavior you *want* (the spec in your head) | The behavior the code *has* |
| Red→green means | "I implemented the spec" | "I captured current behavior" |
| Catches bugs? | Yes — drives correct code into existence | No — may *enshrine* existing bugs |
| Direction of authority | Test commands the code | Code informs the test |
| Typical home | Greenfield, new features | Brownfield, legacy under change |

A clean way to remember it: **TDD writes the spec then makes the code obey. Characterization reads the code then makes the test agree.** They meet in the middle of the [legacy change algorithm](../02-the-legacy-change-algorithm/): you *characterize* the old behavior to get a net, then you can *TDD* the new behavior you are adding. See the [craftsmanship-disciplines](../../craftsmanship-disciplines/) material for TDD in depth.

> **Key idea:** TDD is a design tool for behavior that does not exist yet. Characterization is an archaeology tool for behavior that already exists. Using one where the other belongs is a category error.

---

## A checklist for a solid characterization suite

- [ ] Every branch near the change has at least one pinned input.
- [ ] Boundary values (just below / at / just above each comparison) are pinned.
- [ ] Degenerate inputs (empty, null, zero, negative) are pinned to whatever the code *actually* does.
- [ ] Surprising outputs are noted with a comment explaining the surprise.
- [ ] Known-buggy behavior is pinned **on purpose**, with a comment saying so.
- [ ] Large outputs use a golden master, with the first baseline reviewed by a human.
- [ ] Non-deterministic noise is scrubbed (narrowly) or eliminated by injecting a fixed clock/RNG at a seam.
- [ ] Test names say *what situation* is characterized, e.g. `characterizeVipAtThreshold`.
- [ ] A coverage run shows no surprising red regions in the area you are about to change.

---

## Mini Glossary

- **Golden Master** — A captured, approved baseline of a program's full output, diffed against on every later run. Also *approval test* or *snapshot*.
- **Received / Approved files** — The fresh output vs. the human-approved baseline in approval testing. Mismatch = test failure.
- **Scrubbing (normalizing)** — Deterministically replacing volatile substrings (timestamps, IDs) before comparison so the test only reacts to meaningful changes.
- **Combinatorial input generation** — Driving a function with the cross-product of chosen value sets to broadly photograph behavior in one master file.
- **Seam** — A place where behavior can be sensed or replaced without editing the code there. See [03-seams-and-enabling-points](../03-seams-and-enabling-points/).
- **Sensing** — Using a recording fake/spy at a seam to observe side effects (calls, writes) rather than return values.
- **Path coverage (as a guide)** — Using a coverage tool to find lines whose behavior is not yet photographed.

---

## Review questions

1. Walk through the five-step loop on a function of your choice. What does step 5 ("does this surprise me?") add over the basic junior recipe?
2. The VIP example revealed the discount boundary was `> 100` (exclusive). How would a coverage tool plus boundary-value selection have led you to discover that?
3. When would you reach for a golden master instead of individual `assertEquals` calls? Give two characteristics of the output that push you toward approval testing.
4. Your golden master fails on every CI run because the report includes `Generated at 2026-05-01T13:02:55`. Give two different fixes and say which is better and why.
5. Explain the difference between *scrubbing* output and *injecting* a fixed clock at a seam. Why is injection often preferable?
6. A colleague says characterization testing is "just TDD for legacy code." Correct them precisely, naming at least three concrete differences.
