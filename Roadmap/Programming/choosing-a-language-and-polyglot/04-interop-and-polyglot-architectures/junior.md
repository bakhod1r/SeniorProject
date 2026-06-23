# Interop & Polyglot Architectures — Junior

> **What?** *Polyglot* means a single system is built from more than one programming language. *Interop* is the set of techniques that let those languages — and the components written in them — actually talk to each other. A modern product is rarely one language; it's a Python data layer, a Go API, and a TypeScript frontend, all cooperating.
> **How?** The cheapest, most common way to make languages cooperate is to *not* make them share memory at all — you put each one behind a network boundary and let them exchange messages (usually JSON over HTTP). At that boundary, the language inside each box stops mattering. The cost is real but easy to miss: every language you add is another toolchain your team now owns forever.

---

## 1. What "polyglot" actually means

A **monoglot** system is written in one language: a Rails monolith is Ruby top to bottom; a Spring monolith is Java end to end. A **polyglot** system uses several. Almost every system you'll work on past a certain size is polyglot, often without anyone having decided it on purpose.

The simplest real example, the one you'll see everywhere:

```
[ Browser ]      TypeScript / React       (the UI must run in a browser → JS/TS)
     |  HTTPS, JSON
[ API server ]   Go                        (high-concurrency request handling)
     |  HTTP, JSON
[ ML service ]   Python                    (the entire ML stack lives in Python)
     |
[ Database ]     SQL                        (a query language, also "another language")
```

Three general-purpose languages, plus SQL, plus HTML/CSS, in one product. That's polyglot — and it's completely normal. Nobody sat down and said "let's use four languages to feel clever." Each box reached for the language that was *good at its job*, and the boxes were stitched together at the edges.

---

## 2. Why this happens: right tool for the job

The driving idea is **"the right tool for the job, per component."** Each part of a system has a different shape, and languages have different strengths (you saw this in [`01-language-selection-criteria`](../01-language-selection-criteria/)):

| The component | The natural language | Why |
|---|---|---|
| Browser frontend | TypeScript / JavaScript | The browser only runs JS natively |
| Machine-learning model | Python | PyTorch, TensorFlow, NumPy, pandas all live here |
| High-throughput API | Go, Java, C# | Built for concurrent network services |
| A systems / low-latency piece | Rust, C++ | No GC pauses, tight control over memory |
| Glue scripts, automation | Python, Bash | Fast to write, throwaway-friendly |

If you forced *one* language onto all of these, at least one component would be swimming upstream. Doing ML in Go means giving up the entire Python ecosystem. Doing the frontend in Python means... you can't, the browser won't run it. So polyglot isn't a mistake — it's frequently the *correct* outcome of letting each component pick what it's good at.

---

## 3. The simplest interop: the network boundary

Here's the key insight that makes polyglot survivable: **if two components talk over the network, they don't have to share a language.**

When your Go API needs something from your Python ML service, it doesn't *call a Python function*. It sends an HTTP request:

```
POST /predict HTTP/1.1
Host: ml-service.internal
Content-Type: application/json

{ "features": [0.4, 1.2, -0.7], "model": "fraud-v3" }
```

And the Python service answers with JSON:

```
HTTP/1.1 200 OK
Content-Type: application/json

{ "score": 0.91, "label": "fraud", "model": "fraud-v3" }
```

Go serialized a request into bytes; Python deserialized those bytes, did its work, and serialized a response back. **Neither language knows the other exists.** They agree only on the *shape of the messages* — the URL, the JSON fields, the meaning of `score`. That agreement is called a **contract** or **API**, and it's the only thing the two languages share.

