# Audit Logging — Senior Level

> **Topic:** [Audit Logging Roadmap](README.md)
> **Focus:** Making the audit trail *provable*. Tamper-evidence (hash chains, signing, WORM). Retention and legal hold under SOC 2 / HIPAA / GDPR / PCI DSS. Performance at volume. The threat model — including the insider with `root`.

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [The Threat Model: Who Are You Defending Against?](#the-threat-model-who-are-you-defending-against)
8. [Tamper-Evidence I — Hash Chains](#tamper-evidence-i--hash-chains)
9. [Tamper-Evidence II — Signing and Notarization](#tamper-evidence-ii--signing-and-notarization)
10. [Tamper-Resistance — WORM and Immutable Storage](#tamper-resistance--worm-and-immutable-storage)
11. [Retention, Legal Hold, and the Compliance Regimes](#retention-legal-hold-and-the-compliance-regimes)
12. [The GDPR vs Immutability Collision](#the-gdpr-vs-immutability-collision)
13. [Volume and Performance at Scale](#volume-and-performance-at-scale)
14. [Separating Audit From Operational Logs — For Real](#separating-audit-from-operational-logs--for-real)
15. [Time, Ordering, and Trustworthy Timestamps](#time-ordering-and-trustworthy-timestamps)
16. [Code Examples](#code-examples)
17. [Worked Example — Proving a Record Was Deleted](#worked-example--proving-a-record-was-deleted)
18. [Pros & Cons](#pros--cons)
19. [Use Cases](#use-cases)
20. [Coding Patterns](#coding-patterns)
21. [Clean Code](#clean-code)
22. [Best Practices](#best-practices)
23. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
24. [Common Mistakes](#common-mistakes)
25. [Tricky Points](#tricky-points)
26. [Test Yourself](#test-yourself)
27. [Tricky Questions](#tricky-questions)
28. [Cheat Sheet](#cheat-sheet)
29. [Summary](#summary)
30. [What You Can Build](#what-you-can-build)
31. [Further Reading](#further-reading)
32. [Related Topics](#related-topics)
33. [Diagrams & Visual Aids](#diagrams--visual-aids)

---

## Introduction

> Focus: **An audit log nobody can prove is intact is not an audit log — it's a suggestion.**

At middle level you built a real audit pipeline: a stable schema, a controlled vocabulary of actions, append-only storage enforced by `REVOKE UPDATE, DELETE`, the outbox for transactional capture, correlation IDs, redaction. That is a genuinely good system. It survives a sloppy engineer and a buggy deploy.

It does **not** survive an adversary. The senior shift is naming that adversary precisely: a DBA with `UPDATE` on every table, an attacker who got root on the audit host, an engineer who wants to hide what they did, a vendor under subpoena pressure to alter records. Middle-level append-only means *the application cannot modify the log*. It says nothing about whether the **person who runs the database** can. The senior question is no longer "can my app overwrite this?" but **"if someone deletes or edits a record, can I prove it happened?"**

That single question reorganizes everything on this page:

- **Tamper-evidence** — hash chains and signatures so deletion or edit is *detectable*, even by someone with full write access.
- **Tamper-resistance** — WORM storage (S3 Object Lock, Azure immutable blobs) so the write physically cannot be undone, even by an admin.
- **Retention and legal hold** — the regimes (SOC 2, HIPAA, PCI DSS, GDPR) that dictate *how long* and the legal mechanisms that override your own deletion logic.
- **The GDPR collision** — "erase this person" versus "never modify the audit log," and how you satisfy both.
- **Volume** — a busy system emits millions of audit events a day; the integrity machinery cannot cost you 40% of your write throughput.

> 🎓 **Why this matters for a senior:** Anyone can append JSON to a file. The senior builds the trail that holds up when it is *adversarial* — a security incident, a compliance audit, a courtroom. The difference shows up exactly once, at the worst possible moment, and by then you cannot retrofit integrity onto records you already wrote unprotected. The work is done in advance or not at all.

---

## Prerequisites

What you should already have nailed:

- **Required:** All of [`middle.md`](middle.md) — stable schema, controlled-vocabulary actions, the outbox pattern, access-control append-only, correlation IDs, capture-vs-redact, delegation/OBO.
- **Required:** All of [`junior.md`](junior.md) — the five W's and the separate-sink rule.
- **Required:** Cryptographic literacy — hash functions, HMAC, public-key signatures, what "collision resistance" buys you. See the `encryption-basics` skill area.
- **Required:** Key management fundamentals — KMS, key rotation, the difference between a signing key and an encryption key. See the `secrets-management` skill area.
- **Required:** Comfort with at least one cloud object store's immutability features (S3 Object Lock, GCS retention, Azure immutable blobs).
- **Helpful:** Exposure to one compliance audit (SOC 2 Type II evidence collection, a PCI assessment, a HIPAA risk assessment).
- **Helpful:** Understanding of distributed time — NTP, clock skew, why "the timestamp" is not as simple as it looks.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Tamper-evidence** | The property that *modification is detectable*. You may not prevent the edit, but you can prove it happened. The realistic goal for software-only systems. |
| **Tamper-resistance / tamper-proof** | The property that modification is *prevented*. Requires hardware (HSM, WORM media) or contractual storage controls; software alone cannot achieve it. |
| **Hash chain** | A sequence where each record stores the hash of the previous record plus its own content. Deleting or editing any record breaks the chain from that point forward. |
| **Merkle tree** | A tree of hashes that lets you prove a single record's inclusion in a large set without rehashing everything. The structure behind certificate transparency and Git. |
| **Append-only ledger** | A store that supports insert but not update/delete *and* makes tampering detectable (chain or signature). Stronger than middle-level access-control append-only. |
| **WORM** | Write Once Read Many — storage that physically or contractually forbids modification after write. S3 Object Lock, Azure immutable blobs, optical/tape WORM media. |
| **Object Lock (S3)** | AWS S3 feature: `GOVERNANCE` (privileged users can override) or `COMPLIANCE` (no one, including root, can delete before retention expires) retention modes. |
| **Legal hold** | A mandate to preserve records relevant to litigation/investigation, *overriding* normal retention/deletion — indefinitely, until released. |
| **Retention period** | How long records must be kept. Set by regulation (PCI: 1 year, HIPAA: 6 years, SOX: 7 years) or policy. |
| **HSM** | Hardware Security Module — tamper-resistant hardware that holds signing keys so the key material never leaves it. |
| **Notarization** | Periodically committing a hash of your log's state to an external, trusted, append-only authority (a transparency log, a blockchain, a vendor) so you can't rewrite history undetectably. |
| **Anchoring** | Publishing a checkpoint hash to an immutable external system; a specific form of notarization. |
| **Pseudonymization** | Replacing direct identifiers with a reversible token whose mapping is held separately (GDPR Art. 4(5)). Erasing the mapping severs the link to the person while keeping the record. |
| **Crypto-shredding** | Encrypting per-subject data with a per-subject key, then deleting the key to render the data unrecoverable — "erasure" without modifying the ciphertext. |
| **Chain of custody** | A documented, unbroken record of who handled evidence and when — the standard a courtroom expects of an audit trail. |
| **Sequence number** | A monotonically increasing counter per stream that makes gaps (deleted records) detectable independently of timestamps. |

---

## Core Concepts

### 1. Append-only is not tamper-evident

This is the single most important correction to the middle-level model. `REVOKE UPDATE, DELETE FROM app_role` stops *the application* from modifying the log. It does precisely nothing against the `postgres` superuser, a backup that gets restored over the table, a DBA running ad-hoc SQL, or an attacker who escalated to the DB owner. Middle-level append-only is an integrity control against *bugs*. Senior-level tamper-evidence is an integrity control against *people*. They are different threat classes and require different mechanisms.

### 2. You almost never get tamper-*proof*; you engineer tamper-*evident*

True tamper-proofing requires that no one — not your most privileged admin — can alter a record. In software-only systems that is impossible: whoever controls the storage can overwrite bytes. So the realistic, honest goal is **tamper-evidence**: make any modification *detectable*. A hash chain doesn't stop a DBA from deleting row 5,000; it guarantees that when they do, the chain from 5,000 onward no longer verifies, and you can prove a record was removed even if you no longer know its contents. Detectable tampering is a deterrent and an evidentiary fact. Combine it with WORM and you approach tamper-resistance.

### 3. The audit log is itself a high-value attack target

An attacker's first move after a breach is to cover their tracks — and the audit log is the tracks. This inverts a normal design instinct: the audit store must be *more* protected than the system it audits, not equally protected. It lives on different credentials, ideally a different account/project, written by an identity that can append but not read-modify, shipped off-host fast enough that compromising the application host doesn't let you rewrite history. If the same root that owns your app owns your audit log, your audit log defends against everyone except the person most likely to attack it.

### 4. Retention is a legal parameter, not an ops preference

How long you keep audit data is frequently *dictated by law*, and getting it wrong cuts both ways. Too short and you fail an audit or destroy evidence you were obligated to keep (and "spoliation" of evidence under legal hold is itself a serious offense). Too long and you accumulate liability — every record you hold is a record that can leak, be subpoenaed, or violate a data-minimization principle. The senior treats retention as a per-regime, per-data-class policy with an enforced lifecycle, not a `cron` job someone wrote once.

### 5. Compliance regimes specify the *what*, not the *how*

PCI DSS Req. 10 lists exactly which fields a payment-system audit record must contain. HIPAA mandates audit controls for PHI access. SOC 2 wants evidence that your controls *operate*. None of them tell you to use a hash chain or S3 Object Lock — those are *your* engineering choices to satisfy the requirement. The senior reads the control, maps it to a mechanism, and — crucially — produces the **evidence** an auditor can verify, because "we have audit logging" is worthless without "and here's the report proving it ran for the whole period."

### 6. Integrity has a throughput cost you must budget

Signing every event with RSA is ~10,000× more expensive than appending a line. Hash-chaining serializes writes (each record depends on the previous one's hash). A naive design that signs-per-event synchronously will halve your write throughput and add tail latency on the request path. The senior moves integrity off the hot path: hash on write (cheap), sign in batches (a periodic checkpoint over many records), and never block the user's request on a notarization round-trip.

### 7. A missing record must be as detectable as a modified one

Tamper-evidence that only catches *edits* misses the more common attack: **deletion**. An attacker doesn't edit "I exfiltrated the database"; they delete it. Hash chains catch this (the chain breaks), but only if you can detect a *truncation* of the whole tail — which is why you also need monotonic sequence numbers and periodic external anchoring. If the last 1,000 records are simply removed and the chain re-terminated, an internal-only chain looks fine. Anchoring the chain head externally is what closes that gap.

---

## Real-World Analogies

| Concept | Real-world analogy |
|---------|--------------------|
| Hash chain | A spiral-bound notebook with sequentially numbered pages — tear one out and the gap is obvious. |
| Tamper-evident vs tamper-proof | A tamper-evident seal on medicine tells you it was opened; a bank vault stops you from opening it. Audit logs are usually seals. |
| WORM storage | Writing in permanent ink on a ledger that's then locked in a safe-deposit box you don't have the key to. |
| Legal hold | A "do not destroy" sticker on a box of files during a lawsuit, overriding the office shredding schedule. |
| Notarization / anchoring | Mailing yourself a sealed copy of a document — the postmark proves it existed by that date. |
| Insider threat | The night-shift accountant who keeps the books *and* can rewrite them. The reason double-entry exists. |
| Crypto-shredding | Burning the only key to a locked diary instead of burning the diary. |
| Sequence numbers | Pre-numbered checks — a missing check number is a question that demands an answer. |
| Chain of custody | The signature log on an evidence bag, passed hand to hand. |
| Separation of audit from ops logs | The black box flight recorder vs the pilots' chatter — one is evidence, one is operations. |

---

## Mental Models

### Model 1: The two append-onlys

There are two completely different things called "append-only," and conflating them is the classic senior-interview trap.

```text
   ACCESS-CONTROL APPEND-ONLY          CRYPTOGRAPHIC TAMPER-EVIDENCE
   (middle level)                      (senior level)
   ┌──────────────────────────┐        ┌──────────────────────────┐
   │ REVOKE UPDATE, DELETE     │        │ each record hashes the    │
   │ from the APP role         │        │ previous one (a chain)    │
   ├──────────────────────────┤        ├──────────────────────────┤
   │ Defends against: BUGS     │        │ Defends against: PEOPLE   │
   │ Defeated by: any DBA,     │        │ Defeated by: nobody —     │
   │ superuser, restored backup│        │ tampering is DETECTABLE   │
   │ "app can't modify it"     │        │ "edits/deletes are PROVEN"│
   └──────────────────────────┘        └──────────────────────────┘
```

You want both. Access control keeps honest code honest; the chain makes a dishonest *person* detectable.

### Model 2: Defense in depth, ranked by who it stops

Order your integrity controls by the strength of adversary they defeat. Each layer stops a more privileged attacker than the last.

```text
   App can't UPDATE/DELETE        stops a buggy or careless application
        │
        ▼
   Hash chain over records         stops a DBA editing one row in place
        │
        ▼
   Off-host shipping (fast)        stops an attacker who owns the app host
        │
        ▼
   WORM / Object Lock (COMPLIANCE) stops your own root / admin
        │
        ▼
   External anchoring/notarization stops YOU (the whole org) rewriting history
```

The senior consciously decides *how far down this ladder the threat model requires going*. A SOC 2 trust-services audit may stop at WORM; an exchange handling regulated trades anchors externally; a hospital satisfies HIPAA with WORM + chain.

### Model 3: Retention as a state machine, not a duration

A record doesn't simply "expire after 7 years." It moves through states, and a legal hold can freeze it at any point.

```text
   WRITTEN ──► RETAINED (under policy clock) ──► ELIGIBLE-FOR-DELETION ──► DELETED
                   │                                   ▲
                   │  legal hold placed                │  hold released
                   ▼                                   │
                ON-HOLD ──────────────────────────────┘  (clock paused, deletion blocked)
```

Modeling retention as states (and persisting the hold flag) is what stops the 2 a.m. lifecycle job from deleting records that a court ordered preserved.

---

## The Threat Model: Who Are You Defending Against?

You cannot design integrity controls without naming the adversary. "Make it secure" is not a spec. Enumerate explicitly:

| Adversary | Capability | What defeats them |
|-----------|-----------|-------------------|
| **Buggy application** | Can run whatever the app role permits | Access-control append-only (middle level) |
| **Careless engineer** | Ad-hoc SQL, accidental `DELETE` | App-role restrictions + chain (the delete shows) |
| **Malicious insider (app-level)** | Can call your APIs, impersonate users | Delegation capture + signed events + separation of duties |
| **Malicious DBA / superuser** | Full `UPDATE`/`DELETE` on the DB | Hash chain (detect edits) + off-host shipping + WORM |
| **Compromised host (root)** | Owns the app server, its creds | Append-only credentials + fast off-host ship + write-only identity |
| **Compromised audit infra** | Owns the audit store | External anchoring/notarization + WORM with COMPLIANCE mode |
| **The organization itself** | Wants to rewrite its own history (fraud, coverup) | External notarization to a third party / transparency log |

The decision you must make — and *document* — is the **highest adversary in this list your design defends against.** Most software-only systems honestly defend up to "malicious DBA," because a true root with WORM-`GOVERNANCE` can still override. Pretending you defend against the org itself when you only have an internal hash chain is the dangerous lie. Be precise: *"Our audit trail is tamper-evident against any single insider including the DBA, via hash chain + S3 Object Lock COMPLIANCE; it is not tamper-evident against a collusion that also controls the AWS root account and KMS — that would require external anchoring, which we have chosen not to implement."* That sentence is what a senior writes in the design doc.

> **The insider problem is the whole point.** Audit logs exist primarily to catch the trusted party. Your CFO, your admin, your support agent — the people *with* access are exactly who the log must record and constrain. A control that the most powerful insider can silently bypass is theater. This is why separation of duties (the person who can act cannot also delete the record of acting) is the organizing principle, not a nice-to-have.

---

## Tamper-Evidence I — Hash Chains

The core technique. Each record carries the hash of the previous record, so the records form a chain. Edit or delete any record and every subsequent hash no longer matches — the tampering is detectable, and you can pinpoint *where* it happened.

```text
   record 1                 record 2                 record 3
   ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
   │ seq: 1           │     │ seq: 2           │     │ seq: 3           │
   │ prev_hash: 000…  │     │ prev_hash: H(1)  │ ◄── │ prev_hash: H(2)  │ ◄── …
   │ payload: {...}   │     │ payload: {...}   │     │ payload: {...}   │
   │ hash: H(1)       │────►│ hash: H(2)       │────►│ hash: H(3)       │
   └──────────────────┘     └──────────────────┘     └──────────────────┘
        H(n) = SHA-256( seq || prev_hash || canonical(payload) )
```

The properties that make this work:

- **`prev_hash` binds order.** Reordering records breaks verification.
- **`hash` covers the payload.** Editing any field changes the record's hash, which breaks every downstream `prev_hash`.
- **Deleting a middle record** leaves record *n+1*'s `prev_hash` pointing at a hash that no longer exists in the chain — detected on the next full verification.
- **A canonical serialization is mandatory.** `{"a":1,"b":2}` and `{"b":2,"a":1}` are the same object but different bytes and thus different hashes. You must serialize deterministically (sorted keys, no insignificant whitespace) or verification fails on re-serialization. This is the #1 hash-chain bug.

### Implementation, Go

```go
package ledger

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// genesis is the well-known starting hash for an empty chain.
const genesis = "0000000000000000000000000000000000000000000000000000000000000000"

type Record struct {
	Seq      uint64          `json:"seq"`
	PrevHash string          `json:"prev_hash"`
	Payload  json.RawMessage `json:"payload"` // the full audit event, already canonicalized
	Hash     string          `json:"hash"`    // computed, not supplied by the caller
}

// computeHash hashes seq || prev_hash || payload. The payload MUST already be
// canonical JSON (sorted keys) — see canonicalJSON below — or verification
// will fail when the record is re-read and re-hashed.
func computeHash(seq uint64, prevHash string, payload json.RawMessage) string {
	h := sha256.New()
	fmt.Fprintf(h, "%d\n%s\n", seq, prevHash)
	h.Write(payload)
	return hex.EncodeToString(h.Sum(nil))
}

// Append builds the next record given the previous one's hash and sequence.
func Append(prevSeq uint64, prevHash string, payload json.RawMessage) Record {
	seq := prevSeq + 1
	if prevSeq == 0 {
		prevHash = genesis
	}
	return Record{
		Seq:      seq,
		PrevHash: prevHash,
		Payload:  payload,
		Hash:     computeHash(seq, prevHash, payload),
	}
}

// Verify walks the whole chain and returns the first seq where it breaks, or 0
// if the chain is intact. This is what you run during an audit or on alarm.
func Verify(records []Record) (brokenAt uint64, ok bool) {
	expectedPrev := genesis
	for i, r := range records {
		expectedSeq := uint64(i + 1)
		if r.Seq != expectedSeq {
			return r.Seq, false // a gap: a record was deleted or sequence skipped
		}
		if r.PrevHash != expectedPrev {
			return r.Seq, false // chain link broken: prior record altered/removed
		}
		if r.Hash != computeHash(r.Seq, r.PrevHash, r.Payload) {
			return r.Seq, false // this record's own payload was edited in place
		}
		expectedPrev = r.Hash
	}
	return 0, true
}
```

```go
// canonicalJSON re-encodes with sorted keys so the same logical event always
// hashes to the same bytes. encoding/json sorts map keys; for structs, define
// fields in a stable order and avoid maps with nondeterministic iteration.
func canonicalJSON(v any) (json.RawMessage, error) {
	// json.Marshal sorts map[string]... keys deterministically as of Go 1.12+.
	b, err := json.Marshal(v)
	return json.RawMessage(b), err
}
```

> The genesis hash and the sequence number together defeat the truncation attack *at the head*: if an attacker deletes the first N records and re-genesis-es the chain, the sequence numbers no longer start where your external checkpoint says they should. Without the sequence and an external anchor, a fully-rewritten chain verifies cleanly — which is why hash chains alone are necessary but not sufficient.

### Implementation, Python (with a DB trigger doing the chaining)

You can also enforce chaining *in the database*, so even direct SQL inserts get chained — the application can't forget.

```sql
-- PostgreSQL: a trigger that computes prev_hash + hash on every insert.
-- The app inserts payload only; the DB binds the chain. UPDATE/DELETE revoked.
CREATE TABLE audit_ledger (
    seq        BIGSERIAL PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    payload    JSONB NOT NULL,
    prev_hash  TEXT NOT NULL,
    hash       TEXT NOT NULL
);

CREATE OR REPLACE FUNCTION chain_audit() RETURNS trigger AS $$
DECLARE
    last_hash TEXT;
BEGIN
    SELECT hash INTO last_hash FROM audit_ledger ORDER BY seq DESC LIMIT 1;
    IF last_hash IS NULL THEN
        last_hash := repeat('0', 64);
    END IF;
    NEW.prev_hash := last_hash;
    -- digest() requires pgcrypto. Canonicalize JSONB first (jsonb is unordered;
    -- ::text gives a stable representation per Postgres version — pin it).
    NEW.hash := encode(
        digest(NEW.seq::text || E'\n' || NEW.prev_hash || E'\n' || NEW.payload::text, 'sha256'),
        'hex');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_chain_audit BEFORE INSERT ON audit_ledger
    FOR EACH ROW EXECUTE FUNCTION chain_audit();

-- The chain depends on serial insertion. Concurrent inserts must serialize on
-- the tail read — wrap the insert path so only one writer extends the chain at
-- a time (advisory lock), or accept a single audit-writer process.
```

```python
import hashlib, json, psycopg2

def verify_chain(cur) -> tuple[int, bool]:
    """Walk audit_ledger in seq order, recompute each hash, find the first break."""
    cur.execute("SELECT seq, prev_hash, hash, payload FROM audit_ledger ORDER BY seq")
    expected_prev = "0" * 64
    for seq, prev_hash, stored_hash, payload in cur:
        if prev_hash != expected_prev:
            return seq, False
        material = f"{seq}\n{prev_hash}\n{json.dumps(payload, separators=(',', ':'), sort_keys=True)}"
        # NOTE: must match the DB's canonicalization exactly — see Tricky Points.
        if hashlib.sha256(material.encode()).hexdigest() != stored_hash:
            return seq, False
        expected_prev = stored_hash
    return 0, True
```

> **The cross-language canonicalization trap is real.** If the trigger hashes Postgres's `jsonb::text` rendering and your Python verifier hashes `json.dumps(..., sort_keys=True)`, the byte streams differ and verification fails on *valid* records. Pick one canonical form — ideally hash a normalized string the application produces *before* insert — and have every verifier use it. AWS QLDB and Google's Trillian exist partly to take this footgun away from you.

### Concurrency: the chain serializes writes

A hash chain is inherently sequential — record *n+1* needs *n*'s hash. Under concurrent writers you must serialize the *tail extension*: a single audit-writer goroutine/process fed by a queue, an advisory lock around the read-tail-then-insert, or a Merkle tree that batches per interval and only chains the batch roots. Do not let two writers read the same tail hash and produce two records both claiming the same `prev_hash` — that forks the chain and breaks verification. The outbox-relay pattern from middle level naturally gives you a single serial writer; lean on it.

---

## Tamper-Evidence II — Signing and Notarization

Hashing proves *internal consistency* — that the chain hasn't been edited *given* you trust the stored hashes. But an attacker who rewrites the whole chain (records and hashes together) produces a perfectly consistent forgery. Two mechanisms close that:

### Signing

Sign records (or, far more cheaply, periodic chain checkpoints) with a private key held in an HSM/KMS. Now forging the chain requires the signing key, which never leaves the HSM. An attacker with DB access can rewrite hashes but cannot produce valid signatures.

```go
// Sign a checkpoint (the chain head) every N records or every T seconds.
// Signing per-record is usually too expensive; checkpoint signing covers a
// whole batch with one signature because the head hash commits to all of it.
type Checkpoint struct {
	UpToSeq   uint64 `json:"up_to_seq"`
	HeadHash  string `json:"head_hash"`  // hash of record UpToSeq
	Timestamp string `json:"timestamp"`
	Signature []byte `json:"signature"`  // KMS/HSM signature over the above
}

func signCheckpoint(ctx context.Context, kms KMSSigner, upTo uint64, head string) (Checkpoint, error) {
	cp := Checkpoint{UpToSeq: upTo, HeadHash: head, Timestamp: time.Now().UTC().Format(time.RFC3339Nano)}
	material := fmt.Sprintf("%d|%s|%s", cp.UpToSeq, cp.HeadHash, cp.Timestamp)
	sig, err := kms.Sign(ctx, material) // private key never leaves the HSM
	cp.Signature = sig
	return cp, err
}
```

Because the head hash commits to the entire chain below it (each record hashes the previous), **one signature over the head certifies every record up to that sequence.** Sign a checkpoint per minute and you've bounded any forgery to the records since the last signed checkpoint — and even those are protected if you also notarize.

### Notarization / External anchoring

Periodically publish the signed checkpoint to an *external, independent, append-only* authority — a transparency log, a notary service, or (where the threat model demands defending against the org itself) a public blockchain. Now even your own root cannot rewrite history before the last anchor, because the proof of what the chain looked like at time T lives somewhere you don't control.

| Mechanism | Defends against | Cost / friction |
|-----------|----------------|-----------------|
| Internal hash chain | Single insider editing one record | ~free; SHA-256 per write |
| KMS/HSM-signed checkpoints | Whole-chain rewrite without the key | KMS calls per checkpoint; key lifecycle |
| External notary / transparency log | The audit-infra admin | Network round-trip per anchor; vendor trust |
| Public blockchain anchoring | The whole organization | Cost + latency per anchor; operational weight |
| **AWS QLDB / Azure Confidential Ledger / Google Trillian** | Managed: chain + signing built in | Vendor lock-in; managed correctness |

> The pragmatic default for most companies: **hash chain (cheap, on every write) + KMS-signed checkpoints every minute + the checkpoint shipped to a separate account's WORM bucket.** That defends up to and including a malicious DBA and a compromised app host, which is the honest ceiling for a software-only system, and it's verifiable in a SOC 2 audit. Reach for external blockchain anchoring only when "the organization itself" is genuinely in your threat model (financial exchanges, evidence custody, regulated voting).

---

## Tamper-Resistance — WORM and Immutable Storage

Hash chains make tampering *detectable*. WORM makes it *impossible* (within the storage's guarantee) — the write physically cannot be undone before its retention expires, even by an administrator. This is the layer that stops your own root.

| Store | Immutability mechanism | Strongest guarantee |
|-------|------------------------|---------------------|
| **AWS S3 Object Lock** | `COMPLIANCE` mode | *No one*, including the root account, can delete or overwrite before retention expires. `GOVERNANCE` mode lets privileged users override — weaker. |
| **AWS S3 Glacier Vault Lock** | Locked vault policy | Once locked, the policy itself is immutable. For long-term archive. |
| **Azure Blob immutable storage** | Time-based retention / legal hold | Container-level WORM; legal hold blocks deletion indefinitely. |
| **GCS Bucket Lock** | Retention policy lock | Once the policy is locked, retention can't be shortened. |
| **Specialized WORM** | EMC Centera, NetApp SnapLock, optical/tape | Hardware/firmware-enforced; the classic compliance archive. |

The crucial distinction is **COMPLIANCE vs GOVERNANCE** mode (S3) and its equivalents:

- **GOVERNANCE**: an admin with the `s3:BypassGovernanceRetention` permission can still delete. Defends against accident and most insiders, *not* the determined privileged one.
- **COMPLIANCE**: deletion is impossible until retention expires — full stop, even for the root account, even for AWS support (short of legal process against AWS). This is what you choose when the threat model includes your own administrators.

```bash
# Create a bucket with Object Lock enabled (must be at creation time).
aws s3api create-bucket --bucket acme-audit-vault --object-lock-enabled-for-bucket

# Default retention: 7 years, COMPLIANCE mode — not even root deletes early.
aws s3api put-object-lock-configuration --bucket acme-audit-vault \
  --object-lock-configuration '{
    "ObjectLockEnabled": "Enabled",
    "Rule": {"DefaultRetention": {"Mode": "COMPLIANCE", "Years": 7}}
  }'

# Writing an audit segment: it is now immutable for 7 years.
aws s3api put-object --bucket acme-audit-vault \
  --key "2026/06/11/audit-segment-000123.ndjson.gz" \
  --body segment.ndjson.gz
```

> **Real failure story — the spoofed lifecycle deletion.** A fintech enforced "append-only" with a DB `REVOKE` and felt safe. During an incident, an attacker who had escalated to the DB owner didn't `UPDATE` anything (which review might catch) — they simply `DROP`ped a partition of the audit table and the application kept running. There was no chain, no WORM, and the backups had already rotated past the window. The deletion was undetectable and unrecoverable; the post-mortem couldn't say *what* had been removed. The fix that shipped: hash-chain the events, write minute-batched segments to S3 Object Lock COMPLIANCE in a separate AWS account, and sign the checkpoints with KMS. Total added write latency: under 2 ms (the chain hash), because signing and S3 shipping happen off the request path in the relay.

WORM is not a substitute for the hash chain — it's the complement. WORM stops deletion *within its retention window in that store*; the chain proves *across stores and after expiry* that nothing was altered. You use both: chain on write, ship signed segments to WORM.

---

## Retention, Legal Hold, and the Compliance Regimes

Retention is where engineering meets law. The numbers are not yours to choose; the mechanism is.

### The regimes you'll actually meet

| Regime | Scope | Audit-log requirement (essence) | Typical retention |
|--------|-------|--------------------------------|-------------------|
| **PCI DSS** (Req. 10) | Cardholder data environments | Log all access to cardholder data and admin actions; specific fields enumerated; daily review | **1 year** (3 months immediately available) |
| **HIPAA** (Security Rule §164.312(b)) | Protected Health Information | Audit controls recording PHI access; tie access to a person | **6 years** (documentation retention) |
| **SOX** (§802) | Financial reporting (public co.) | Integrity of financial records & access | **7 years** |
| **SOC 2** (Trust Services) | Service orgs (Type II) | *Evidence the controls operate over the period*; logging is a control | Per policy (commonly 1 year+); auditor wants the *whole* period |
| **GDPR** | EU personal data | Lawful basis to keep; data minimization; right to erasure | *As short as the purpose allows* (tension with the above) |
| **FedRAMP / NIST 800-53** (AU family) | US federal systems | Detailed AU-2..AU-12 audit controls, protection, retention | Often **3 years** |

Two senior insights cut across all of them:

1. **SOC 2 is about *evidence the control ran*, not the control's existence.** An auditor will ask: "Show me that audit logging was operating for all twelve months, including the week your log shipper was broken." If you have a gap, you have a finding. So you monitor the *audit pipeline itself* (a missing-heartbeat alert, a daily completeness check) and keep the evidence. "We have audit logging" is not auditable; "here is the daily integrity-verification report for every day of the period" is.

2. **PCI Req. 10 is the most prescriptive — read it as a checklist.** It literally enumerates required fields (user ID, event type, date/time, success/failure, origination, affected resource) and demands log integrity (file-integrity monitoring or equivalent — i.e. your hash chain). It's the cleanest regime to engineer against because it tells you exactly what "done" means.

### Legal hold overrides everything

A legal hold is a directive to *preserve* records relevant to litigation or investigation, and it **overrides your retention deletion** — indefinitely, until released. Destroying records under hold is *spoliation of evidence*, which can carry adverse-inference sanctions or criminal exposure. The engineering consequence:

- Your deletion lifecycle must **check a hold flag before deleting anything.**
- Holds are placed *per subject / per matter*, often broadly ("all records touching customer X or project Y").
- S3 Object Lock and Azure immutable storage have a *legal-hold* primitive separate from time-based retention precisely for this — a legal hold blocks deletion with no expiry until explicitly removed.

```python
# The retention job that DOESN'T cause a spoliation incident.
def purge_expired(store, registry):
    for segment in store.list_eligible_for_deletion():       # past retention clock
        if registry.under_legal_hold(segment.subject_ids):   # <-- the check that saves you
            log.info("retain.held", segment=segment.id, reason="legal_hold")
            continue
        if not store.integrity_ok(segment):                  # never delete what you can't verify
            alert("integrity.fail.before.purge", segment=segment.id)
            continue
        store.delete(segment)                                # only now
        log.info("retention.purge", segment=segment.id)      # the deletion is itself audited
```

> Note that the deletion itself is an audited action. "We deleted segment X on date Y per retention policy Z" is exactly the kind of event a future auditor wants to see — proving deletion was *policy-driven*, not a coverup.

---

## The GDPR vs Immutability Collision

The hardest design conflict in audit logging, and a guaranteed senior-interview question: **GDPR Article 17 grants a "right to erasure" — but audit logs must be immutable and are often *required* by other law to be retained.** You cannot both erase a person from an immutable record and keep the immutable record. How do you satisfy both?

You don't resolve it by deleting audit records. You resolve it by ensuring the audit record never contained *erasable personal data* in the first place, only a *reference* you can sever. Three techniques, in order of preference:

### 1. Pseudonymization (store a token, not the person)

The audit event stores a subject *token*, not the name/email/SSN. The token→identity mapping lives in a separate, *mutable* store. On an erasure request, you delete the mapping. The audit record is untouched and still verifies ("subject `tok_9f3a` did X at 14:02"), but the link back to the real human is gone. GDPR's recitals explicitly bless pseudonymization as a mitigation, and erasure of the *link* satisfies the spirit while the immutable record (and the hash chain) survives intact.

```text
   AUDIT LEDGER (immutable, hash-chained)      IDENTITY MAP (mutable, erasable)
   ┌─────────────────────────────────────┐     ┌──────────────────────────────┐
   │ subject: tok_9f3a                   │     │ tok_9f3a → alice@example.com  │ ◄─ erase THIS
   │ action: account.export              │     │ tok_2b7c → bob@example.com    │    on request
   │ time: 2026-06-11T14:02:09Z          │     └──────────────────────────────┘
   │ hash: …  prev_hash: …               │      After erasure: tok_9f3a → (deleted)
   └─────────────────────────────────────┘      The audit record still verifies;
        record NEVER modified                    it just no longer resolves to a person.
```

### 2. Crypto-shredding (encrypt per-subject, then delete the key)

Where the audit record genuinely must contain subject data (some regimes require the *content* of the access), encrypt that field with a *per-subject key*. To "erase," delete the subject's key. The ciphertext stays byte-for-byte identical (the hash chain is undisturbed), but it's now permanently unreadable — which most DPAs accept as erasure-equivalent ("rendered inaccessible").

```python
# Crypto-shredding: per-subject key, deletable, leaves the record immutable.
def write_audit_with_shreddable_pii(event: dict, subject_id: str, keyring) -> dict:
    key = keyring.get_or_create(subject_id)             # per-subject DEK in KMS
    event["pii_blob"] = aes_gcm_encrypt(key, event.pop("pii"))  # encrypt in place
    return event  # the ledger stores ciphertext; chain hashes the ciphertext

def erase_subject(subject_id: str, keyring):
    keyring.destroy(subject_id)  # delete the key → all that subject's PII is now unrecoverable
    # No audit record was modified. Every hash still verifies. The data is gone.
```

### 3. Lawful-basis exemption (sometimes you simply keep it)

GDPR's right to erasure is **not absolute** (Art. 17(3)). Where you have a *legal obligation* to retain (e.g. anti-money-laundering, tax, PCI), or the data is needed to establish/defend legal claims, you may lawfully refuse erasure of those specific records. The senior move is to *document the lawful basis per data class* so that when the erasure request arrives, you can answer "the account-export audit log is retained under our AML obligation for 5 years" with a citation — not improvise.

> The wrong answer — and the one that fails the interview — is "delete the audit records for that user." That destroys the trail's integrity (breaks the chain) and often violates a retention obligation. The right answer is **separate the person from the record**: pseudonymize, crypto-shred, or invoke a documented lawful basis. Design for this *before* the first erasure request, because retrofitting pseudonymization onto records that already embedded raw PII is a migration nightmare.

---

## Volume and Performance at Scale

A busy system emits audit events at a rate that makes naive designs fall over. A 10k-RPS service where every request touches one auditable resource is ~860 million events/day. The integrity machinery must not become the bottleneck.

### Where the costs hide

| Operation | Relative cost | Senior mitigation |
|-----------|---------------|-------------------|
| Append a line | 1× (baseline) | — |
| SHA-256 hash a record | ~1–2× | Cheap; do it on every write |
| Serialize canonically | ~2× | Do once, reuse for hash + store |
| HMAC | ~3× | Fine per-record if needed |
| RSA-2048 sign | ~1000–10000× | **Never per-record** — sign checkpoints/batches |
| Synchronous write to remote WORM | network RTT | Off the request path (relay) |
| External notarization round-trip | 10–100ms+ | Batch; never on the hot path |

### The architecture that scales

```text
   REQUEST PATH (must stay fast)              ASYNC PATH (integrity + durability)
   ┌──────────────────────────────┐          ┌──────────────────────────────────┐
   │ business action               │          │ relay reads outbox in seq order   │
   │   ↓ (same DB tx)              │          │   ↓                              │
   │ INSERT audit_outbox + hash    │ ───────► │ batch N records → segment         │
   │   (SHA-256 only: ~µs)         │          │   ↓                              │
   │ COMMIT, return to user        │          │ sign segment head (KMS, 1 sig)    │
   └──────────────────────────────┘          │   ↓                              │
                                              │ ship segment → S3 Object Lock     │
                                              │   ↓                              │
                                              │ anchor checkpoint (periodic)      │
                                              └──────────────────────────────────┘
```

The user's request pays only for the **hash** (microseconds) and a normal DB insert. Signing, batching, WORM shipping, and notarization all happen in the relay, off the hot path. This is the key senior decision: **integrity cost belongs in the async tier, not the request tier.**

### Partitioning and indexing for write-heavy, read-rarely-but-critically

- **Time-partition the store** (daily/monthly). Old partitions roll to cold WORM storage; queries during an investigation hit a known partition range.
- **Index for the forensic queries**, not for writes: `(actor_id, time)`, `(resource_type, resource_id, time)`, `(action, time)`. Audit tables are insert-heavy and read-rarely, but the rare read is during an incident or audit when you cannot afford a full scan.
- **Compress segments** before WORM (`.ndjson.gz`) — audit events are highly compressible (repeated field names, similar actions); 10–20× is typical.
- **Sample? Never.** This is the one telemetry stream you must not sample. See [`../telemetry-cost-and-sampling-strategy/`](../telemetry-cost-and-sampling-strategy/) — audit events are the explicit exception. A sampled audit log is a worthless audit log.

### Cost reality

At 860M events/day × ~500 bytes ≈ 430 GB/day raw, ~30 GB/day compressed. Over a 7-year retention that's ~75 TB in cold WORM storage — at S3 Glacier rates, a few hundred dollars a month. The dominant cost is usually not storage but **query/restore** during an investigation and the engineering to keep the pipeline verified. Budget retrieval, not just storage.

---

## Separating Audit From Operational Logs — For Real

Middle level said "audit goes to a separate sink." Senior level makes that separation *enforced and adversary-resistant*, because the reasons are no longer stylistic — they're about retention, integrity, and blast radius.

| Property | Operational logs | Audit log |
|----------|------------------|-----------|
| **Purpose** | Debug, observe, alert | Prove who did what; compliance evidence |
| **Retention** | Days to weeks (cost-driven) | Years (law-driven) |
| **Sampling** | Aggressively sampled | **Never sampled** |
| **Mutability** | Rotated, dropped, edited freely | Immutable, hash-chained |
| **Schema stability** | Loose; changes constantly | Stable for years; versioned |
| **Access** | Broad (every engineer) | Tight (write-append, read-restricted, separate creds) |
| **Failure mode on write fail** | Drop the line, move on | Fail closed or alert loudly — *never silent* |
| **Storage location** | Same observability stack | Separate account/project, WORM-backed |

The concrete senior practices that make the separation real:

- **Different credentials and ideally a different cloud account/project.** If owning your app host lets you also rewrite the audit log, you have one blast radius, not two. The audit account grants the app *append-only, write-only* access (it can `s3:PutObject` but not `s3:DeleteObject`, not `s3:GetObject`).
- **A different pipeline, not a tap off the log pipeline.** If audit events flow through the same Fluent Bit/Vector pipeline that samples and drops under backpressure, your "never sampled" guarantee is a lie. Audit gets its own durable path (the outbox + relay), not a `severity=audit` filter on the shared stream.
- **The SIEM is a *copy*, not the system of record.** Fan out to Splunk/ELK for real-time alerting, but the durable, immutable, hash-chained store is the source of truth. SIEMs age data out and can drop under load; they are for *search*, not *retention*.

> Why this matters more at senior level: the failure mode of merging them is *silent* and *delayed*. Everything works for two years, then a compliance audit asks for records from month 7, and you discover the shared log pipeline sampled them away or the retention rotated them out. There is no fixing it after the fact. The separation is insurance you buy before the fire.

---

## Time, Ordering, and Trustworthy Timestamps

"When" is one of the five W's, and at senior level "when" is harder than it looks.

- **Whose clock?** The event timestamp is the *server's* recording time, which can skew across hosts. For ordering, trust the **sequence number** (monotonic, gap-detecting), not the timestamp. Two events one millisecond apart on two hosts can record out of order; the sequence number cannot.
- **Clock skew is an attack surface.** An attacker who can move a host's clock can make an event appear to have happened before it did — backdating an action to before a control was in place. Mitigations: NTP discipline with monitoring (alert on skew > threshold), and for high-stakes events, a **trusted timestamp** from an external Time Stamping Authority (RFC 3161) that signs "this hash existed by this time."
- **Sequence numbers detect gaps the chain might survive.** A monotonic per-stream sequence makes a deleted record show up as a missing number even if an attacker rebuilt the chain locally. `…, 4471, 4473, …` — where's 4472? That question is the whole value.
- **Distributed ordering across streams** (multiple writers, multiple regions) needs either a single serial writer per stream or a logical clock; do not assume wall-clock timestamps give you a global order. For most audit systems, a per-stream sequence plus the per-stream chain is enough; you rarely need a *global* total order, only a *per-resource* one.

```text
   TRUST FOR ORDERING:   sequence number  >  hash chain link  >  wall-clock timestamp
   TRUST FOR "when":      RFC 3161 TSA     >  NTP-synced server clock  >  client-supplied time
                          (signed, external)   (monitored skew)            (never trust)
```

---

## Code Examples

### Go — the full senior write path (chain on write, sign + WORM in relay)

```go
// Request-path write: hash-chain the event inside the business transaction.
// Cheap (SHA-256 only); the signing and WORM shipping happen in the relay.
func (a *Auditor) Record(ctx context.Context, tx DBTX, e Event) error {
	if e.Outcome == "" || e.Actor.ID == "" || e.Action == "" {
		return ErrIncompleteEvent // a chokepoint that refuses half-records
	}
	payload, err := canonicalJSON(e) // sorted-key, deterministic bytes
	if err != nil {
		return err
	}
	// Read the tail under an advisory lock so the chain doesn't fork under concurrency.
	var prevSeq uint64
	var prevHash string
	if err := tx.QueryRowContext(ctx, `
		SELECT seq, hash FROM audit_ledger ORDER BY seq DESC LIMIT 1
		FOR UPDATE`).Scan(&prevSeq, &prevHash); err == sql.ErrNoRows {
		prevHash = genesis
	} else if err != nil {
		return err
	}
	rec := Append(prevSeq, prevHash, payload) // computes hash
	_, err = tx.ExecContext(ctx, `
		INSERT INTO audit_ledger (seq, prev_hash, hash, payload, shipped)
		VALUES ($1,$2,$3,$4,false)`,
		rec.Seq, rec.PrevHash, rec.Hash, rec.Payload)
	return err
}
```

```go
// Relay: batches records into a segment, signs the segment head with KMS,
// writes to S3 Object Lock (COMPLIANCE), marks shipped. Off the request path.
func (r *Relay) shipBatch(ctx context.Context) error {
	recs, err := r.readUnshipped(ctx, 1000) // seq order
	if err != nil || len(recs) == 0 {
		return err
	}
	segment := encodeNDJSONGzip(recs)
	head := recs[len(recs)-1]
	cp, err := signCheckpoint(ctx, r.kms, head.Seq, head.Hash) // ONE signature per batch
	if err != nil {
		return err
	}
	key := fmt.Sprintf("%s/segment-%012d.ndjson.gz", time.Now().UTC().Format("2006/01/02"), head.Seq)
	if err := r.s3.PutObjectImmutable(ctx, key, segment); err != nil { // Object Lock bucket
		return err // do NOT mark shipped — retry; at-least-once, dedup by seq
	}
	if err := r.notary.Anchor(ctx, cp); err != nil { // external checkpoint (periodic)
		log.Warn("anchor failed, will retry", "up_to", cp.UpToSeq, "err", err)
	}
	return r.markShipped(ctx, head.Seq)
}
```

### Java — verifying a chain during an audit

```java
/** Walks the persisted ledger, recomputes hashes, returns the first broken seq. */
public final class ChainVerifier {
    private static final String GENESIS = "0".repeat(64);

    public record Result(long brokenAtSeq, boolean ok) {}

    public Result verify(Iterator<LedgerRow> rows) throws Exception {
        MessageDigest sha = MessageDigest.getInstance("SHA-256");
        String expectedPrev = GENESIS;
        long expectedSeq = 1;
        while (rows.hasNext()) {
            LedgerRow r = rows.next();
            if (r.seq() != expectedSeq) return new Result(r.seq(), false); // gap = deletion
            if (!r.prevHash().equals(expectedPrev)) return new Result(r.seq(), false);
            String computed = hex(sha.digest(
                (r.seq() + "\n" + r.prevHash() + "\n" + r.canonicalPayload())
                    .getBytes(StandardCharsets.UTF_8)));
            if (!computed.equals(r.hash())) return new Result(r.seq(), false); // edited in place
            expectedPrev = r.hash();
            expectedSeq++;
        }
        return new Result(0, true);
    }
    private static String hex(byte[] b) { /* … */ return HexFormat.of().formatHex(b); }
}
```

### Node.js — crypto-shredding a subject's PII on erasure

```js
const crypto = require("crypto");

// Encrypt PII with a per-subject key so we can "erase" by destroying the key,
// leaving the immutable audit record (and its hash) untouched.
async function writeAuditWithShreddablePII(db, kms, event, subjectId) {
  const dek = await kms.getOrCreateDataKey(`subject:${subjectId}`); // per-subject DEK
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", dek, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(event.pii), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  delete event.pii;
  event.pii_blob = { iv: iv.toString("base64"), ct: ct.toString("base64"), tag: tag.toString("base64") };
  // The ledger stores ciphertext; the hash chain hashes the ciphertext.
  return appendToLedger(db, event);
}

// GDPR erasure: destroy the key. Every ledger record stays byte-identical and
// still verifies; the subject's PII is now cryptographically unrecoverable.
async function eraseSubject(kms, subjectId) {
  await kms.destroyDataKey(`subject:${subjectId}`);
  // No audit record was modified. No chain was broken. The data is gone.
}
```

### Rust — a tamper-evident appender with a serial writer

```rust
use sha2::{Digest, Sha256};

const GENESIS: &str = "0000000000000000000000000000000000000000000000000000000000000000";

pub struct Ledger {
    last_seq: u64,
    last_hash: String, // a single owner of the tail → no chain forks
}

impl Ledger {
    /// Appends one canonical-JSON payload, returning the new record's hash.
    /// `&mut self` enforces a single serial writer at the type level.
    pub fn append(&mut self, canonical_payload: &[u8]) -> (u64, String) {
        let seq = self.last_seq + 1;
        let prev = if self.last_seq == 0 { GENESIS } else { &self.last_hash };
        let mut h = Sha256::new();
        h.update(format!("{seq}\n{prev}\n").as_bytes());
        h.update(canonical_payload);
        let hash = hex::encode(h.finalize());
        self.last_seq = seq;
        self.last_hash = hash.clone();
        (seq, hash)
    }
}
// The borrow checker makes the "two writers fork the chain" bug a compile error:
// you cannot hold two &mut Ledger at once.
```

---

## Worked Example — Proving a Record Was Deleted

**Scenario:** Three months after the fact, legal asks: *"Did anyone delete customer 4471's account on the night of the breach, and can you prove the audit trail wasn't altered to hide it?"* This is exactly the question senior audit logging exists to answer.

**Step 1 — verify the chain is intact.** Run the verifier over the relevant partition.

```text
$ audit-verify --from 2026-03-14T00:00Z --to 2026-03-15T00:00Z
verified 1,284,005 records  seq 8,840,112 .. 10,124,116
chain: INTACT   head_hash: 9f3a...   matches signed checkpoint cp-2026-03-15-0000 ✓
checkpoint signature: VALID (KMS key arn:…:key/audit-signer) ✓
external anchor: present in notary log, block 5,221,889, ts 2026-03-15T00:01:07Z ✓
```

The chain verifies, the signed checkpoint matches, and the checkpoint hash was anchored externally at 00:01 — so *no record up to seq 10,124,116 has been altered or removed*, and that fact was fixed in an external log we don't control. We can now trust whatever the trail says.

**Step 2 — query for the action.**

```sql
SELECT seq, occurred_at, payload->'actor'->>'id' AS actor,
       payload->'actor'->'on_behalf_of'->>'id' AS obo
FROM audit_ledger
WHERE payload->>'action' = 'customer.delete'
  AND payload->'resource'->>'id' = '4471'
  AND occurred_at BETWEEN '2026-03-14' AND '2026-03-15';
--   seq      | occurred_at          | actor          | obo
--  9,902,331 | 2026-03-14 02:14:51Z | u_admin_dmitri | (null)
```

**Step 3 — read the record and its correlation.** The event shows admin `dmitri` deleted account 4471 at 02:14:51, *not* on behalf of anyone, from source IP `198.51.100.7`, with `request_id=req_b22f`. Pull the operational logs and trace by `req_b22f` (middle-level correlation) — they corroborate the delete and show the session was authenticated via a token issued at 02:11.

**Step 4 — the proof statement.** Because the chain verifies against an externally-anchored signed checkpoint, you can state — to a standard a courtroom accepts — *"The audit record of this deletion exists, has not been altered since 02:14:51 on 2026-03-14, and the surrounding records have not been deleted, as proven by the unbroken hash chain whose head was notarized externally at 00:01 the next morning."*

**What made this answerable:** the chain (integrity), the sequence (no gaps), the signed checkpoint (forgery requires the HSM key), the external anchor (the org itself couldn't rewrite it), the delegation capture (we know it was dmitri, not an impersonated user), and correlation (we can reconstruct the whole request). Remove any one and the answer weakens. **The middle-level system would have shown the record — if it was still there. The senior system proves it was *never removed*.** That difference is the entire point of this level.

---

## Pros & Cons

| Decision | Option | Pros | Cons |
|----------|--------|------|------|
| **Integrity** | Hash chain only | Cheap, simple, detects edits/gaps | A whole-chain rewrite forges cleanly; needs anchoring |
| | Chain + signed checkpoints | Forgery requires the HSM key | KMS calls, key lifecycle |
| | Chain + sign + external anchor | Defends against the org itself | Cost, latency, vendor/chain trust |
| **Storage** | App-role append-only (DB) | Familiar, queryable | Defeated by any DBA/superuser |
| | S3 Object Lock GOVERNANCE | Immutable to most | Privileged user can bypass |
| | S3 Object Lock COMPLIANCE | Immutable even to root | Cannot delete *even when you legitimately need to* |
| **Erasure** | Delete the audit record | Naive "compliance" | Breaks the chain; violates retention; **wrong** |
| | Pseudonymize + erase mapping | Record immutable, person severed | Token store must be secured & erasable |
| | Crypto-shred per-subject | Record byte-identical, data gone | Per-subject key management overhead |
| **Signing** | Per-record | Maximum granularity | ~1000× cost; kills throughput |
| | Per-checkpoint (batch head) | One sig certifies a whole batch | A short forgery window since last checkpoint |
| **Timestamp** | Server clock + NTP | Free, good enough usually | Skew/backdating attack surface |
| | RFC 3161 TSA | Externally provable "when" | Per-event cost; external dependency |

---

## Use Cases

- **"Prove no audit record was deleted on the breach night."** — Chain verification against an externally-anchored signed checkpoint. The worked example above.
- **"A DBA is suspected of editing a record to hide an action."** — The hash chain breaks at the edited record; the signature doesn't match. Detectable.
- **"Pass a SOC 2 Type II audit covering the full year."** — Daily integrity-verification reports + pipeline-completeness monitoring as evidence the control ran continuously.
- **"Satisfy a GDPR erasure request without destroying the trail."** — Pseudonymize + delete the mapping, or crypto-shred the subject's key.
- **"Retain payment audit logs to PCI Req. 10 spec."** — Enumerated fields + 1-year retention + file-integrity (the chain) + daily review.
- **"Place a legal hold across all records touching a customer."** — Hold flag that overrides the retention deletion job; S3 legal-hold primitive on the segments.
- **"Audit 800M events/day without halving write throughput."** — Hash on the request path, sign + WORM-ship in the async relay.
- **"Prove an action happened *before* a certain time."** — RFC 3161 trusted timestamp over the record hash.

---

## Coding Patterns

### Pattern: hash on the hot path, sign off it

```go
// Request path: cheap hash only.
rec := Append(prevSeq, prevHash, payload) // SHA-256, microseconds
// Async relay: one expensive signature certifies a whole batch.
cp, _ := signCheckpoint(ctx, kms, head.Seq, head.Hash)
```

### Pattern: the legal-hold gate before any deletion

```python
if registry.under_legal_hold(segment.subject_ids):
    continue  # NEVER delete a held record; spoliation risk
```

### Pattern: pseudonymize at the boundary

```python
event["subject"] = subject_token(real_id)   # token enters the ledger
identity_map.put(subject_token(real_id), real_id)  # mapping in the erasable store
# Raw identity NEVER touches the immutable chain.
```

### Pattern: verify-on-a-schedule (don't wait for the audit)

```bash
# Cron the verifier daily; alert on the first broken seq. SOC 2 evidence + early warning.
audit-verify --since yesterday || page_security "audit chain broken"
```

### Pattern: single serial writer (no chain forks)

```rust
fn append(&mut self, payload: &[u8]) -> (u64, String) { /* &mut = one writer */ }
```

### Pattern: write-only audit credentials

```json
{ "Effect": "Allow", "Action": ["s3:PutObject"], "Resource": "arn:…:audit-vault/*" }
// No s3:GetObject, no s3:DeleteObject. The app appends; it cannot read or rewrite.
```

---

## Clean Code

- The chain hash is computed at a single chokepoint, never ad-hoc.
- Canonical serialization is one function, used by both writer and verifier — identical bytes or verification lies.
- A single serial writer extends the chain; concurrency is handled by the queue/lock, not hoped away.
- Signing and WORM shipping live in the relay, never on the request path.
- The retention job checks the legal-hold flag *before* every deletion, no exceptions.
- Raw PII/identity never enters the immutable store — only tokens or per-subject ciphertext.
- The audit store uses *separate, write-only* credentials, ideally a separate account.
- Chain verification runs on a schedule and its result is itself recorded (audit the auditor).
- The threat model — the highest adversary defended against — is written down in the design doc.

---

## Best Practices

1. **Hash-chain every record** and verify on a schedule; treat a broken chain as a security incident, not a bug.
2. **Sign checkpoints, not records** — one HSM/KMS signature over the chain head certifies the whole batch.
3. **Anchor externally** when your threat model includes the organization itself; otherwise WORM + signing is the honest ceiling.
4. **Write to WORM in COMPLIANCE mode** for retention that must survive your own administrators.
5. **Put the audit store on separate, write-only credentials**, ideally a separate cloud account — different blast radius from the app.
6. **Never sample audit events.** This is the one stream exempt from cost-driven sampling.
7. **Model retention as a state machine** with a legal-hold gate; never let a lifecycle job delete held records.
8. **Solve GDPR erasure by separation** (pseudonymize / crypto-shred), never by deleting audit records.
9. **Keep integrity off the hot path** — hash on write, sign and ship asynchronously.
10. **Write the threat model down.** State the highest adversary you defend against and the layer that stops them — and where you stop.
11. **Produce auditor-ready evidence** — daily verification reports, pipeline completeness — because "we have it" isn't auditable; "here's the proof it ran" is.

---

## Edge Cases & Pitfalls

- **The whole-chain rewrite.** A hash chain alone doesn't stop an attacker who rewrites every record *and* hash. Only signing (key they don't have) + external anchoring closes it. Don't claim more than the chain provides.
- **Head truncation.** Deleting the last N records and re-terminating the chain verifies cleanly internally. Sequence numbers + a periodically anchored head hash are what catch it.
- **Canonicalization mismatch.** The writer and verifier *must* serialize identically. Postgres `jsonb::text` ≠ Python `json.dumps(sort_keys=True)`. Hash a normalized application-produced string, not the DB's rendering.
- **COMPLIANCE mode you can't undo.** S3 Object Lock COMPLIANCE means *you* can't delete early either — including data you later realize you shouldn't have written (PII in the clear). Get redaction right *before* WORM, because WORM makes mistakes permanent.
- **Chain forks under concurrency.** Two writers reading the same tail hash produce two records with the same `prev_hash`. Serialize the tail extension (single writer / advisory lock).
- **Key rotation breaks verification of old signatures.** Keep retired signing keys verifiable (don't destroy them); rotate forward, verify backward. KMS key versions handle this if you don't delete them.
- **Crypto-shredding leaves the ciphertext discoverable.** A DPA might consider encrypted-but-present data not fully "erased." Confirm your jurisdiction accepts key destruction as erasure before relying on it.
- **Legal hold on COMPLIANCE-locked data.** A hold can *extend* retention but can't shorten COMPLIANCE retention. Plan retention floors carefully.
- **Clock skew backdating.** An attacker moving a host clock can backdate events. Monitor NTP skew; use sequence numbers for ordering, not timestamps.

---

## Common Mistakes

1. **Believing `REVOKE UPDATE, DELETE` is tamper-evidence.** It defends against the app, not against the DBA who runs the database.
2. **Claiming "tamper-proof" when you built "tamper-evident."** Software detects; it rarely prevents. Be honest in the design doc.
3. **Deleting audit records to satisfy GDPR erasure.** Breaks the chain, violates retention. Separate the person from the record instead.
4. **Signing every record synchronously**, halving write throughput. Sign checkpoints in the async tier.
5. **Hashing the DB's serialization in the trigger but a different serialization in the verifier**, so valid records fail verification.
6. **One blast radius** — the audit log on the same creds/account/host as the app it audits. Owning the app then owns its alibi.
7. **WORM in GOVERNANCE mode** when the threat model includes a privileged insider who has the bypass permission.
8. **No external anchor**, so a whole-chain rewrite is undetectable — then claiming the trail defends against the organization.
9. **A retention job with no legal-hold check**, deleting records under preservation order (spoliation).
10. **Sampling audit events** through the shared observability pipeline.
11. **Writing PII into a COMPLIANCE-locked store**, making the mistake permanent and un-erasable.
12. **No scheduled verification** — discovering the chain broke only during the audit, months after the tampering.

---

## Tricky Points

- **Tamper-evident ≠ tamper-proof, and the gap is the whole interview.** You can prove an edit happened; you usually can't prevent it. The honest claim is "detectable," and detectability is itself a strong control.
- **One signature certifies a whole batch** because the chain head hash transitively commits to every record below it. This is why checkpoint-signing scales and per-record signing doesn't.
- **The chain proves internal consistency only.** Without signing, an attacker who rewrites records *and* their hashes produces a valid chain. Signing + anchoring is what makes the chain *trustworthy*, not just *consistent*.
- **COMPLIANCE-mode WORM is a one-way door.** You're protecting against your future self too. Anything written wrong (PII in clear) is permanent. Redact *before* the lock.
- **GDPR erasure and immutability only conflict if you embedded the person.** Store a token, and erasure becomes "delete the mapping" with zero impact on the immutable record.
- **Sequence numbers and hash chains catch different attacks.** The chain catches *edits*; the sequence catches *gaps*. You need both, plus external anchoring for *truncation*.
- **The audit log must outlive the schema that wrote it.** A verifier you write today must verify records written by code you deleted years ago — so the canonical form and hashing algorithm are part of the *stored* contract, versioned per record.
- **Legal hold can extend but not shorten COMPLIANCE retention.** They compose; understand the interaction before you set retention floors.
- **A managed ledger (QLDB, Azure Confidential Ledger, Trillian) trades the canonicalization/concurrency footguns for vendor lock-in.** Sometimes the right call; know what you're buying.

---

## Test Yourself

1. Explain, precisely, why `REVOKE UPDATE, DELETE FROM app_role` is *not* tamper-evidence, and name the adversary it fails against.
2. Implement a hash chain over your audit events. Then edit one payload in place and show your verifier reports the exact `seq` where the chain breaks.
3. Delete a middle record from your chain and show it's detected. Then delete the *last* N records and re-terminate the chain — show why an internal-only verifier might miss it, and what (sequence + external anchor) catches it.
4. Your writer hashes Postgres `jsonb::text`; your verifier hashes `json.dumps(sort_keys=True)`. Demonstrate the false-negative, then fix the canonicalization.
5. Design the integrity tier so a 10k-RPS service pays only a hash on the request path. Where do signing, WORM shipping, and anchoring happen?
6. A GDPR erasure request arrives for a user whose actions are in your immutable, hash-chained, WORM-locked audit log. Walk through satisfying it *without* modifying any audit record. Now do it again where a regime requires you to *retain* those records.
7. Configure an S3 bucket with Object Lock COMPLIANCE for 7-year retention. Then try to delete an object as root and show it's refused.
8. Write the threat-model paragraph for your audit system: the highest adversary you defend against, the layer that stops them, and where you stop. Be honest about the ceiling.
9. Your retention job is about to delete a partition. Add the legal-hold gate and demonstrate that a held subject's records survive while unheld ones are purged (and the purge is itself audited).

---

## Tricky Questions

1. **Q: Is a hash chain tamper-proof?**
   A: No — it's tamper-*evident*. It doesn't stop a privileged person from editing or deleting a record; it makes the change *detectable* (the chain no longer verifies). And the chain alone doesn't even detect a *whole-chain rewrite* — for that you need signing (a key the attacker lacks) plus external anchoring. "Tamper-proof" in software is almost always a lie; "tamper-evident" is the honest, achievable goal.

2. **Q: GDPR says erase the user; PCI says retain the audit log 1 year; the log is immutable. Reconcile.**
   A: Don't delete the audit record. Either (a) the record stored a *token*, not the person, so you erase the token→identity mapping and the immutable record survives intact; (b) you crypto-shredded the subject's PII with a per-subject key, so destroying the key renders it unrecoverable while the ciphertext (and the chain) is byte-identical; or (c) you invoke GDPR Art. 17(3) — the retention is a *legal obligation*, an explicit exemption from erasure, documented per data class. The wrong answer is deleting audit records.

3. **Q: Why not sign every audit event individually?**
   A: Cost. An RSA signature is ~1000–10000× a hash; per-event signing at scale destroys throughput and adds tail latency on the request path. Instead, hash-chain every event (cheap) and sign a *checkpoint* over the chain head periodically — because the head hash transitively commits to every record below it, one signature certifies the whole batch. Same security for the chained records, a tiny fraction of the cost.

4. **Q: We use S3 Object Lock in GOVERNANCE mode. Are we tamper-resistant against a malicious admin?**
   A: No. GOVERNANCE mode can be bypassed by any principal with `s3:BypassGovernanceRetention`. If a privileged insider is in your threat model, you need COMPLIANCE mode, where deletion is impossible before retention expires *even for the root account*. The trade-off: COMPLIANCE means *you* also can't delete early, so anything written wrong is permanent.

5. **Q: An attacker with DB superuser deletes the last 500 audit records and re-terminates the chain so it verifies. How do you catch it?**
   A: An internal-only chain verifier won't — the rewritten chain is internally consistent. You catch it with (a) monotonic sequence numbers checkpointed externally (the head sequence no longer matches the last anchored value), and (b) periodic external anchoring/notarization of the signed head hash, so the chain's state at time T is recorded somewhere the attacker doesn't control. The anchor is what makes head-truncation detectable.

6. **Q: Where do you put the integrity cost so it doesn't slow user requests?**
   A: Only the SHA-256 hash goes on the request path (microseconds, inside the same transaction as the business change, via the outbox). Everything expensive — batching, KMS signing, gzip, WORM upload, external anchoring — runs in the async relay, off the hot path. The user never waits on a signature or a network round-trip to the notary.

7. **Q: Should the audit log live in the same database/account as the application?**
   A: No. The audit log is a high-value target — the first thing an attacker tampers with. Put it on separate, *write-only* credentials, ideally a separate cloud account/project, so that compromising the app host doesn't grant the ability to rewrite history. One blast radius for app *and* its alibi defeats the purpose of the audit log.

8. **Q: Crypto-shredding leaves the encrypted data sitting in the log. Is that really "erasure" under GDPR?**
   A: It's widely accepted as erasure-equivalent ("rendering data inaccessible") because the data is permanently unrecoverable once the only key is destroyed — but it is *jurisdiction-dependent*. Some DPAs distinguish "erased" from "rendered inaccessible." A senior confirms the regulator's stance for the relevant jurisdiction before relying on key destruction, and documents that decision.

9. **Q: My chain verification fails on records I know are valid. First thing to check?**
   A: Canonicalization. The writer and verifier must serialize the payload to *byte-identical* form before hashing. The classic bug: the DB trigger hashes `jsonb::text` and the verifier hashes `json.dumps(sort_keys=True)` — same object, different bytes, different hash. Pick one canonical form (ideally a normalized string the application produces *before* insert) and use it everywhere.

---

## Cheat Sheet

```text
╔══════════════════════════════════════════════════════════════════════════╗
║                 AUDIT LOGGING — SENIOR CHEAT SHEET                       ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  TWO APPEND-ONLYS                                                         ║
║   access-control (REVOKE UPDATE/DELETE) → stops BUGS, defeated by any DBA ║
║   cryptographic (hash chain)            → stops PEOPLE, edits DETECTABLE  ║
║                                                                          ║
║  TAMPER-EVIDENCE LADDER (by adversary stopped)                           ║
║   hash chain        → single insider edits one row                       ║
║   + KMS-signed ckpt → whole-chain rewrite (needs the key)                ║
║   + WORM COMPLIANCE → your own root / admin                              ║
║   + external anchor → the organization itself                            ║
║   → WRITE DOWN the highest adversary you defend against. Be honest.      ║
║                                                                          ║
║  HASH CHAIN:  hash = SHA256(seq || prev_hash || canonical(payload))      ║
║   gap in seq = DELETION   broken prev_hash = EDIT/REMOVE   canonicalize! ║
║   ONE signature over the head certifies the WHOLE batch (cheap).        ║
║                                                                          ║
║  COST → keep integrity OFF the hot path                                  ║
║   request path: SHA-256 only (µs, same tx as outbox)                     ║
║   async relay:  batch → KMS sign head → gzip → S3 Object Lock → anchor    ║
║   NEVER sign per-record (~1000x). NEVER sample audit events.             ║
║                                                                          ║
║  RETENTION (law, not preference)                                         ║
║   PCI:1yr  HIPAA:6yr  SOX:7yr  NIST:3yr  GDPR: as short as purpose       ║
║   LEGAL HOLD overrides deletion → check the hold flag BEFORE any purge   ║
║   SOC 2 wants EVIDENCE the control RAN all period (daily verify report)  ║
║                                                                          ║
║  GDPR ERASURE vs IMMUTABILITY → separate the person from the record      ║
║   pseudonymize (erase the token→id map)  ·  crypto-shred (destroy key)   ║
║   lawful-basis retain (Art.17(3))   ·   NEVER delete the audit record    ║
║                                                                          ║
║  S3 OBJECT LOCK:  GOVERNANCE = bypassable   COMPLIANCE = even root can't ║
║                                                                          ║
║  RED FLAGS: "tamper-proof" claim · per-record sign · same acct as app    ║
║   · delete-for-GDPR · no anchor · GOVERNANCE for insider threat          ║
║   · canonicalization mismatch · no legal-hold gate · sampled audit       ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝
```

---

## Summary

- **Append-only is not tamper-evidence.** `REVOKE UPDATE, DELETE` stops the application, not the DBA. The senior shift is defending against *people*, not bugs.
- **You build tamper-*evident*, rarely tamper-*proof*.** Hash chains make edits and gaps *detectable*; honesty about that ceiling is part of the craft.
- **Hash-chain every record**, sign *checkpoints* (one signature certifies a whole batch via the head hash), and **anchor externally** when the org itself is in the threat model.
- **WORM (S3 Object Lock COMPLIANCE)** is the layer that stops your own root — but it's a one-way door, so redact *before* you lock.
- **Name the threat model explicitly** and write down the highest adversary you defend against and where you stop. The insider with privilege is the whole reason audit logs exist.
- **Retention is legal, not optional.** PCI 1yr, HIPAA 6yr, SOX 7yr; **legal hold overrides deletion** — gate every purge on the hold flag, or risk spoliation.
- **GDPR erasure and immutability only conflict if you embedded the person.** Pseudonymize or crypto-shred; never delete the audit record. Design for this before the first request.
- **Keep integrity off the hot path**: hash on write (µs), sign + WORM-ship in the async relay. **Never sample audit events.**
- **Separate audit from operational logs for real** — different credentials, ideally a different account, its own durable pipeline, the SIEM only a copy.
- **Trust sequence numbers over timestamps** for ordering; trust an RFC 3161 TSA over a server clock for "when."
- **Produce the evidence**: scheduled chain verification and pipeline-completeness monitoring are what an auditor (and a courtroom) actually accept.

---

## What You Can Build

- A **tamper-evident ledger library** (Go/Rust): single serial writer, canonical serialization, hash chain, `Verify()` that returns the first broken `seq`. Prove it catches an in-place edit, a middle-record deletion, and a head truncation.
- A **checkpoint signer + external anchorer**: a relay that batches records, signs the chain head with KMS/HSM, ships gzip segments to S3 Object Lock COMPLIANCE, and anchors the signed head to an external notary. Verify a signature against a tampered batch and watch it fail.
- A **GDPR-erasure harness**: pseudonymization with an erasable identity map *and* crypto-shredding with per-subject keys. Demonstrate erasing a subject while every audit record stays byte-identical and the chain still verifies.
- A **retention state machine** with a legal-hold gate: a lifecycle job that purges expired segments, skips held subjects, refuses to delete anything it can't integrity-verify, and audits its own deletions.
- A **scheduled verifier + completeness monitor**: a daily job that verifies the chain, compares the head against the last external anchor, alerts on any break or pipeline gap, and emits a SOC 2-ready report.
- A **canonicalization conformance test**: cross-language (DB trigger vs Python vs Go verifier) producing byte-identical hashes for the same logical event — the test that prevents the #1 hash-chain bug.
- A **threat-model document template**: enumerate adversaries, map each to the control that stops them, and state the honest ceiling — the artifact a senior produces before writing code.

---

## Further Reading

- **Integrity & ledgers**
  - *Certificate Transparency* (RFC 6962) — the canonical real-world Merkle-tree append-only log; read it for the head-anchoring and inclusion-proof patterns.
  - Google *Trillian* — the open-source verifiable-log implementation behind CT. <https://github.com/google/trillian>
  - AWS *QLDB* / Azure *Confidential Ledger* docs — managed hash-chained ledgers; study what they take off your plate (canonicalization, concurrency, signing).
  - *RFC 3161* — Time-Stamp Protocol (trusted external timestamps).
- **Immutability & retention**
  - AWS *S3 Object Lock* — GOVERNANCE vs COMPLIANCE modes, legal hold. <https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html>
  - Azure *immutable blob storage* — time-based retention + legal hold.
- **Regimes (read the actual controls, skim the rest)**
  - *PCI DSS Requirement 10* — the most concrete, field-by-field audit-logging spec.
  - *HIPAA Security Rule §164.312(b)* — audit controls for PHI access.
  - *NIST SP 800-53* — the AU (Audit and Accountability) control family (AU-2..AU-12).
  - *NIST SP 800-92* — Guide to Computer Security Log Management.
  - *GDPR Articles 5, 17, 25* + Recital 26 — minimization, erasure (and its exemptions), pseudonymization.
- **Patterns**
  - *OWASP Logging Cheat Sheet* — capture/redact and integrity guidance.
  - Chris Richardson, *Transactional Outbox* — the serial-writer backbone of a chained ledger. <https://microservices.io/patterns/data/transactional-outbox.html>

---

## Related Topics

- **Previous level:** [middle.md](middle.md) — stable schema, controlled vocabulary, outbox, access-control append-only, correlation, capture-vs-redact, delegation.
- **Foundations:** [junior.md](junior.md) — the five W's and the separate-sink rule.
- **Next level:** [professional.md](professional.md) — pipeline at planetary scale, forensic admissibility, multi-tenant integrity, exactly-once and global ordering.
- **Interview prep:** [interview.md](interview.md).
- **Practice:** [tasks.md](tasks.md).

**Sibling diagnostic topics:**

- [Logging — Senior](../logging/senior.md) — structured logs, aggregation, correlation. Audit reuses the correlation machinery; the integrity and retention disciplines are entirely different.
- [Telemetry Cost & Sampling Strategy](../telemetry-cost-and-sampling-strategy/) — why audit events are the explicit exception to sampling.
- [Tracing](../tracing/) — where `trace_id` comes from; the correlation join key during a forensic reconstruction.
- [Post-Mortem Analysis](../post-mortem-analysis/) — the audit trail is the primary evidence in a security post-mortem.
- [Crash Reporting](../crash-reporting/) — separate concern; crashes are operational, audit is compliance evidence.

**Cross-roadmap links:**

- The `encryption-basics` skill — hashing, HMAC, signatures, crypto-shredding primitives.
- The `secrets-management` skill — KMS/HSM, key rotation, the signing-key lifecycle that backs checkpoint signing.
- The `database-backup-recovery` skill — retention, point-in-time recovery, and why backups are not an audit trail.
- The `auth-token-security` / `api-authentication` skills — where the (delegated) actor identity originates.
- The `database-migration-patterns` skill — evolving the audit schema without breaking the verifier that must read old records.

---

## Diagrams & Visual Aids

### The integrity ladder (who each layer stops)

```text
   ┌──────────────────────────────────────────────────────────────────────┐
   │  ADVERSARY                          CONTROL THAT STOPS THEM           │
   ├──────────────────────────────────────────────────────────────────────┤
   │  buggy / careless application  ──►  REVOKE UPDATE,DELETE (app role)   │
   │  DBA editing one row in place  ──►  hash chain (edit breaks chain)    │
   │  attacker who owns the host    ──►  off-host ship + write-only creds  │
   │  your own root / admin         ──►  WORM Object Lock (COMPLIANCE)     │
   │  the organization itself       ──►  external anchor / notarization    │
   └──────────────────────────────────────────────────────────────────────┘
         decide how far down this list your threat model requires going,
         and WRITE DOWN where you stop.
```

### Hash chain — edit and deletion both break it

```text
   INTACT:
   [1|prev=000|H1]→[2|prev=H1|H2]→[3|prev=H2|H3]→[4|prev=H3|H4]   verify ✓

   EDIT record 2's payload:
   [1|prev=000|H1]→[2|prev=H1|H2']  H2'≠H2, but record 3 still says prev=H2
                                    → break detected at seq 3 ✗

   DELETE record 2:
   [1|prev=000|H1]→[3|prev=H2|H3]   seq jumps 1→3 (gap) AND prev=H2 missing
                                    → break detected at seq 3 ✗
```

### The fast-path / slow-path split

```text
   REQUEST PATH (microseconds)              ASYNC RELAY (off the hot path)
   ┌─────────────────────────────┐          ┌────────────────────────────────────┐
   │ business change             │          │ read outbox in seq order            │
   │  + INSERT audit (SHA-256)   │ ───tx──► │  → batch 1000 records (a segment)    │
   │  COMMIT → reply to user     │          │  → KMS sign segment HEAD (1 sig)     │
   └─────────────────────────────┘          │  → gzip → S3 Object Lock COMPLIANCE  │
        user waits ONLY on the hash         │  → anchor checkpoint externally      │
                                            └────────────────────────────────────┘
```

### GDPR erasure without breaking immutability

```text
   IMMUTABLE LEDGER (hash-chained, WORM)      ERASABLE STORES (mutable)
   ┌───────────────────────────────────┐      ┌──────────────────────────────┐
   │ subject: tok_9f3a                 │      │ id map:  tok_9f3a → alice  ✗  │ ← delete
   │ pii_blob: <AES-GCM ciphertext>    │      │ keyring: key(alice)        ✗  │ ← destroy
   │ hash: …  prev_hash: …             │      └──────────────────────────────┘
   └───────────────────────────────────┘       after erasure: token resolves
        record NEVER touched · chain ✓          to no one; ciphertext unreadable
```

### Retention as a state machine with legal hold

```text
   WRITTEN ─► RETAINED ─(clock expires)─► ELIGIBLE ─(no hold? verify ok?)─► DELETED
                 │                            ▲                                │
       legal hold│placed                      │hold released                   │ (deletion
                 ▼                            │                                ▼  itself audited)
              ON-HOLD ───────────────────────┘
              (clock paused; purge job MUST skip — spoliation if not)
```

---
