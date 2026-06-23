# Audit Logging — Interview Questions

> **Topic:** [Audit Logging Roadmap](README.md)
> **Focus:** Questions an interviewer can actually ask about tamper-evident, compliance-grade "who did what, when, to which resource, with what outcome" records — schema, append-only stores, hash chains and signing, WORM, retention, the audit-vs-debug-log distinction, non-repudiation, and forensic query.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Conceptual / Foundational](#conceptual--foundational)
3. [Schema & Capture](#schema--capture)
4. [Integrity & Tamper-Evidence](#integrity--tamper-evidence)
5. [Compliance & Retention](#compliance--retention)
6. [Tricky / Trap Questions](#tricky--trap-questions)
7. [System / Design Scenarios](#system--design-scenarios)
8. [Live Coding / Whiteboard](#live-coding--whiteboard)
9. [Behavioral / Experience](#behavioral--experience)
10. [What I'd Ask a Candidate Now](#what-id-ask-a-candidate-now)
11. [Cheat Sheet](#cheat-sheet)
12. [Further Reading](#further-reading)
13. [Related Topics](#related-topics)

---

## Introduction

Audit-logging interviews split into two flavours. The first is "do you know the requirements" — can you name the five W's of an audit record, do you know what append-only actually buys you, can you tell SOC 2 from HIPAA from PCI DSS, do you know why a hash chain detects deletion. The second is "do you think like an auditor and an attacker at once" — given a record, can you prove it wasn't altered; given a system, can you find where an insider could erase their tracks; given a regulation, can you reconcile "immutable forever" with "erase this user on request." Senior and staff interviews lean hard on the second.

This file is the question bank. Trap questions also explain *why* the obvious instinct is wrong, because in audit logging the wrong instinct — "just log it to the same place as everything else," "trust the database admin," "we'll add integrity later" — is exactly the gap that surfaces during the one incident the audit log existed to survive. The behavioural section is for senior and staff roles where the interviewer wants stories with shape — a real compliance deadline, a real forensic investigation, a real conflict between immutability and privacy — not a standards recital.

A note on framing throughout: an **audit log is evidence**, not telemetry. That single distinction — evidence you may have to defend in a courtroom or a SOC 2 audit, versus telemetry you keep to debug — drives almost every correct answer below.

---

## Conceptual / Foundational

### Q: What is an audit log, and how is it different from an application/debug log?

An **audit log** is an append-only, tamper-evident record of security- and business-significant *actions*: who did what, to which resource, when, from where, with what outcome. Its purpose is accountability, non-repudiation, and forensic reconstruction. It is **evidence**.

An **application (debug/operational) log** is a stream of diagnostic events for engineers: stack traces, latencies, "entered function X," "cache miss." Its purpose is debugging and operations. It is **telemetry**.

The differences that matter in practice:

| Dimension | Audit log | App/debug log |
|---|---|---|
| Audience | Auditors, security, legal, forensics | Engineers, SREs |
| Mutability | Append-only, tamper-evident | Freely rotated, deleted, sampled |
| Sampling | **Never** sampled | Sampled aggressively under load |
| Retention | Years (1–7+, regime-driven) | Days to weeks |
| Schema | Stable, controlled vocabulary, versioned | Loose, changes freely |
| Content | Identity in; secrets/PII content out | The opposite PII rule often applies |
| Loss tolerance | A dropped event is a compliance gap | A dropped line is usually fine |

The single sentence: **debug logs help you fix the system; audit logs help you prove what the system did.** You can drop a debug line under load; dropping an audit event is a hole in your evidence.

**Follow-up — "Can't I just grep my app logs for security events instead of a separate audit log?"**
No, for three reasons. App logs are sampled and rotated, so the record you need may be gone. They're mutable — anyone with log access can edit or delete. And they have no integrity guarantee, so even if the line survives, you can't *prove* it wasn't altered. The whole point of an audit log is the properties app logs deliberately lack.

### Q: What are the five W's of an audit event? Give a concrete schema.

**Who** (actor), **what** (action), **which** (resource), **when** (timestamp), **outcome** (success/failure/denied) — plus **where** (source IP/service) as a practical sixth.

```json
{
  "schema_version": "1.0",
  "event":  { "id": "01J0Z9...ULID", "action": "customer.export",
              "category": "data_access", "outcome": "success",
              "time": "2026-06-11T14:02:09.471Z" },
  "actor":  { "type": "user", "id": "u_8821", "name": "alice@corp.com",
              "session_id": "sess_9f3a", "on_behalf_of": null },
  "resource": { "type": "customer", "id": "4471", "tenant_id": "t_acme" },
  "source": { "ip": "203.0.113.42", "service": "billing-api" },
  "correlation": { "request_id": "req_7af3c1",
                   "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736" },
  "metadata": { "row_count": 10421, "reason": "TICKET-882" }
}
```

The non-obvious fields that separate a junior answer from a strong one: `schema_version` (so old and new records are distinguishable forever), a unique `event.id` (dedup and exact reference), `event.category` (query "all data access" without enumerating every action), `tenant_id` (multi-tenant scoping is also an access-control boundary), and `correlation.*` (the join key to logs and traces).

**Follow-up — "Why a ULID for the event id rather than an auto-increment integer?"**
A ULID is globally unique without coordination (you can generate it on any node without a central sequence), and it's time-sortable, so records sort chronologically by id alone. An auto-increment requires a single writer or risks collisions across shards, and it leaks volume ("we did 4 million actions"). For an append-only store written from many services, you want decentralized, collision-free, sortable ids.

### Q: What does "append-only" mean, and how do you actually enforce it?

It means the store supports **insert but not update or delete** — once written, a record can't be changed. The trap is that "append-only" is a *property you enforce*, not a habit you hope for.

Levels of enforcement, weakest to strongest:

1. **Convention** — "we only call INSERT." Worthless; one bug or one malicious commit breaks it.
2. **Access control** — `REVOKE UPDATE, DELETE ON audit_events FROM app_role`. The application *cannot* modify rows even with a bug. This is the middle-level baseline.
3. **DB trigger** — a `BEFORE UPDATE/DELETE` trigger that raises an error, defending even against a privileged role's mistake.
4. **WORM storage** — S3 Object Lock / immutable buckets where the *storage layer* contractually refuses modification for a retention period. Defends against the DBA.
5. **Cryptographic tamper-evidence** — hash chains / signatures so that *even if someone modifies the bytes*, the alteration is detectable. This doesn't prevent change; it makes change *undeniable*.

The key distinction interviewers probe: access-control append-only stops the *application* from modifying records; cryptographic tamper-evidence detects modification *by anyone, including the DBA*. They are different guarantees and you usually want both.

**Follow-up — "Revoke UPDATE/DELETE — but a DBA with superuser can still drop the whole table. So what did you gain?"**
You raised the bar and you created an accountability boundary. The app role can't tamper, so an SQL-injection bug or an application compromise can't quietly rewrite history. A superuser still can — which is exactly why you add WORM (so the storage layer refuses even the superuser) and a hash chain (so deletion is *detectable* even if it happens). Defense in depth: access control handles the common case, WORM and hashing handle the privileged insider. No single layer is the whole answer.

### Q: What is non-repudiation, and what does audit logging need to achieve it?

Non-repudiation means an actor **cannot credibly deny** having performed an action. The audit log is the evidence that binds the action to the actor.

To actually achieve it (not just claim it) you need: **strong authentication** (so "alice" really was alice, not a shared account or a stolen session), **integrity** (the record can't have been altered after the fact — hash chain or signature), and ideally **a signature the actor or their session can't forge or that a third party can verify**. The weakest link is usually authentication: if ten people share an `admin` login, your beautifully signed audit log proves only that "someone with the admin password did it" — which repudiates nothing.

**Follow-up — "Where does cryptographic signing add non-repudiation over a plain hash chain?"**
A hash chain proves the *log as a whole* wasn't altered (integrity / tamper-evidence) but anyone who can append can extend the chain — it doesn't bind a record to a specific signer. **Signing** each record (or each checkpoint) with a key that only the audit system holds proves the record was produced *by that system* and not forged by someone with mere write access. Going further, signing with a *per-actor* key (rare, high-assurance systems) binds the action to the actor cryptographically. Most systems sign at the system/checkpoint level; per-actor signing shows up in financial and government contexts.

### Q: Why must audit events be exempt from sampling?

Because **sampling discards records**, and an audit log's value is completeness. If you sample 1-in-100, you've thrown away 99% of your evidence — and the one action that mattered (the breach, the unauthorized export) is almost certainly in the discarded 99%. Telemetry tolerates sampling because aggregate trends survive; audit doesn't, because you need *the specific event*, not a representative sample.

The trap this guards against: routing audit events through the same pipeline as app logs, where a sampler or a lossy buffer drops them under load. The fix is an explicit, never-sampled path — often a separate sink entirely, frequently with the outbox pattern so the event commits with the business change and can't be lost to backpressure.

**Follow-up — "We're at 50K audit events/sec and the cost is real. How do you reduce volume without sampling?"**
You reduce *what you audit*, not *whether you keep what you audit*. Audit security- and business-significant actions, not every read of every row. Coalesce where the regime allows (a bulk export is one event with `row_count`, not 10,000 events) — *unless* the regime requires per-record access logging (HIPAA can). Tier storage: hot store for recent/queryable, cheap cold WORM (S3 Glacier with Object Lock) for the long-retention tail. What you never do is randomly drop a fraction of qualifying events — that's sampling, and it makes the trail legally and operationally untrustworthy.

---

## Schema & Capture

### Q: Should you invent your own audit schema or adopt a standard? Which standards?

Adopt a standard's **field names** even if you keep your own internal model — it's nearly free now and saves a painful migration later. The main standards:

- **ECS (Elastic Common Schema)** — dotted fields (`event.action`, `event.outcome`, `user.name`, `source.ip`, `trace.id`). Use it if you ship to Elastic/OpenSearch or anything that speaks ECS.
- **OCSF (Open Cybersecurity Schema Framework)** — vendor-neutral, typed event *classes* (Authentication, Account Change, API Activity) with enumerated `activity_id`/`status_id`. Security-first orgs.
- **CloudEvents** — a CNCF spec for the event *envelope* (`id`, `source`, `type`, `time`, `subject`) wrapping a domain `data` payload. Use when events flow through a bus.
- **CEF / LEEF** — legacy line-based formats for old SIEMs (ArcSight, QRadar). Ingest-only; don't author new systems on them.

The pragmatic stance: author events in your own clean schema but name fields to match ECS or OCSF, so mapping to a SIEM later is a rename, not a redesign.

**Follow-up — "Doesn't CloudTrail / GCP Audit Logs / Azure Activity Log already give me an audit log for free?"**
Those audit the *cloud control plane* — who launched an EC2 instance, who changed an IAM policy. They do **not** audit your application's business actions ("alice deleted customer 4471"). You need both: the cloud provider's logs for infrastructure, your own for app-level acts. Assuming CloudTrail covers your application is a classic gap that surfaces during an audit when someone asks "who exported this customer's data" and the answer is "we don't capture that."

### Q: What do you capture, and what must you keep out?

Governing question: *"If this audit event leaked, what damage would it do?"* Capture enough to investigate; capture nothing that turns the audit log into a secondary breach.

| Capture | Transform / redact | Never store |
|---|---|---|
| Actor id, name, type, session | Card number → `last4` + token | Passwords (even hashed) |
| Action, category, outcome | SSN / national id → HMAC token or `last4` | Full PAN / CVV |
| Resource type + id | Email → keep (it's the actor); hash if a privacy-join key | Raw secrets, API keys, tokens |
| Source IP, user agent | Free text that may hold PII → structured fields | Full request/response bodies |
| Changed *field names*, non-sensitive old/new values | Content of a sensitive record read → store `resource.id`, not the data | Encryption keys, session cookies |
| Row counts, ticket numbers, reasons | Geolocation if regime-sensitive → coarsen | Raw PHI beyond "record X was viewed" |

The two techniques that let you keep the signal without the secret: **hashing for correlation** (store `HMAC(key, ssn)` so the same SSN yields the same token — correlatable, not reversible) and **recording the access, not the content** (log *that* patient 4471's record was read and which fields, never the field values).

**Follow-up — "HIPAA requires logging PHI access, but I'm told never to log PII. Contradiction?"**
No. You log *that* the access happened and *which* record — the actor and `resource.id` — not the PHI content. "Alice viewed patient 4471's record at 14:02" satisfies HIPAA's access-logging requirement; the PHI itself stays in the database. Copying the record contents into a long-retention audit store would duplicate sensitive data into the worst possible place. The discipline is: audit the *event of access*, not the *data accessed*.

### Q: Under impersonation or delegation, whose identity do you record?

**Both.** The *authenticated* actor (who actually performed the action) and the *effective/on-behalf-of* principal (whose context or permissions were used). Recording only one loses critical information.

| Scenario | Authenticated | On-behalf-of | Record |
|---|---|---|---|
| Admin impersonates a user (support tooling) | the admin | the user | `actor=admin`, `on_behalf_of=user` |
| Service account acts for a user (OBO token) | the service | the user | `actor=service`, `on_behalf_of=user` |
| API key issued to a partner | the key | the owning org/human | `actor.type=apikey`, plus owner |
| Workflow engine runs a step "as" someone | the workflow | the initiating user | `actor=workflow`, `on_behalf_of=user`, `workflow_id` |
| Cron / scheduled job | the service account | (none / policy) | `actor.type=service, id=retention-cleaner` |

The rule: **never collapse delegation to a single identity.** Recording only the admin hides *whose* data was touched; recording only the impersonated user hides *who actually did it* — and a malicious impersonating admin is precisely what the audit log must catch.

**Follow-up — "Where in the code do you establish the actor?"**
At the **authenticated edge** — auth middleware — placed into the request context and read once. Reconstructing the actor deep in the call stack is how you get it wrong (you've lost the impersonation context by then, or you re-derive it inconsistently). One chokepoint sets it; everything downstream reads it.

### Q: What is a controlled vocabulary for actions, and why does it matter?

A controlled vocabulary is a single source of truth — an enum/constants file — listing every valid `action` name, reviewed in code review like any API change.

```go
const (
    ActionLogin          = "auth.login"
    ActionLoginFailed    = "auth.login_failed"
    ActionRoleGranted    = "iam.role_granted"
    ActionCustomerExport = "customer.export"
    ActionCustomerDelete = "customer.delete"
)
```

It matters because without it, free-text actions drift over three years into `customer.export`, `export_customer`, and `customer.exported` — all coexisting, so every query misses a third of the data. The drift is silent: nothing errors, the records just quietly fail to match the `WHERE action = 'customer.export'` an investigator runs at 2am. A controlled vocabulary, enforced at the `Record` chokepoint, turns that silent gap into a compile error.

**Follow-up — "How do you evolve the schema without breaking five years of old queries?"**
Additively, and with `schema_version`. Adding *optional* fields is safe — old readers ignore them, old records simply lack them. Renaming, retyping, or removing fields is the breaking change: it orphans every historical query and record. So you never rename in place; you add the new field, dual-write during a transition, bump `schema_version`, and keep readers version-tolerant. The schema is the product, and it lives far longer than the code that emits it.

---

## Integrity & Tamper-Evidence

### Q: Explain how a hash chain makes an audit log tamper-evident.

Each record stores a hash of itself **plus the previous record's hash**:

```
hash[n] = H( serialize(record[n]) || hash[n-1] )
```

This links every record to all its predecessors. If anyone alters record *k*, its hash changes, which breaks the link to record *k+1*, whose stored `prev_hash` no longer matches — and the mismatch cascades forward through every subsequent record. To hide the tampering you'd have to recompute the entire chain from *k* to the end. That's where periodic **checkpoints** come in: you publish/sign `hash[n]` somewhere out of the tamperer's reach (a notary, a second system, even a tweet), so recomputing the chain can't fool a verifier holding the published checkpoint.

What it gives you: **deletion and modification become detectable**, even by someone with full write access to the table. What it does *not* give you: prevention (you can still alter bytes), or detection of records *never written in the first place* (a chain can't prove completeness on its own — that needs sequence numbers).

**Follow-up — "A hash chain detects modification of existing records. How do you detect that a record was silently dropped — never written at all?"**
Add a **monotonic sequence number** per chain (or per partition). A verifier checks the sequence has no gaps: `seq` 1,2,3,5 means record 4 is missing. The hash chain proves "these records weren't altered and are in this order"; the sequence proves "none were removed from the middle." You need both — chain for integrity, sequence for completeness. For high assurance, you also periodically assert "the chain currently has N records and head hash X" so a truncation of the *tail* (dropping the most recent records) is caught against the last checkpoint.

**Follow-up — "Why hash-chain instead of just signing every record individually?"**
Per-record signatures prove each record's authenticity but don't, by themselves, prove *ordering* or *completeness* — you could reorder or drop signed records freely. A hash chain captures order and linkage cheaply (one hash per record) without a signing operation per record (signing is far more expensive than hashing). The common production design is: hash-chain every record for order+integrity, then *sign periodic checkpoints* (every N records or every few seconds) for authenticity — getting both properties without signing millions of records.

### Q: What is WORM storage, and where does it fit relative to a hash chain?

WORM — **Write Once Read Many** — is storage that physically or contractually prevents modification and deletion for a retention period: AWS S3 Object Lock (Compliance mode), Azure immutable blob storage, dedicated WORM appliances. Once written with a retention until-date, *nobody* — not the app, not the admin, not the account root, in Compliance mode not even AWS support — can alter or delete it before the date.

How it relates to a hash chain: they're complementary. **WORM prevents** modification (a strong control). A **hash chain detects** modification (works even on mutable storage, and catches anything that slips past WORM, like a misconfiguration or a copy on non-WORM media). Belt and suspenders: WORM stops the common attacks, the hash chain proves integrity independently of trusting the storage layer.

**Follow-up — "S3 Object Lock has Governance mode and Compliance mode. Which for audit logs, and why?"**
**Compliance mode.** In Governance mode, users with a special IAM permission (`s3:BypassGovernanceRetention`) can shorten or remove the lock — which means a sufficiently privileged insider (or a compromised admin credential) can delete your evidence, defeating the point. Compliance mode allows *no* bypass, by anyone, until the retention period expires; the trade-off is that you cannot shorten retention even if you set it wrong, so you set retention deliberately and test it. For genuine audit/compliance evidence, Compliance mode is the answer; Governance is for "mostly immutable but we trust ourselves," which audit logs explicitly do not.

### Q: Should the audit write be part of the same transaction as the business change?

It's a real trade-off with three answers:

- **Same transaction** — `INSERT` the audit row in the same DB transaction as the change. *Pro:* you can never have "the change happened but wasn't audited" — they commit or roll back together. *Con:* couples the audit store to the business DB, adds latency to the business transaction, and breaks when the action isn't a DB write.
- **After the fact** — do the action, commit, then write the audit event. *Pro:* decoupled, flexible sink, no business-tx latency. *Con:* a crash between commit and audit-write leaves an *un-audited change* — the exact gap audit exists to close.
- **Outbox pattern** — write the audit event into an `outbox` table *in the same transaction* as the change; a separate relay reliably ships it to the real audit sink, deduping on `event_id` downstream. *This is the answer most mature systems converge on:* transactional capture (commits with the change) plus a decoupled, flexible sink. The cost is more moving parts and at-least-once delivery (hence the dedup).

**Follow-up — "My action isn't a DB write — it's an external API call (charge a card, send an email). How do you get transactional auditing?"**
You can't get true DB-transaction atomicity around a non-DB action. The pattern is **intent + outcome + reconciliation**: record the *intent* in an outbox before the call, the *outcome* after, and run a reconciler — if the outcome record never arrives, the dangling intent is flagged for investigation. It's the same at-least-once + dedup machinery applied to a non-transactional action; you trade atomicity for detectability of the gap.

**Follow-up — "A `denied`/`failure` event — where does that go? Inside the failed transaction?"**
No — that's a classic trap. If you write a `denied` event *inside* the business transaction that then rolls back, the audit event rolls back with it and **vanishes** — you lose the record of the very denial you needed to capture. Denials and failures must be written *outside* the failed business transaction (their own transaction, or after-the-fact). A denied access has no successful business commit to attach to; it must stand alone.

---

## Compliance & Retention

### Q: Match the regime to what it actually demands of audit logs: SOC 2, HIPAA, PCI DSS, GDPR.

- **SOC 2** — a *trust framework* (auditor-attested), not a law. The relevant criteria require that you log security-significant events, protect the logs from tampering, retain them, and *review* them. An auditor will ask to see your audit trail and your evidence that you monitor it. It's broad and control-oriented rather than prescriptive about fields.
- **HIPAA** (Security Rule §164.312(b), "Audit controls") — requires recording and examining activity in systems that handle **PHI**. Concretely: log *who accessed which patient record when*. Often interpreted as per-record access logging. Retention commonly 6 years.
- **PCI DSS Requirement 10** — the **most prescriptive** on audit content. It enumerates required fields (user id, event type, date/time, success/failure, origination, affected resource), demands log integrity/protection (file-integrity monitoring), time synchronization, and a minimum **1 year retention with 3 months immediately available**.
- **GDPR** — not primarily an audit-logging regime, but it constrains audit logs hard: data-minimization (don't over-collect PII into the log), and the **right to erasure** (Article 17), which collides with immutability — addressed below.

The one-liner per regime: **SOC 2** = prove you have controls and review them; **HIPAA** = log PHI access; **PCI DSS** = log these exact fields, protected, for a year; **GDPR** = minimize PII and reconcile erasure with immutability.

**Follow-up — "PCI DSS says retain for one year. HIPAA says six. We handle both. What's the retention?"**
You take the **maximum** that applies to each class of data — you can't under-retain to satisfy the shorter one. In practice you classify events: cardholder-data-related events follow PCI's clock, PHI-related events follow HIPAA's, and you may set distinct retention policies per category (often via separate storage tiers or lifecycle rules per event type). You don't blanket everything to the longest retention if that means hoarding PII you should minimize — retention is per-obligation, and longer-than-required retention of personal data is its own GDPR risk.

### Q: GDPR requires erasing a user's data on request, but audit logs must be immutable. How do you reconcile this?

You **don't store the raw identity** in the immutable audit record. Store a *pseudonymized subject reference* — a token — and keep the token→identity mapping in a **separate, erasable** store. On an erasure request, you delete the *mapping*, not the audit record.

Result: the audit log stays immutable and intact — you can still prove "subject token X did Y at 14:02" and the hash chain is unbroken — but the link back to the real person is severed, so the audit log no longer constitutes personal data about that individual in a re-identifiable way. The audit trail's integrity and the right to erasure both survive.

**Follow-up — "Isn't a pseudonym still personal data under GDPR if you can re-identify via the mapping? And once you delete the mapping, can you still investigate?"**
Yes — pseudonymized data is still personal data *while the mapping exists*; that's why the mapping lives in an access-controlled, erasable store and erasure deletes it. After erasure, you trade re-identifiability for compliance: you can still analyze the *actions* of token X (patterns, counts, "did this token access resources it shouldn't") but you can no longer tie them to a named person — which is the whole point of erasure. Regulators accept this because the alternative (deleting audit records) would destroy others' rights and your security posture. There are nuances — some regimes grant audit/legal-hold exemptions to erasure — but the pseudonym-plus-erasable-mapping pattern is the standard engineering answer.

### Q: What is a legal hold, and how does it interact with your retention policy?

A **legal hold** (litigation hold) is a directive to **preserve** specific data relevant to anticipated or active litigation/investigation — it *overrides* your normal retention/deletion policy. If your policy deletes audit records after 1 year but a record is under legal hold, you must **not** delete it, even past the retention date, until the hold is lifted.

The engineering consequence: your retention/deletion automation must be able to *exclude* held records, and you need a way to mark, track, and later release holds. Deleting data that was under legal hold — even by an automated lifecycle rule you forgot to override — is **spoliation**, which carries serious legal sanctions (adverse-inference instructions, fines). So "retention" is really "minimum retention, unless a hold extends it indefinitely."

**Follow-up — "S3 Object Lock Compliance mode won't let you delete before the retention date. How do you apply a legal hold for *longer*, or release one?"**
S3 has a separate **Legal Hold** flag (distinct from retention-period locks) that prevents deletion indefinitely, independent of the retention date, and can be toggled off (by a principal with `s3:PutObjectLegalHold`) when the hold is lifted — unlike Compliance-mode retention, which can't be shortened. So the pattern is: Compliance-mode retention enforces the *minimum* legally required retention immutably; Legal Hold *extends* preservation beyond it for specific objects and is releasable. They compose: retention sets the floor, legal hold raises the ceiling for held items.

---

## Tricky / Trap Questions

### Q: "Our audit logs go to the same Elasticsearch cluster as our app logs, with the same retention and sampling. Is that fine?"

Wrong instinct: "logs are logs, one pipeline is simpler." It's three compliance gaps at once.

1. **Sampling** drops audit events — you've lost evidence, possibly the exact event that mattered. Audit must never be sampled.
2. **Retention** for app logs is days/weeks; audit needs years. Your records age out before an auditor or investigator asks for them.
3. **Mutability** — engineers with cluster access can edit or delete Elasticsearch documents; there's no tamper-evidence. The records aren't trustworthy as evidence.

The right shape: a *separate*, append-only, never-sampled, long-retention store of record (DB table with revoked UPDATE/DELETE, or WORM object storage), with the SIEM/Elasticsearch as a **fan-out sink for search and alerting** — not the system of record. Two sinks, different jobs.

### Q: "We sign every audit record with our service's private key, so it's tamper-proof." What's wrong?

Wrong instinct: "signing = tamper-proof." Signing proves *authenticity* (this record came from a holder of the key) but a single service key has problems.

- **No ordering/completeness.** Per-record signatures don't prevent reordering or *deletion* of whole records — drop a signed record and nothing detects it. You need a hash chain + sequence numbers for that.
- **Key compromise rewrites history.** If the signing key leaks, an attacker forges *and re-signs* arbitrary records; your "tamper-proof" log is now silently forgeable. Mitigation: keep the key in an HSM/KMS so it can't be exfiltrated, and chain so that re-signing the whole history is required (and detectable against published checkpoints).
- **"Tamper-proof" overclaims.** Nothing software-only is tamper-*proof*; it's tamper-*evident*. Conflating the two in an interview is a red flag.

The strong design: hash-chain for order+integrity, sign *checkpoints* (not every record) with an HSM-held key, publish checkpoints externally. Then a key compromise still can't rewrite history older than the last externally-published checkpoint without detection.

### Q: A bulk operation deletes 50,000 records. Do you write one audit event or 50,000?

Wrong instinct: "obviously one, 50,000 is wasteful." Sometimes wasteful is required.

It depends on the **regime and the resource**. For most business operations, one event with `metadata.row_count = 50000` and the query/filter that defined the set is correct and proportionate. But **HIPAA per-record access** may require that each patient record accessed is individually auditable — "alice ran a query that touched 50,000 patient records" isn't enough if the requirement is "log access to *each* PHI record." For PCI cardholder data, similar per-resource expectations can apply.

So the senior answer is: *"What does the compliance requirement for this resource class say?"* Default to one coalesced event with row counts for efficiency; expand to per-record only where a regime demands it — and know *which* of your resources fall under such a regime before you choose.

### Q: "We'll add the hash chain / integrity later — let's ship the basic audit log first." What do you say?

Wrong instinct: "integrity is a nice-to-have, ship the MVP." Retrofitting integrity is far harder than building it in, and worse, the records written *before* you added it are **permanently unverifiable** — you can never prove that the first year of your audit history wasn't tampered with, because it has no chain. For evidence, "we added integrity in month 13" means months 1–12 are legally weaker forever.

Pragmatic framing: you *can* phase it — start with access-control append-only (revoke UPDATE/DELETE) on day one, which is cheap, and add the hash chain shortly after. But you can't *defer it indefinitely* and expect the early records to count as strong evidence. The append-only access control is non-negotiable from day one; the chain should follow fast, not "someday."

### Q: An auditor asks "prove no audit record was deleted in the last 90 days." Your store is an append-only Postgres table with UPDATE/DELETE revoked. Can you?

Wrong instinct: "yes, it's append-only, so nothing was deleted." Append-only *access control* stops the *app role* from deleting — but a DBA, a superuser, or a `TRUNCATE` from a migration could have removed rows, and a plain table has **no way to prove their absence**. You can show the *grants*, but not that no privileged actor bypassed them.

To actually *prove* it you need either: a **hash chain + monotonic sequence** (verify the chain is intact and the sequence has no gaps → no record was altered or removed from the middle), plus a **checkpoint** of the head published externally at the start of the window (so tail-truncation is caught too); or **WORM storage** where the storage layer itself attests no deletion occurred. Access-control append-only is a *control*, not a *proof*. The honest answer is "with this setup I can show the access controls but cannot cryptographically prove no privileged deletion — for that I'd need a chain and external checkpoints," and a good interviewer wants exactly that honesty.

### Q: Your audit sink is down. The user clicks "delete account." What happens?

Wrong instinct: "log the error and let the delete proceed — don't block the user." That depends entirely on whether this action *must* be audited.

This is the **fail-open vs fail-closed** decision:

- **Fail closed** — refuse the action if it can't be audited. Correct for high-stakes, regulated actions (financial transactions, PHI access, privilege changes) where an un-audited action is worse than a failed one. "We don't perform unauditable privileged actions."
- **Fail open** — let the action proceed and loudly record that auditing failed. Acceptable for lower-stakes actions where availability beats completeness, *but only if the failure-to-audit is itself captured and alerted* — never silent.

The one universal rule: **a missing audit write must never be silent.** Whichever you choose, the failure is an event that gets alerted and reconciled. The outbox pattern largely sidesteps this — the audit event commits transactionally with the change, so "the change happened but wasn't audited" can't occur due to a downstream sink outage; the relay catches up when the sink recovers.

### Q: Two services write to the same hash-chained audit log concurrently. What breaks, and how do you fix it?

Wrong instinct: "just have both append." A hash chain is inherently **sequential** — `hash[n]` depends on `hash[n-1]` — so two concurrent appenders racing to read the head, compute their hash, and write create a fork or a lost update: both read head *H*, both chain off it, one overwrites the other's link.

Fixes: **single-writer** (funnel all appends through one writer/partition that serializes them — simplest, but a throughput bottleneck and a SPOF); **per-partition chains** (each shard/tenant/service has its *own* chain; you give up a single global order but gain parallelism, and cross-partition order is reconstructed from timestamps + sequence); or **a serialized critical section** (advisory lock / `SELECT ... FOR UPDATE` on the chain head — correct but contended). The honest trade-off is global-total-order vs throughput: most high-volume systems shard into per-partition chains and accept per-partition (not global) ordering, which is almost always sufficient for forensics.

---

## System / Design Scenarios

### Q: Design the audit logging for a healthcare records system (HIPAA).

Drive every decision from "this is PHI access evidence, retained 6 years, that we may defend in an audit or a breach investigation."

- **What to capture.** Every access to a patient record: `actor` (the clinician/staff, with on-behalf-of if support is impersonating), `action` (`patient.record_read`, `patient.record_update`), `resource` (`type=patient, id=...`, the *fields* viewed), `outcome`, `source`, `correlation`. Record *that* access happened and *which* record/fields — **never the PHI content**.
- **Per-record granularity.** HIPAA's access-logging is typically per-record, so a query touching 500 patients needs each access auditable — not one coalesced event. Plan storage volume accordingly.
- **Store.** Append-only, never-sampled, 6-year retention. Hot tier (queryable Postgres/OpenSearch) for recent, cold WORM (S3 Glacier + Object Lock, Compliance mode) for the long tail. Hash chain + sequence for tamper-evidence; sign checkpoints with a KMS/HSM key.
- **Identity.** Strong auth (no shared logins — non-repudiation depends on it). Capture impersonation: when support views a patient on a clinician's behalf, both identities recorded.
- **Privacy.** Minimum-necessary in the event; HMAC-token any identifier used as a privacy join key; the audit log itself is sensitive and access-controlled (who can read the audit log is *also* audited — "break-glass" access is a classic audited event).
- **Reconciliation with GDPR-style erasure** (if EU patients): pseudonymized subject token + erasable mapping.
- **Monitoring.** Alert on anomalies: a clinician accessing records outside their department, bulk exports, after-hours mass access ("VIP patient snooping" is a named HIPAA concern).

**Follow-up — "A nurse looks up a celebrity patient they're not treating. How does your design catch it?"**
This is the canonical HIPAA "snooping" case, and the audit log is exactly what catches it — *after the fact, and that's the point*. Your per-record access events plus anomaly detection flag it: access to a patient with no corresponding care relationship (cross-reference the audit `actor`/`resource` against the care-assignment system), or access patterns deviating from the nurse's department/role. The audit log makes the access *undeniable* (non-repudiation) and *discoverable* (anomaly query); it doesn't prevent the lookup, it ensures the lookup can be found, attributed, and disciplined — which is precisely the deterrent and the compliance evidence HIPAA's audit-controls requirement exists to provide.

### Q: Design a tamper-evident audit log that even your own DBAs/SREs can't quietly alter.

The threat model is the **privileged insider** — someone with full DB and infra access. Defense in depth:

1. **Hash chain + monotonic sequence** on every record → modification and middle-deletion are *detectable* even with full write access.
2. **External checkpoints.** Periodically (every N records / few seconds) publish the head hash to a place the insider can't reach: a separate cloud account with different IAM, a notary/timestamping service, a transparency log, even a blockchain or a write-only third-party. Now they can't rewrite history older than the last checkpoint without the checkpoint contradicting them.
3. **WORM storage** (S3 Object Lock, Compliance mode) for the durable copy → the storage layer refuses deletion, even by account root, for the retention period.
4. **Sign checkpoints with an HSM/KMS key** the SRE can't export → they can't forge a valid checkpoint.
5. **Separation of duties.** The people who operate the business systems are *not* the people who hold the audit-system keys or the checkpoint-publishing account. The insider who could tamper can't also forge the proof.
6. **Audit the audit access.** Reads of, and admin actions on, the audit store are themselves audited (to a separate boundary).

The principle: you assume any *single* trusted party may be malicious, and arrange that tampering requires colluding across separated boundaries while still failing against the external checkpoint.

**Follow-up — "External checkpoints to a third party — isn't that overkill? Where's the line?"**
The line is set by your threat model and regime. For most internal SOC 2 contexts, hash chain + WORM + separation of duties is proportionate; external checkpointing is for high-stakes evidence (financial ledgers, regulated records, anything that may end up in court against a well-resourced adversary including insiders). The cost is low (a periodic hash to an external service) and the value is specifically defeating the *privileged insider who controls all your infrastructure* — so you add it when that insider is in your threat model. If your adversary is only external attackers and buggy code, you can stop at WORM + chain.

### Q: A SaaS handles 200K business actions/sec across 5,000 tenants. Design audit logging that's queryable, compliant, and affordable.

Tensions: volume (200K/sec, never sampled), multi-tenancy (5,000 isolation boundaries), queryability (forensics must be fast), cost (long retention × huge volume).

- **Ingest via outbox + relay**, partitioned. Per-tenant or per-shard outbox so business writes commit with the audit event; relays ship to the sink. Partitioned hash chains (per tenant or per shard) for parallelism — accept per-partition order, not global.
- **Tiered storage.** Hot tier (recent ~90 days, indexed, fast forensic query). Warm/cold tier (the long-retention tail) in compressed columnar object storage (Parquet on S3) with a catalog (Athena/BigQuery) — cheap, queryable on demand, WORM-locked. PCI's "1 year, 3 months immediately available" maps directly onto this tiering.
- **Tenant scoping is access control, not just a filter.** `tenant_id` on every record; query paths enforce that tenant A's auditor can never read tenant B's events. A missing tenant scope is a cross-tenant data leak.
- **Index for the rare-but-critical read.** (`actor`, time), (`resource`, time), (`action`, time) — audit is write-heavy, read-rarely-but-critically; optimize the critical read.
- **Cost control without sampling.** Audit *significant* actions (not every row read), coalesce bulk ops where the regime allows, compress aggressively in cold storage, lifecycle to cheaper tiers. Never random-drop qualifying events.
- **Integrity at scale.** Sign checkpoints, not records. Per-partition chains with periodic external checkpoint per partition.

**Follow-up — "An auditor for tenant Acme wants 'everything tenant Acme's users did last March.' How fast, and how do you stop them seeing other tenants?"**
Fast, because you indexed `(tenant_id, time)` (and the cold tier is partitioned by tenant/date, so it's a partition prune, not a scan). The cross-tenant guard is *enforced in the query layer*, not trusted to the auditor: the audit-query API takes the caller's authorized tenant scope and *injects* `tenant_id = 'acme'` as a non-removable predicate (and the cold-store partition path is tenant-scoped), so there's no query they can write that returns another tenant's rows. And the auditor's *own access to the audit log* is itself audited. Multi-tenant audit is two boundaries — the data partition and the access-control predicate — and you enforce both, never just filter.

### Q: How would you build a forensic-query capability over an immutable audit store?

The audit store optimizes for *write* and *retain*; forensic query is a *read* problem layered on top.

- **The audit event is the index entry; logs and traces are the detail.** Stamp `request_id` + `trace_id` on every audit event so an investigation is a *join*, not a timestamp-grep: find the audit event → take its correlation ids → pull the matching app logs and distributed trace for the exact same operation.
- **Index the forensic questions**, which are knowable in advance: "what did actor X do?" → (`actor_id`, time); "who touched resource Y?" → (`resource_type`, `resource_id`, time); "every occurrence of action Z" → (`action`, time); "all impersonations by an admin" → (`actor.on_behalf_of IS NOT NULL`).
- **Don't mutate to query.** Querying never writes back to the immutable store; build derived/materialized read models *outside* it if you need aggregations, and treat those as disposable.
- **Reproducibility.** A forensic query should be re-runnable and produce the same result (evidence must be reproducible), so query against the immutable store, version your query, and record *who ran which forensic query when* — because querying the audit log is itself an audited, access-controlled action.

**Follow-up — "The investigator has the audit event but the correlated app logs aged out after 14 days, and the incident is 6 months old. Now what?"**
You've hit the retention-mismatch reality: audit (the deliberate *act*) is retained for years, but the operational *detail* (logs/traces) is short-lived. So the audit event tells you *that* alice exported customer 4471 at 14:02 with `row_count=10421` and the outcome — which is itself the legally significant fact — but the moment-by-moment execution detail is gone. The lesson the question is fishing for: **put the forensically essential facts in the audit event itself** (row counts, the filter/query that defined the set, the reason, the resource ids), not only in the ephemeral logs, precisely because the logs won't be there in six months. Correlation is a bonus when the logs survive; the audit event must stand alone when they don't.

---

## Live Coding / Whiteboard

### Q: Implement a tamper-evident append with a hash chain. Show append and verify.

```python
import hashlib, json

def _hash(record: dict, prev_hash: str) -> str:
    # Canonical serialization is critical: same record must always hash the same.
    payload = json.dumps(record, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(f"{payload}|{prev_hash}".encode()).hexdigest()

GENESIS = "0" * 64

def append(chain: list[dict], record: dict) -> dict:
    prev = chain[-1]["hash"] if chain else GENESIS
    seq = chain[-1]["seq"] + 1 if chain else 0
    entry = {"seq": seq, "record": record, "prev_hash": prev}
    entry["hash"] = _hash(record, prev)          # hash of THIS record + prev link
    chain.append(entry)
    return entry

def verify(chain: list[dict]) -> bool:
    prev = GENESIS
    for i, entry in enumerate(chain):
        if entry["seq"] != i:                    # completeness: no gaps
            return False
        if entry["prev_hash"] != prev:           # linkage intact?
            return False
        if entry["hash"] != _hash(entry["record"], prev):  # record unaltered?
            return False
        prev = entry["hash"]
    return True
```

Talking points the interviewer wants: **canonical serialization** (`sort_keys`, fixed separators) — without it the same record hashes differently and verification falsely fails; the **sequence check** catches *deletion from the middle*, which the hash linkage alone misses; and the limitation — this verifies an in-memory chain, but to detect *tail truncation* you need an externally published checkpoint of the head hash, and to defend against a privileged rewrite you need that checkpoint to live somewhere the attacker can't reach.

### Q: Write a `Record` chokepoint that makes incomplete audit events impossible.

```go
var ErrIncompleteEvent = errors.New("incomplete audit event")

// Record is the ONLY way to emit an audit event. It rejects anything missing
// the five W's, so a half-record can never reach the store.
func Record(ctx context.Context, tx DBTX, e Event) error {
    if e.Actor.ID == "" || e.Action == "" ||
        e.Resource.ID == "" || e.Outcome == "" {
        return fmt.Errorf("%w: %+v", ErrIncompleteEvent, e) // fail loud, ideally in CI
    }
    if !validActions[e.Action] { // controlled vocabulary — reject free-text actions
        return fmt.Errorf("unknown action %q", e.Action)
    }
    e.SchemaVersion = "1.0"
    e.EventID = ulid.Make().String()
    e.Time = time.Now().UTC()
    payload, err := json.Marshal(e)
    if err != nil {
        return err
    }
    // Write to the OUTBOX in the caller's transaction — transactional capture.
    _, err = tx.ExecContext(ctx, `
        INSERT INTO audit_outbox (event_id, occurred_at, actor_id, action,
            resource_type, resource_id, outcome, tenant_id, request_id,
            trace_id, payload, shipped)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false)`,
        e.EventID, e.Time, e.Actor.ID, e.Action, e.Resource.Type,
        e.Resource.ID, e.Outcome, e.Resource.TenantID,
        e.Correlation.RequestID, e.Correlation.TraceID, payload)
    return err
}
```

Talking points: a **single chokepoint** (no ad-hoc audit writes scattered around) is what lets you *enforce* completeness, the controlled vocabulary, schema version, and the outbox in one place; rejecting incomplete events at the type/validation level turns "we forgot to set outcome" from a silent bad record into a loud failure; and it writes to the **outbox in the caller's transaction**, so capture is atomic with the business change.

### Q: Here's an audit-write call site. Find the bugs.

```python
def delete_customer(customer_id, current_user):
    try:
        db.execute("DELETE FROM customers WHERE id = ?", customer_id)
        audit_log.info(f"User {current_user} deleted customer {customer_id}")
    except Exception:
        pass
```

The bugs, roughly in order of severity:

1. **Swallowed exception (`except: pass`).** If the *delete* fails, the user thinks it failed; if the *audit write* fails, the action proceeded **un-audited and silently** — the exact gap audit exists to close. A failed audit write must be alerted, never swallowed.
2. **Un-transactional audit.** The delete commits independently of the audit line; a crash between them leaves an un-audited delete. Use the outbox / same-transaction.
3. **No outcome, no failure record.** Only success is "logged"; a *failed* or *denied* delete produces no audit event at all.
4. **Free-text, not structured.** `f"User {x} deleted {y}"` isn't queryable; an investigator can't run `WHERE action='customer.delete'`. Use structured fields and a controlled-vocabulary action.
5. **Surface identity only.** `current_user` ignores impersonation/on-behalf-of — if support is impersonating, you've lost who really acted.
6. **No correlation ids, no resource type, no tenant scope.** No `request_id`/`trace_id`, no `tenant_id` — investigation becomes timestamp-grepping and risks cross-tenant leakage.
7. **Audit on the operational logger.** `audit_log.info` to the app log stream means it's sampled, rotated, and mutable — not an audit store.

The fixed shape: structured event via a `Record` chokepoint, in the outbox transaction, with both identities, correlation ids, outcome, and a failure path that audits denials/errors outside the rolled-back transaction.

### Q: Sketch the outbox relay. What two properties must it have?

```text
loop forever:
    rows = SELECT * FROM audit_outbox
           WHERE shipped = false
           ORDER BY occurred_at
           LIMIT 500
    for row in rows:
        sink.write(row.payload)        # MUST be idempotent on event_id
    UPDATE audit_outbox SET shipped = true
           WHERE event_id IN (rows.event_id)
    sleep(short)
```

The two properties: **at-least-once delivery** (a crash after `sink.write` but before the `UPDATE` re-ships on restart — so the sink must **dedupe on `event_id`**, or you double-count), and **ordering preservation if the sink is chained** (ship in `occurred_at`/sequence order so the downstream hash chain links correctly; out-of-order shipping breaks the chain). Bonus point: the relay should be a *single* logical shipper per partition (or use `SELECT ... FOR UPDATE SKIP LOCKED`) so two relay instances don't both grab the same rows.

---

## Behavioral / Experience

### Q: Tell me about a time you designed or fixed an audit logging system.

The interviewer wants arc, a real constraint (a regulation, an audit, an incident), evidence, and a lesson — not "I added structured logging."

Example skeleton:

- **Context.** A fintech going through its first SOC 2 Type II audit; the existing "audit log" was app logs in Datadog with 30-day retention.
- **Problem.** The auditor asked to see "all privilege grants in the last 6 months" and "proof the records weren't altered." We could produce neither — 30-day retention, mutable, sampled.
- **Design.** Separate append-only Postgres table (UPDATE/DELETE revoked), outbox pattern for transactional capture, controlled-vocabulary actions, `request_id`/`trace_id` correlation, hash chain with daily checkpoints to a separate AWS account, S3 Object Lock for the cold tier.
- **Hard call.** Same-tx vs outbox — chose outbox to decouple the sink without leaving a crash window.
- **Outcome.** Passed the control; the chain later *caught* a migration script that tried to `TRUNCATE` the table (it failed against the grants, and the attempt was alerted).
- **Lesson.** Retrofitting integrity is expensive and the pre-retrofit records are unverifiable forever — build append-only from day one.

Tell *one* system, with concrete regulation and numbers.

### Q: Describe a forensic investigation where the audit log was (or wasn't) enough.

Pick a real "who did this" moment. Strong elements: the question you had to answer, what the audit log told you, what it *couldn't*, and what you changed afterward.

Example: "A customer reported their data had been exported without authorization. The audit log had `customer.export` with `actor.id`, `row_count`, and `request_id` — so we immediately knew *who*, *when*, and *how much*. But the actor was a shared `support` service account (no per-human attribution), so we couldn't tell *which support agent*. We correlated the `request_id` to the app logs to find the session, then to the SSO logs for the human — but those had already aged out at 14 days, and this was 3 weeks old. We identified the agent through a different trail, but the lesson was sharp: non-repudiation died at the shared account. We split the service account into per-agent identities and put the human identity *into the audit event itself* rather than relying on short-lived correlated logs."

### Q: Tell me about a conflict between immutability and another requirement (privacy, cost, performance). How did you resolve it?

The interviewer wants to see you hold two hard requirements at once.

Example: "GDPR erasure vs immutable audit. Legal wanted user data erasable on request; security and compliance needed the audit trail immutable for 6 years. The naive readings are contradictory. We resolved it with pseudonymization: the audit records stored a subject *token*, never the raw identity, and the token→person mapping lived in a separate, access-controlled, *erasable* store. On an erasure request we deleted the mapping, not the audit records — the hash chain stayed intact, the actions stayed analyzable, but the link to the named person was severed. Both legal and security signed off. The lesson: 'immutable' and 'erasable' aren't contradictory if you're precise about *what* must be immutable (the record of the action) versus *what* can be erased (the link to a person)."

### Q: Have you ever discovered your audit log was incomplete or untrustworthy *after* you needed it?

Self-aware candidates have a war story; it's more valuable than a clean record.

Example: "During an incident I went to the audit log to find who'd changed a feature flag, and the events for the 20 minutes around the change were *missing*. The audit events shared the app-log pipeline, which had a lossy buffer that dropped under load — and the incident itself had caused the load. The audit log failed exactly when I needed it most. We moved audit to the outbox pattern (transactional capture, immune to downstream backpressure) and added a completeness check (sequence-gap detection) that alerts when audit events go missing. Lesson: an audit log that shares fate with the system it audits will be absent during the incidents that matter most."

---

## What I'd Ask a Candidate Now

Questions that separate "logged some events" from "designed audit as evidence."

### Q: When is an audit log *not* the right tool — what would you reach for instead?

Listening for boundaries, not "audit everything." Good answers: for *debugging* reach for app logs/traces (audit isn't for engineers); for *metrics/trends* reach for a TSDB (audit isn't aggregate analytics); for *change history of data* you may want event sourcing or temporal tables (overlapping but different — those are about reconstructing state, audit is about accountability); for *real-time alerting* a SIEM consumes the audit stream but isn't the store of record. A candidate who audits everything, including every cache read, has missed the cost and the point.

### Q: What's the difference between tamper-*evident* and tamper-*proof*, and why does it matter?

Tamper-**evident** = alteration is *detectable* (hash chain, signatures). Tamper-**proof** = alteration is *prevented* (WORM, hardware). Software-only systems are essentially never tamper-proof; they're tamper-evident, and claiming "tamper-proof" is overclaiming. It matters because the guarantees differ: evidence detects after the fact (you find out it happened); prevention stops it (it can't happen). You usually combine them — WORM to prevent the common case, hash chains to detect what slips through. A candidate who uses the terms interchangeably hasn't thought about the threat model.

### Q: How do you test that an audit log is actually immutable and complete?

Listening for *adversarial* testing, not "we wrote a record and read it back." Strong answers: a CI test that attempts UPDATE/DELETE as the app role and asserts it's *rejected*; a test that crashes the process between business-commit and relay-ship and asserts the event *still arrives* (outbox durability); a chain-verification test that tampers a record and asserts `verify()` *fails*; a sequence-gap test that removes a record and asserts the gap is *detected*; a test that the WORM lock actually refuses deletion before the retention date. You test the *negative* — that the thing that shouldn't be possible is actually impossible.

### Q: An action happens in a system you don't control (a third-party SaaS, a partner API). How do you audit it?

Black-box thinking. You can't instrument their code, so you audit at *your* boundary: record the *request* you sent and the *response* you got (intent + outcome), pull their audit logs / webhooks if they expose them (e.g., their admin-action feed), reconcile your view against theirs, and treat any divergence as an event. The honest part of a good answer: "I can't get *their* non-repudiation; I can prove *what we asked them to do and what they told us happened*, and flag mismatches." Auditing across a trust boundary you don't own is a real skill.

### Q: What's the most over-engineered audit logging you've seen, and what's the right amount?

Probing judgment, not maximalism. A self-aware answer: blockchain for an internal SOC 2 audit log where hash chain + WORM + separation of duties was entirely sufficient; or signing every single record with a per-actor key in a system with no insider threat in scope. The right amount is *driven by the threat model and the regime*: who might tamper, what must you prove, to whom, and what's the cost of being wrong. Audit logging has a real "match the rigor to the requirement" axis, and a candidate who reaches for the heaviest crypto regardless of context is as wrong as one who skips integrity entirely.

---

## Cheat Sheet

Top-10 must-know questions for any audit-logging interview:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ MUST-KNOW AUDIT LOGGING QUESTIONS                                          │
├──────────────────────────────────────────────────────────────────────────┤
│  1. Audit log vs debug log?                                                │
│       → Evidence (immutable, never sampled, years) vs telemetry.           │
│                                                                            │
│  2. The five W's of an audit event?                                        │
│       → who, what, which, when, outcome (+ where).                         │
│                                                                            │
│  3. What does append-only mean, and how do you enforce it?                 │
│       → Insert-only. Revoke UPDATE/DELETE → WORM → hash chain.             │
│                                                                            │
│  4. How does a hash chain make a log tamper-evident?                       │
│       → hash[n]=H(rec[n] || hash[n-1]); a change cascades & is detected.   │
│                                                                            │
│  5. Hash chain vs signing vs WORM?                                         │
│       → chain=order+integrity; sign=authenticity; WORM=prevention.         │
│                                                                            │
│  6. Same-tx vs after-the-fact vs outbox for the audit write?               │
│       → Outbox: transactional capture + decoupled sink. Dedupe on id.      │
│                                                                            │
│  7. SOC 2 / HIPAA / PCI DSS / GDPR — what does each demand?                 │
│       → controls / PHI-access / exact-fields-1yr / minimize+erasure.       │
│                                                                            │
│  8. GDPR erasure vs immutability — reconcile?                              │
│       → Pseudonymized token in log; erase the mapping, not the record.     │
│                                                                            │
│  9. Why never sample audit events?                                         │
│       → The one event that matters is in the discarded fraction.           │
│                                                                            │
│ 10. Non-repudiation — what does it require?                                │
│       → Strong auth + integrity + signing; dies at shared accounts.        │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Further Reading

- **NIST SP 800-92, "Guide to Computer Security Log Management"** — the canonical reference for what audit records must contain and how to manage them.
- **PCI DSS Requirement 10** — the most concrete, field-by-field audit-content requirements; worth reading even outside payments as a model.
- **HIPAA Security Rule §164.312(b)** — "Audit controls" for PHI access; short and frequently interview-referenced.
- **GDPR Articles 5 (minimization) & 17 (erasure)** — the privacy constraints that collide with immutability.
- **"Certificate Transparency" (RFC 6962)** — a real-world tamper-evident, externally-checkpointed log; the gold-standard mental model for append-only Merkle/hash-chained logs.
- **AWS S3 Object Lock documentation** — Governance vs Compliance mode, legal holds, retention; the practical face of WORM.
- **Elastic Common Schema (ECS)** — <https://www.elastic.co/guide/en/ecs/current/index.html> — field names worth adopting.
- **OCSF schema browser** — <https://schema.ocsf.io/> — Authentication, Account Change, and API Activity event classes.
- **Chris Richardson, "Transactional Outbox" pattern** — <https://microservices.io/patterns/data/transactional-outbox.html>.
- **OWASP Logging Cheat Sheet** — capture/redact guidance, what never to log.

---

## Related Topics

- [Audit Logging — Junior](junior.md)
- [Audit Logging — Middle](middle.md)
- [Audit Logging — Senior](senior.md)
- [Audit Logging — Professional](professional.md)
- [Logging — Interview](../logging/interview.md)
- [Error Handling — Interview](../error-handling/interview.md)
- [Tracing](../tracing/) — where `trace_id` comes from and how it propagates for correlation.
- [Telemetry Cost & Sampling Strategy](../telemetry-cost-and-sampling-strategy/) — and why audit events are explicitly exempt from sampling.
- The `secrets-management` and `encryption-basics` skill areas — what must never enter an audit event, and how to tokenize what you keep.
- The `auth-token-security` / `api-authentication` skill areas — where the actor identity (including on-behalf-of) originates, the foundation of non-repudiation.