This is why REST + JSON is the default first answer to "how do I make these two languages cooperate?" It's not the fastest, and it's not always right (you'll learn the alternatives in [`middle.md`](middle.md)), but it's the simplest, and it works across *every* language ever made. Any language can speak HTTP and parse JSON.

---

## 4. The boundary is where the language stops mattering

Picture a wall between each component. On one side is Python; on the other is Go. The wall has a single slot in it, and the only thing that passes through the slot is **data**, never code.

```
   Go side                wall                Python side
 ───────────             ┌────┐             ───────────────
  build request  ──────► │JSON│ ──────►  parse request
                         │slot│
  parse response ◄────── │    │ ◄──────  build response
                         └────┘
```

Because only data crosses, each side is free to be written in any language, use any framework, and be rewritten entirely — as long as it keeps sending and accepting the agreed-upon shape of data. This is the single most important property of network-boundary interop: **it decouples the languages from each other.** You can replace the whole Python service with a Rust one tomorrow, and the Go side won't even notice, as long as the new service answers `/predict` the same way.

This is also the difference between *interop* and just *using two languages*. Two languages that never talk aren't really interoperating; the interesting (and costly) part is the conversation across the boundary.

---

## 5. The first hidden cost: N toolchains

Now the catch. The moment your system is polyglot, your *team* is polyglot too — whether they wanted to be or not. Every language drags a whole world in behind it:

| You added a language. You also signed up for... |
|---|
| A second package manager (`pip`/`poetry` *and* `go mod` *and* `npm`) |
| A second build and test pipeline in CI |
| A second runtime to deploy, monitor, and patch for security |
| A second set of "how do we debug this when it's 2 a.m. and it's broken" |
| A second body of knowledge every on-call engineer must hold |
| A second hiring requirement when you grow the team |

A junior engineer sees three languages and thinks "cool, the best tool for each job." A senior engineer sees three languages and thinks "we now maintain three toolchains, three deployment stories, and three things that can break at 2 a.m." **Both are right.** The skill — which the higher levels of this topic are all about — is knowing when the *benefit* of the right tool outweighs this *tax*, and when you're just collecting languages.

For now, internalize the trade: every language you add buys you a capability and bills you a maintenance cost, forever. The capability is obvious on day one. The cost is invisible on day one and very visible on day 400.

---

## 6. A concrete picture of the tax

Say your startup is Go-only. Adding a Python ML service feels free — you needed ML, Python is where ML lives. But quietly:

- CI now needs a Python build job, a `requirements.txt`, and a way to cache `pip` installs.
- Your Docker base images double; someone has to patch CVEs in both.
- The Go engineers can't fully review the Python PRs, and vice versa.
- When the ML service is slow, the Go on-call engineer can't profile Python.
- A new hire who only knows Go can't be fully productive.

None of these is a disaster. Together they're the **polyglot tax** — a steady drag you pay in exchange for the capability. The ML service was almost certainly worth it (you *needed* the Python ecosystem). The question seniors learn to ask is whether the *next* language is worth it too, or whether you're paying the tax for something a language you already have could do well enough.

---

## 7. Common beginner misconceptions

**"More languages means more flexibility, so it's good."** More languages means more *capability* but less *coherence*. Flexibility has a price, and that price is paid by the team, not the code.

**"Polyglot means my code calls Python from Go directly."** Usually not. Most polyglot systems keep languages in *separate processes* talking over the network, precisely *because* it avoids the hard problem of making two languages share memory. Calling one language from another inside one process (called **FFI**) is possible but much sharper-edged — that's a [`middle.md`](middle.md) topic.

**"JSON is the only way."** JSON over HTTP is the simplest and most universal, but there are faster, more strongly-typed options (gRPC, message queues) — covered next.

**"If we just standardized on one language, all this would go away."** Sometimes true, sometimes a fantasy. You cannot run Python in a browser, and you cannot do serious ML in Go. Some polyglot is *forced* by physics and ecosystems, not chosen.

---

## 8. Quick rules

- [ ] Assume any real system is **polyglot** — count the languages, including SQL and the frontend.
- [ ] The default way to make two languages cooperate is a **network boundary** (REST + JSON), because it removes the need to share a language at all.
- [ ] At a network boundary, the only shared thing is the **contract** (the message shape), not the code.
- [ ] "Right tool per component" is a *real* benefit — but every language is **a toolchain your team owns forever.**
- [ ] Some polyglot is **forced** (browser → JS, ML → Python). Some is **chosen** — and chosen polyglot must justify its tax.
- [ ] When in doubt, prefer **fewer languages**; you can always add one when the benefit clearly beats the cost.

---

## 9. What's next

| Topic | File |
|---|---|
| The actual interop *mechanisms* — gRPC, message queues, FFI, shared schemas — and their tradeoffs | [`middle.md`](middle.md) |
| The deep costs: cross-language debugging, observability, the FFI vs network spectrum, runtime-level polyglot | [`senior.md`](senior.md) |
| Polyglot as an org decision: governance, platform teams, hiring, WASM | [`professional.md`](professional.md) |
| Interview questions on interop and polyglot | [`interview.md`](interview.md) |
| Design exercises: choose boundaries, design a contract, cost a new language | [`tasks.md`](tasks.md) |
| When to *introduce* a new language at all | [`../05-when-to-introduce-a-new-language/`](../05-when-to-introduce-a-new-language/) |

---

**Memorize this:** polyglot is normal and often correct — but languages don't cooperate for free. The cheapest way to make them cooperate is to keep them in separate processes talking over the network, where the only shared thing is the message shape. And every language you add is a permanent tax on your team's toolchains, debugging, hiring, and on-call — a tax that's invisible on day one and obvious on day four hundred.
