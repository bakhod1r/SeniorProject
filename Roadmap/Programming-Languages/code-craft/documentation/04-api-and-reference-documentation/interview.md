# API & Reference Documentation — Interview Questions

> **Category:** [Documentation](../README.md) — reference docs as a craft: the exhaustive, lookup-oriented description of an API's machinery, and the runnable examples and guides that make it usable.

Conceptual and applied questions, graded junior → professional, plus trick and behavioral questions.

---

## Table of Contents

1. [Junior Questions](#junior-questions)
2. [Middle Questions](#middle-questions)
3. [Senior Questions](#senior-questions)
4. [Professional Questions](#professional-questions)
5. [Applied Tasks](#applied-tasks)
6. [Trick Questions](#trick-questions)
7. [Behavioral Questions](#behavioral-questions)
8. [Tips for Answering](#tips-for-answering)

---

## Junior Questions

### J1. What is reference documentation, and how does it differ from a guide?

**Answer:** **Reference** is the exhaustive, information-oriented, lookup-structured description of the API's machinery — every endpoint/function with its parameters, types, errors. It answers "what exactly is this and how does it behave?" A **guide/tutorial** is task/learning-oriented, read in order, and answers "how do I accomplish X?" Reference is a dictionary; a guide is a recipe. Both come from the Diátaxis model.

### J2. What must a complete reference entry for an endpoint contain?

**Answer:** Name and purpose; **every** parameter with type, required/optional, default, and constraints; the return shape; **all** error codes and when they occur; auth; rate limits; idempotency; at least one runnable example (request *and* response); and versioning notes.

### J3. Why is "amount (integer)" a poor parameter description?

**Answer:** "integer" is just the *type* — the reader already gets that from the schema. It omits the *meaning*: the unit (cents? dollars?), the constraint (minimum?), and required-ness. A good description adds what the type can't say: "amount in the smallest currency unit (cents), required, minimum 50."

### J4. Why must an example show the response, not just the request?

**Answer:** The response *is* information — the return shape, field names, and types. Without it the reader still has to guess what success looks like. A runnable example is request *and* its real response.

### J5. What are the four pillars of great developer documentation?

**Answer:** (1) Getting started, (2) guides/how-tos, (3) reference, (4) SDKs + changelog. Shared traits of the best (Stripe/Twilio): consistency, runnable multi-language examples, a changelog, a status page.

### J6. Why isn't a complete reference enough on its own?

**Answer:** Reference is built for *lookup by people who already understand the shape of the problem.* A newcomer needs a guided path from zero to first success — a getting-started — and task recipes. Reference alone is a parts list with no instructions.

### J7. Why are errors a first-class part of reference docs?

**Answer:** Integrations spend much of their effort on the unhappy path. Undocumented errors are exactly where developers get stuck (and where they cause bad behavior, like not backing off on a `429`). Every error needs: status, code, when it fires, how to recover.

---

## Middle Questions

### M1. What does "single source of truth" mean for an API reference?

**Answer:** One authoritative artifact — a machine-readable spec (OpenAPI, GraphQL schema, `.proto`) — from which the reference docs, client SDKs, server stubs, and contract tests are all *generated*. Because the reference is a projection of the contract, it can't describe a field the contract doesn't have, so it can't drift.

### M2. Compare design-first and code-first.

**Answer:** **Design-first** writes the spec by hand first, reviews it, then generates stubs/docs and implements — the contract is agreed before code, best for public APIs. **Code-first** annotates the code and extracts the spec from it — the spec can't drift from code, best for internal fast-moving services. Design-first optimizes contract quality; code-first optimizes spec-code fidelity with low ceremony.

### M3. Name the source-of-truth artifact for REST, GraphQL, gRPC, and event-driven APIs.

**Answer:** REST → OpenAPI (Swagger); GraphQL → schema (SDL) + introspection; gRPC → `.proto`/protobuf; event-driven → AsyncAPI. Renderers (Swagger UI, Redoc, Stoplight, GraphiQL) turn them into reference.

### M4. Why does spec-driven reference "can't drift" still need contract tests?

**Answer:** Generation guarantees the *docs match the spec*. Contract tests guarantee the *running server matches the spec* — they catch a server that diverged from the contract, failing CI instead of a customer's integration. Generation + contract testing together is what makes "the docs are wrong" structurally hard.

### M5. Why can a generated reference be "complete but empty"?

**Answer:** Generation copies your `description` fields. It guarantees structure and non-drift (every field, correct types) but if the descriptions are blank, you get the field names and types with none of the *meaning* — units, valid values, when-to-use, deprecation. The shape is complete; the semantics are missing.

### M6. What two things must error documentation keep separate?

**Answer:** The **machine-stable error code** (clients branch on it; its wording must not change) and the **human-facing message** (may be reworded or localized). If you mix them, a copy edit to the message silently breaks client logic. Bonus: include a `doc_url` linking to the error's reference entry.

### M7. What is a recipe and where does it sit?

**Answer:** A short, task-focused, runnable sequence that composes several reference entries to accomplish one goal ("refund a partial payment"). It's the bridge between reference and tutorial — more goal/order-oriented than reference, more focused than a tutorial (it assumes you've started).

---

## Senior Questions

### S1. How do you decide what goes generated vs. hand-written?

**Answer:** Assign each layer to the source that minimizes *its* dominant risk. The exhaustive reference (risk = *wrongness*) goes generated-from-spec. Getting-started, recipes, and error *semantics* (risk = *unusability* / human knowledge) are hand-written and tested. Don't pick one approach for everything: generated-only is cold and unadopted; hand-written-only is warm and wrong within two releases.

### S2. Why is generated reference "complete but cold," and what do you do about it?

**Answer:** It lists every field and type but not which 3 you need first, what order to call things, or what good usage looks like — that knowledge isn't in the type system. It's the dictionary, not the textbook. The fix is *layering*: keep the reference complete and wrap it in a hand-written getting-started, recipes, and good IA. Don't make the reference less complete to make it usable.

### S3. How does reference interact with versioning?

**Answer:** The reference is versioned *with* the API — v1 docs describe v1, kept live as long as v1 is supported; you don't mutate the reference in place to always describe `HEAD`. Deprecations are reference content (`deprecated: true` / `@deprecated` with replacement + sunset date). Reference (what's true now), changelog (what changed), and release notes (what it means) form a triad.

### S4. How does the internal-vs-public distinction change reference decisions?

**Answer:** It's the one-way-door / reversibility argument. An internal endpoint is reversible — you can change it and chase down the known callers, so "enough to integrate," code-first, latest-only is fine. A public API is a one-way door — uncoordinated consumers built on the documented contract, so it justifies design-first, exhaustive coverage, strict multi-version reference, and tested multi-language examples. Mismatching either way is the error.

### S5. How do you keep examples correct at scale without them becoming a maintenance sink?

**Answer:** Automate. Generate the request from the spec; better, *extract the canonical example from a passing integration test* (snippet-from-tests) so it can't compile/run unless the test passed; or run examples as doc-tests in CI. The principle: an example you don't execute is one you'll eventually ship broken — and a broken example destroys trust faster than a missing one. Number of languages is an adoption-ROI decision; automate or cut.

### S6. In what sense is the spec a design tool, not just a doc?

**Answer:** Writing the spec design-first *before* implementation forces you to confront the contract — inconsistent naming, an endpoint returning three shapes, a missing error taxonomy — while it's cheap to change. A spec review is an API design review that produces reference as a byproduct. Documentation pain is a design smell: if you can't write a clean reference entry, the API is probably wrong. For a public API, the spec *is* the design.

---

## Professional Questions

### P1. What does a reference docs CI pipeline look like?

**Answer:** On every spec change: **lint** (Spectral/Buf — descriptions present, naming, errors declared) → **diff** for breaking changes (oasdiff/GraphQL Inspector — fail CI on a break) → **run examples / doc-tests** → **contract-test** the running server against the spec → **generate** the reference → **publish** versioned. Docs become a built artifact and a *merge gate*: an undocumented endpoint, broken example, or undeclared breaking change fails the build.

### P2. Tooling enforces structure — what does *review* enforce?

**Answer:** Meaning. The semantic gaps a linter can't see: does the description add what the type can't (units, enum meanings, side effects)? Are all errors documented with recovery? Is the example realistic and tested? Is a flagged change properly versioned/deprecated? Is it consistent with sibling endpoints? Highest-value question: "what does a caller need to know that the *type* doesn't already say?"

### P3. How do you govern reference consistency across many teams?

**Answer:** Encode the API style guide *as lint rules* in a shared ruleset every repo extends (so consistency is enforced, not hoped for); maintain a spec registry/catalog so APIs are discoverable; ship a golden-path template repo with the spec scaffold, lint, doc pipeline, and contract tests wired up so new services get governed reference for free. Encode the standard once, enforce in CI everywhere.

### P4. What metrics actually track reference quality?

**Answer:** Outcome metrics: **time-to-first-successful-call**, **support-tickets/forum-questions per endpoint**, contract-test pass rate, and broken-example/broken-link rate (should be zero). **Not** "% of endpoints documented" — a 100%-covered reference can be 100% type-echoes with no meaning or examples. The ground-truth question is "can a developer integrate without filing a ticket?"

### P5. How do you deprecate a published API endpoint properly?

**Answer:** Mark it in the reference first (`deprecated: true` / `@deprecated`) with the **replacement and a sunset date**; emit a runtime `Deprecation`/`Sunset` header so non-readers are warned (pointing at the reference); record it in the changelog; and never remove it until the deprecation window has elapsed. The reference is the contract — silent removal breaks consumers you can't see.

---

## Applied Tasks

### C1. Rewrite this poor endpoint doc into an excellent reference entry.

**Before:**

```
GET /users/{id} — returns a user. May fail.
```

**After:**

````markdown
## GET /v1/users/{id}
Retrieve a user by ID. Requires a bearer token.

| Path param | Type   | Required | Description           |
|------------|--------|----------|-----------------------|
| `id`       | string | yes      | User ID (`usr_…`).    |

**200 OK**
```json
{ "id": "usr_8f2a", "email": "ada@example.com", "status": "active" }
```
`status` — one of `active | suspended | deleted`.

**Errors:** `401 unauthorized` (bad/missing token) · `404 user_not_found` (no such id) · `429 rate_limited` (retry after `Retry-After`).

```bash
curl https://api.example.com/v1/users/usr_8f2a -H "Authorization: Bearer $API_KEY"
```
````

Point to make: every question (types, return shape, errors, auth, a runnable example) is answered on the page; "may fail" became a concrete error table.

### C2. Write an OpenAPI fragment for one endpoint with one error.

```yaml
paths:
  /v1/refunds:
    post:
      summary: Refund part or all of a charge.
      security: [{ bearerAuth: [] }]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [charge]
              properties:
                charge: { type: string, description: "ID of the charge to refund (ch_…)." }
                amount: { type: integer, minimum: 1,
                          description: "Amount in cents; omit to refund in full. Must be ≤ original." }
      responses:
        "200": { description: "Refund created.",
                 content: { application/json: { schema: { $ref: "#/components/schemas/Refund" } } } }
        "400": { description: "amount exceeds the refundable balance.",
                 content: { application/json: { schema: { $ref: "#/components/schemas/Error" } } } }
```

Point: `description` carries the *meaning* (cents, "≤ original", "omit to refund in full") the type alone can't.

### C3. Spot the bug in this reference and example.

```markdown
POST /v1/charges — create a charge.
Parameters: amount (number), currency.
Example: curl -d amount=20.00 -d currency=usd .../v1/charges
```

**Problems:** `amount` should be an **integer in cents** (the example `20.00` and type `number` invite the classic dollars-vs-cents bug); `currency` has no type or constraint; no required/optional flags; **no errors documented**; **no response shown**; auth missing. The fix is a typed, constrained, error-complete entry with a runnable request *and* response.

### C4. Given a GraphQL type with no descriptions, what's missing from the generated reference?

```graphql
type Account { id: ID!  balance: Int!  state: AccountState! }
```

**Answer:** Introspection makes the *structure* complete (fields, types, an enum `AccountState`), but the generated reference is **semantically empty**: no unit for `balance` (cents?), no meaning for each `AccountState` value, no note on what `state` transitions are valid. Add `"..."` descriptions in the schema — that's the prose layer the generated docs carry.

---

## Trick Questions

### T1. "We generated Swagger UI from our spec, so our API is fully documented." True?

**False.** Generated reference is *complete and non-drifting* but **cold** — it has no getting-started, no recipes, and possibly empty descriptions. Shipping it raw as "the docs" reproduces the "reference-as-tutorial" failure: a perfect parts list nobody can start with. Reference is a floor; wrap it in hand-written, tested guides.

### T2. "The docs match the code, so we can't have shipped a breaking change." Right?

**No.** The docs (and code) can *correctly document a breaking change*. Generation keeps docs in sync with the spec; it does **not** detect that the spec *itself* changed incompatibly. You need a breaking-change **diff** gate (oasdiff/Buf), not just generation.

### T3. "More documented endpoints = better docs. Aim for 100% coverage." Agree?

**Not as stated.** 100% coverage can be 100% type-echoes ("amount: the amount") with no meaning, no examples, and broken links. Coverage is a floor, not the goal. Measure the *outcome*: time-to-first-successful-call and tickets-per-endpoint.

### T4. "These two endpoints are documented identically, so let's merge them in the reference." Sound?

**Be careful.** If they're genuinely the same operation, fine. But identical-*looking* docs can hide different semantics (different auth, different idempotency, different error sets). Merging conflates them and loses the distinction — the documentation analog of merging coincidental code duplication. Document distinct behaviors distinctly.

### T5. "An example in the docs is just illustration — it's fine if it's slightly out of date." Correct?

**Dangerously wrong.** The example is the highest-trust content; it's the first thing a developer copies. A broken example fails *after* they've committed to your API, and it erodes trust faster than a missing one. Examples must be generated or tested so they can't drift.

### T6. "Internal APIs need the same reference rigor as public ones." True?

**No.** It's a reversibility question. Internal endpoints are reversible (you can change them and tell the known callers), so "enough to integrate," code-first, latest-only is rational. Public APIs are one-way doors — uncoordinated consumers — and justify the full rigor. Over-documenting internal APIs is gold-plating; under-documenting public ones is a support crisis.

---

## Behavioral Questions

### B1. Tell me about a time bad reference docs caused a real problem.

**Sample:** "Our payments reference listed `amount (integer)` with no unit. A big integrator read it, sent `50` meaning $50, and charged customers 50 cents — thousands of underbilled transactions. The type was documented; the *meaning* (smallest currency unit) wasn't. We added a lint rule rejecting descriptions that just echo the field name, made the worked example show `2000` → '$20.00', and I've insisted ever since that for money fields the unit is non-negotiable. The type is what the generator already knew; the unit is the human's job."

### B2. How do you keep API examples from going stale?

**Sample:** "I stop hand-maintaining them. We extract the canonical example for each endpoint from a passing integration test and inject it into the docs at build time, so an example literally can't exist unless its test passed. Broken examples now fail CI instead of failing our newest users. Before that, our quickstart used a removed constructor for a year and quietly drove away beginners — exactly the people we couldn't afford to lose."

### B3. A teammate wants to ship generated Swagger UI as the whole documentation. How do you respond?

**Sample:** "I'd agree it's a great *reference* — and say it's a floor, not the finished docs. Generated reference is the dictionary; nobody learns the API from it cold. I'd ask: where does a new developer go to make their first successful call? We need a getting-started and a few recipes on top. I'd frame it with our time-to-first-successful-call metric — if that's bad, the reference being complete doesn't matter."

### B4. How would you introduce reference quality gates to a team that has none?

**Sample:** "Start cheap and in CI: a spec linter requiring a description and declared errors on every operation, plus a breaking-change diff gate so we can't silently break consumers. Then make examples run in CI. I'd ship a golden-path template so new services get the pipeline for free, and report time-to-first-successful-call and tickets-per-endpoint to show the value — because docs are credited to no one and blamed on everyone, so the only durable fix is making them a merge gate, not a good intention."

---

## Tips for Answering

1. **Lead with reference-vs-guide** (Diátaxis): reference is exhaustive/information-oriented/looked-up; guides are task-oriented. Great docs need both plus a getting-started.
2. **Name the source-of-truth formats:** OpenAPI / GraphQL schema + introspection / `.proto` / AsyncAPI — and "generated docs can't drift, contract tests keep the server honest."
3. **Stress that generated reference is complete but cold** — it needs a hand-written, tested usability layer (the dictionary-vs-textbook framing).
4. **Treat errors and the unit/meaning of fields as first-class** — most real incidents live there.
5. **Tie internal-vs-public to reversibility / one-way doors** — it explains the differing rigor.
6. **For examples, say "test them or generate them; an untested example is a future break."**
7. **For metrics, prefer outcome (time-to-first-successful-call, tickets-per-endpoint) over coverage %.**

---

[← Professional](professional.md) · [Documentation](../README.md) · [Roadmap](../../README.md) · **Next:** [Architecture Decision Records](../05-architecture-decision-records-adrs/)
