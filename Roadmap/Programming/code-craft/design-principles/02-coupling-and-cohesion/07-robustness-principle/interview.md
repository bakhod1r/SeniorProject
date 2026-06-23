# Robustness Principle — Interview Questions

> **Category:** [Coupling & Cohesion](../../README.md) — Jon Postel's interoperability rule: be conservative in what you send, be liberal in what you accept.

Conceptual and coding questions, graded junior → professional, plus trick and behavioral questions. The defining signal here is whether you can present **both** the principle and its modern critique honestly.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Coding Tasks](#coding-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. State the Robustness Principle. Who wrote it, and where?

**Answer:** "Be conservative in what you do [send], be liberal in what you accept from others." Jon Postel wrote it into the TCP/IP specs — RFC 760 (IP, 1980) and canonically RFC 793 (TCP, 1981). It's also called **Postel's Law**.

### J2. Which half applies to sending, which to receiving?

**Answer:** **Conservative/strict** applies to **sending** — emit only perfectly spec-correct output. **Liberal/tolerant** applies to **receiving** — accept minor deviations rather than rejecting input outright.

### J3. Why is it asymmetric?

**Answer:** You *control* your own output, so you can guarantee it's perfect; you *don't control* others' output, so forgiving their slips keeps communication working. Tolerance is for the part you can't control.

### J4. What problem was it created to solve?

**Answer:** **Interoperability** on the early internet — independently-built implementations (different teams, no shared test suite) inevitably disagreed on tiny details. If each forgives the other's quirks, the network keeps working despite imperfect, uncoordinated implementations.

### J5. Give two everyday examples of liberal acceptance.

**Answer:** (Any two) Browsers rendering malformed HTML; email/SMTP servers accepting slightly-off messages; lenient JSON parsers (trailing commas) and date parsers (multiple formats); HTTP tolerating header-casing and whitespace differences.

### J6. Are both halves of the principle equally good advice?

**Answer:** No. **"Conservative in what you send" is almost universally good** — keep it always. **"Liberal in what you accept" is controversial** — sometimes helpful (forward-compatibility), often harmful (ambiguity, security, spec erosion). They are not symmetric.

### J7. What's the difference between an *unknown-but-additive* field and *malformed* input?

**Answer:** An additive field is *extra* data you don't recognise but that doesn't break the data you use — usually safe to ignore (forward-compatibility). Malformed input *violates the spec* (broken syntax, ambiguity) — tolerating it means *guessing*, which is dangerous.

---

## Middle Questions

### M1. Why does this principle belong in a *coupling* chapter?

**Answer:** Because leniency creates **hidden coupling**. Every deviation you tolerate becomes an *undocumented* dependency — senders start relying on your acceptance of it, so tightening your parser later breaks them. The de-facto contract becomes "whatever your parser accepts," written in no spec. Strictness keeps the contract explicit and the coupling visible and minimal.

### M2. What is the Tolerant Reader pattern? What is it strict about?

**Answer:** A receiver that reads only the fields it needs and **ignores unknown/extra fields**, so *additive* changes don't break it. It's liberal about *unknown* fields but **strict about the known fields it actually uses** (validating their type/format/presence). It's the *safe* face of "be liberal" — it never guesses.

### M3. Explain a parser-differential bug.

**Answer:** Two components are both lenient but parse the same input *differently*, so they silently disagree about its meaning (e.g., front-end reads `"1,000"` as 1000, back-end as 1). Neither errors — the disagreement is silent — so wrong data propagates with no alarm. The fix is one shared *strict* definition that rejects the ambiguous form identically on both sides.

### M4. Where should strict validation live, and why not everywhere?

**Answer:** At **trust boundaries** (HTTP edge, queue consumers, file/API importers) — validate strictly *once*, then trust the data internally so the core stays simple. Validating at every layer adds redundant complexity; concentrating it at the edge is where untrusted data actually enters.

### M5. Give the one test that decides if tolerating input is safe.

**Answer:** **Does tolerating it require *guessing* a meaning?** No (it's just extra/unknown data, or a clearly-equivalent canonical form) → safe. Yes (the input is ambiguous or malformed) → dangerous; reject it.

### M6. How do you get Postel's *goal* without lenient parsing?

**Answer:** **Schemas + explicit versioning + tolerant readers.** Schemas make the contract explicit (no guessing); versioning makes breaking changes explicit (no silent drift); tolerant readers let additive changes pass without a version bump. Same goal — graceful independent evolution — via a safer mechanism.

---

## Senior Questions

### S1. Make the case that Postel's Law is harmful. Who made it?

**Answer:** The critique targets the *second half* (liberal input). **Eric Allman** (author of sendmail) wrote *"The Robustness Principle Reconsidered"*: liberal acceptance defers and amplifies problems — buggy senders ship because their bugs "work," the leniency spreads, and it can never be removed without breaking accumulated dependents. **Martin Thomson** wrote the IETF draft *"The Harmful Consequences of Postel's Robustness Principle"*: liberal acceptance causes **protocol ossification** and the only sustainable cure is for implementations to be **strict, even actively intolerant** of deviations, so the written spec stays the truth.

### S2. What is protocol ossification, and why is it counterintuitive?

**Answer:** Ossification is when a protocol becomes effectively unchangeable because deployed components have hardened around its exact observed behaviour. It's counterintuitive because *tolerance, meant to keep things flexible, is what freezes them*: tolerated deviations propagate, new implementations must accept them too, and the de-facto spec = spec + every accumulated quirk. **TLS 1.3 had to masquerade as TLS 1.2** to traverse ossified middleboxes; **QUIC encrypts its transport headers** specifically so middleboxes can't observe and ossify around them. Leniency *spends* flexibility rather than preserving it.

### S3. Why are parser differentials a *security* problem, not just a correctness one?

**Answer:** When two components on a request path both parse liberally but *differently*, an attacker can craft one message they read differently — smuggling intent past the component meant to police it. **HTTP request smuggling** exploits front-end/back-end disagreement on request framing (conflicting `Content-Length`/`Transfer-Encoding`); WAF/app parser gaps enable filter-bypass. The security rule: **at a trust boundary, be *strict*** — reject ambiguous framing, duplicate/conflicting headers, anything with more than one valid interpretation. Liberal acceptance of ambiguity literally *is* an attack surface.

### S4. HTML is the famous *success* of liberal acceptance. What did HTML5 actually do?

**Answer:** For years "tolerate bad HTML" was *implicit* and each browser's error-recovery *differed* — causing parser differentials and a de-facto spec of "whatever the leading browser does with garbage." HTML5 didn't stop being lenient; it **specified the leniency precisely** — a single deterministic error-recovery algorithm so every browser produces the *same* DOM from the same malformed input. The lesson: **leniency is only safe when it's specified and identical across implementations, not improvised.** Specified tolerance is just a more complete spec.

### S5. Frame the whole debate in coupling terms.

**Answer:** Strict acceptance makes the coupling **explicit** — both sides are connascent only on the *documented* format (visible, bounded, manageable). Liberal acceptance adds **implicit** coupling: each tolerated quirk is an *invisible, unbounded, non-local* dependency between your parser internals and whoever relies on the quirk. Postel's Law trades visible/bounded/documented coupling for invisible/unbounded/undocumented coupling — a bad trade for anything maintained for years. The early internet made it because coordinated strictness across uncoordinated parties was impossible then; we have schemas/versioning/contracts now and don't have to.

### S6. State a defensible modern synthesis.

**Answer:** (1) **Conservative in what you send — always.** (2) **Strict in what you accept at trust boundaries** — reject malformed and *ambiguous* input loudly; treat multiple interpretations of one message as a defect/vulnerability. (3) **Tolerant only of unknown-but-additive** extension (the tolerant reader) — the one form of "liberal" worth keeping, because it never guesses. (4) **Evolve via explicit versioning**, not implicit tolerance. (5) **If leniency is unavoidable, specify it** (HTML5-style, identical everywhere). Keeps the interoperability, sheds the ossification/security/erosion costs.

---

## Professional Questions

### P1. How do you review a change for the Robustness Principle?

**Answer:** Identify the trust boundary and ensure strictness lives there once; reject ambiguous input (parser-differential risk); confirm the leniency is *additive* (ignore unknowns), not *interpretive* (guessing malformed knowns); confirm output is strictly canonical; ensure any tolerance is documented, specified, and instrumented. Highest-value question: **"If we tighten this parser in six months, who breaks — and do we even know who they are?"** If you can't know, the leniency is invisible coupling — refuse it now.

### P2. What replaces "be liberal so we don't break each other" in production?

**Answer:** **Contract testing**, especially **consumer-driven contracts** (e.g., Pact). Each consumer publishes the subset of the response it depends on (its tolerant-reader subset); the provider runs all consumer contracts in CI and knows exactly which fields are load-bearing before changing anything. This delivers Postel's *goal* — independent evolution without breakage — by making the coupling explicit and *tested* rather than implicit and tolerated.

### P3. How do schema changes map to the additive/breaking distinction?

**Answer:** **Additive** (add an optional field) rides the tolerant reader — ship without a version bump or coordination. **Breaking** (remove/rename a field, tighten a type, change a field's *meaning*) requires an **explicit new version** and a deprecation window — never smuggled in behind parser leniency. The worst case is changing a field's *meaning* under the same name: no schema diff catches it. Use expand/contract migrations for the data-layer equivalent.

### P4. You have a leniency in production that unknown clients now depend on. How do you remove it?

**Answer:** You can't just tighten — that's an outage. Procedure: **instrument** the lenient path (log caller identity) → **quantify** real dependents → **announce** the canonical form + cutoff → **accept-but-warn** window (deprecation header / logged warning) → **migrate** heavy users directly → **tighten** to strict reject with a clear error naming the canonical form. The instrumentation step makes the invisible coupling visible enough to dismantle. This is Allman's warning lived forward: leniency is cheap to add, expensive to remove.

### P5. A teammate ships a parser so strict it rejects a partner's valid messages and breaks a live integration. What went wrong?

**Answer:** Strictness was applied beyond the *spec* — rejecting forms the spec actually permits (extra whitespace, an uncommon-but-legal encoding) because they didn't match the author's narrower assumptions. **"Be strict" means strictly conformant to the *real* spec, not strictly matching your mental model.** Fix: validate against the actual spec, add the legitimate forms to conformance tests. Strictness is a discipline about the spec, not a license to reject the unfamiliar.

---

## Coding Tasks

### C1. Turn a lenient, differential-prone parser into a strict-but-forward-compatible one (Python).

**Before** — liberal in a dangerous way (ambiguous, guessing):

```python
def parse_amount(raw: str) -> float:
    import re
    m = re.search(r"\d+", raw)      # "1,000" -> 1 ; "$30 each" -> 30
    return float(m.group()) if m else 0.0
```

**After** — strict on the value, still tolerant of unknown surrounding fields:

```python
import re
AMOUNT_RE = re.compile(r"^\d+(\.\d{2})?$")

def read_payment(payload: dict) -> dict:
    raw = payload.get("amount")
    if not isinstance(raw, str) or not AMOUNT_RE.fullmatch(raw):
        raise ValueError(f"amount must match NNN[.NN], got {raw!r}")
    # Unknown EXTRA keys in payload are ignored → additive evolution still works.
    return {"amount": float(raw)}
```

State it: the ambiguous form is now *rejected identically* everywhere (no parser differential), while the payload can still grow new fields.

### C2. Implement a Tolerant Reader (TypeScript).

```typescript
// Liberal about UNKNOWN fields, STRICT about the known ones it consumes.
function readUser(p: Record<string, unknown>): { id: number; email: string } {
  const id = p["id"];
  const email = p["email"];
  if (typeof id !== "number" || !Number.isInteger(id))
    throw new Error("id must be an integer");          // strict on known field
  if (typeof email !== "string" || !email.includes("@"))
    throw new Error("email is malformed");             // strict on known field
  // p may contain a new `preferences` block tomorrow — we just don't read it.
  return { id, email };                                // forward-compatible
}
```

### C3. Show conservative output (Java).

```java
// Never emit a lenient form "because others accept it" — emit ONE canonical form.
String formatDate(LocalDate d) {
    return d.format(DateTimeFormatter.ISO_LOCAL_DATE);  // always "YYYY-MM-DD"
}
// Not "2026/6/1", not "June 1, 2026" — readers shouldn't need to be lenient to read us.
```

### C4. Spot and fix the smuggling risk (pseudocode).

**Before:** the gateway and the app both accept a request carrying both `Content-Length` and `Transfer-Encoding`, resolving the conflict differently.

```text
gateway:  if Transfer-Encoding present -> use it ; else Content-Length
app:      if Content-Length present    -> use it ; else Transfer-Encoding
# An attacker sends BOTH → the two disagree on message boundaries → smuggling.
```

**After:**

```text
both tiers: if BOTH Content-Length and Transfer-Encoding present -> REJECT (400).
# One interpretation or none. No differential is possible.
```

---

## Trick Questions

### T1. "Postel's Law is timeless wisdom — always be liberal in what you accept." Agree?

**No — that's the contested half.** "Conservative in what you *send*" is timeless. "Liberal in what you *accept*" is heavily criticised (Allman, Thomson) for causing protocol ossification, security holes (request smuggling, parser differentials), and spec erosion. The modern boundary stance is the *opposite*: **be strict in what you accept.** Quoting the second half as settled wisdom signals you haven't met the critique.

### T2. "The Tolerant Reader proves liberal acceptance is good." Right?

**No — it proves the *narrow* version is good.** The tolerant reader is liberal about *one* thing only: **unknown/additive fields**, which it *ignores* (no guessing). It is strict about every field it actually uses. Generalising it into "tolerate malformed input too" reintroduces exactly the dangerous behaviour and just gives it a respectable name.

### T3. "HTML proves browsers should be lenient." So leniency won?

**Misleading.** HTML's leniency was a *problem* (divergent per-browser error recovery = parser differentials and a drifting de-facto spec) until **HTML5 specified the leniency precisely** — one deterministic recovery algorithm, identical across browsers. The win wasn't tolerance; it was making tolerance *specified and convergent* — effectively a stricter, more complete spec.

### T4. "Strict means reject anything I didn't expect." Correct?

**No.** Strict means **strictly conformant to the *real* spec** — accept everything the spec permits, reject everything it forbids. Rejecting valid-but-unfamiliar forms (legal whitespace, uncommon-but-legal encodings) is a *bug* that breaks legitimate peers, not strictness.

### T5. "Being lenient has no downside if it never errors." True?

**False, and that's exactly the danger.** Leniency's harm is *silent*: a wrong guess produces corrupt data or a security bypass with no error at all. The absence of an error is the bug — a strict reject would have been loud, early, and local; the lenient mis-guess is silent, late, and global.

### T6. "We're decoupled because our parser is forgiving." Sound?

**Backwards.** A forgiving parser *increases* coupling — invisible coupling, because every tolerated quirk becomes an undocumented dependency you can't see or safely remove. Strictness *decreases* coupling by keeping the contract explicit and minimal.

---

## Behavioral Questions

### B1. Tell me about a time leniency caused a production problem.

**Sample:** "An ingestion endpoint accepted dates in 'whatever the partner sent.' A partner switched to `MM-DD-YYYY`; our parser assumed `DD-MM-YYYY` and silently transposed day/month for every date ≤ 12. Months of reports were subtly wrong before reconciliation caught it. We moved to strict ISO-8601 at the boundary — reject anything else — and added a *contained, documented* normalisation shim only for the one legacy partner who couldn't change. The lesson I quote: ambiguity tolerated silently becomes data corruption."

### B2. Describe pushing back on 'just make it accept both formats.'

**Sample:** "A teammate wanted an endpoint to accept three amount formats 'so callers don't have to change.' I asked our standard question: 'if we tighten this in six months, who breaks, and will we even know?' We wouldn't — it'd be invisible coupling, and a parser-differential risk between our front-end and back-end. We accepted one canonical form, rejected the rest with a 400, and the callers normalised on their side. Strict-in kept the contract explicit."

### B3. How do you remove a leniency that clients already depend on?

**Sample:** "Carefully — you can't just tighten it. I instrument the lenient path to log who's using it, quantify the real dependents, announce a canonical form and cutoff, run an accept-but-warn window with a deprecation header, migrate the heavy users directly, then tighten to a hard reject with a clear error. The instrumentation is the key — it turns invisible coupling into a list of names I can actually migrate."

### B4. When did you choose leniency on purpose?

**Sample:** "Forward-compatibility via a tolerant reader. Our service reads upstream messages but only depends on three fields, so we ignore everything else. Upstream adds fields constantly; we never break and never coordinate a release for it. That's the *safe* leniency — ignoring unknowns, never guessing at malformed data — and I'm careful to keep it to exactly that."

### B5. How do you keep a multi-team API strict and evolvable over years?

**Sample:** "Make the safe path the default: strict schema validation at boundaries, conservative canonical output, tolerant readers as the only sanctioned leniency, additive-by-default schema policy with explicit versions for breaking changes, and consumer-driven contract tests in CI so breaking changes are caught before deploy. And instrument any leniency from day one, because the one we don't instrument is the one we can never remove."

---

## Tips for Answering

1. **Lead with both halves and their unequal status:** conservative-out is timeless; liberal-in is contested. Stating only the slogan signals junior.
2. **Name the critics and mechanisms:** Allman (*Reconsidered*), Thomson (*Harmful Consequences*); ossification, parser differentials/security, spec erosion.
3. **Nail the additive-vs-malformed distinction** — ignore unknown additive fields, reject malformed/ambiguous input; never guess.
4. **Cite ossification examples:** TLS 1.3 masquerading as 1.2; QUIC encrypting headers; HTML5 specifying the leniency.
5. **Frame it as coupling:** leniency = invisible/unbounded/undocumented coupling; strictness = explicit/bounded coupling.
6. **Give the synthesis:** strict-in at boundaries, conservative-out always, tolerant-reader for additive, version for breaking, specify any leniency.
7. **For production:** consumer-driven contracts + the instrument→deprecate procedure; "strict" means *conformant to the real spec*, not "reject the unfamiliar."

---

[← Professional](professional.md) · [Coupling & Cohesion](../../README.md) · [Design Principles](../../README.md) · [Roadmap](../../../README.md)
