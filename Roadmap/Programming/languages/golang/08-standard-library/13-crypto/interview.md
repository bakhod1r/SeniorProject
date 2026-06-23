# 8.13 `crypto/*` — Interview

> **Audience.** Questions a thoughtful interviewer (or auditor) will
> ask. Each answer is short on purpose — if you can't say it cold,
> read the leaf again.

## 1. Why use `crypto/rand` instead of `math/rand` for tokens?

`math/rand` produces a deterministic stream from a seed. Anyone who
observes a few outputs can recover the seed and predict every future
output. The Go 1.20+ `math/rand` is auto-seeded with random data, but
the *output stream* is still deterministic — not the property you
want for tokens, IDs, nonces, or keys. `crypto/rand` reads from the
OS entropy source (`getrandom(2)` on Linux). Use it for any byte an
attacker would benefit from guessing.

## 2. Why is `bytes.Equal` wrong for comparing MACs?

`bytes.Equal` returns at the first differing byte. An attacker who
can time the response learns *where* the first mismatch is and can
brute-force the tag byte by byte instead of guessing all 32 bytes
at once. `hmac.Equal` (and `subtle.ConstantTimeCompare`) run for the
full length regardless, so timing doesn't reveal information about
the contents.

## 3. What goes wrong if you reuse a nonce in AES-GCM?

Two ciphertexts encrypted under the same `(key, nonce)` reveal the
XOR of their plaintexts, which is enough to recover both plaintexts
in many real-world cases (English text, predictable structure). The
attacker can also forge new authentic ciphertexts under that key.
This is *catastrophic*, not "weakened" — repeated nonces break
GCM's security entirely. The mitigation: generate the nonce randomly
with `crypto/rand` for every message, and rotate the key before
2^32 messages under one key.

## 4. Why isn't ECB safe?

ECB encrypts each block independently. Identical plaintext blocks
produce identical ciphertext blocks, so structural patterns in the
plaintext leak through. The "ECB penguin" image is the canonical
example — the picture is still recognizable after encryption. Go
deliberately doesn't expose an ECB constructor in `crypto/cipher`.

## 5. Why not encrypt with CBC + HMAC?

You can — encrypt-then-MAC with separate keys for the two operations
is a known-good construction. But you have to get the order, the
keys, and the comparison right; a small slip introduces padding-
oracle vulnerabilities or auth bypass. AEAD modes (GCM,
ChaCha20-Poly1305) bundle encrypt-and-authenticate into one call,
removing the foot from the gun.

## 6. RSA-PKCS#1 v1.5 vs RSA-PSS for signing?

Both work; PSS is preferred for new code because:

- PSS includes a fresh random salt per signature; v1.5 is
  deterministic.
- PSS has a security proof under the random oracle model; v1.5 has
  no equivalent proof.
- PSS is harder to misuse — a buggy v1.5 verifier (forgetting to
  check trailing bytes) can be tricked into accepting forged
  signatures.

Use v1.5 only for interop with legacy specs that require it (JWS
RS256, older protocols).

## 7. Why prefer Ed25519 for new signing?

- Smaller keys (32 bytes private, 32 bytes public) than RSA-2048.
- Smaller signatures (64 bytes) than RSA (256 bytes for 2048-bit).
- Faster signing and verification on every platform.
- Deterministic — no nonce reuse risk like ECDSA.
- Simpler API: no hash to choose, no padding, no parameters.

The only reason to pick RSA or ECDSA over Ed25519 is interop with a
spec that doesn't accept Ed25519. JWS, X.509 certs in browsers, and
some HSMs may force the choice.

## 8. What is forward secrecy and how does Go provide it?

Forward secrecy means past traffic stays unreadable even if the
server's long-term private key is compromised later. Achieved via
ephemeral key exchange — both parties generate fresh keypairs per
session, sign with their long-term keys, and derive a session key
from the ephemeral exchange. Stealing the long-term key lets the
attacker impersonate the server going forward, but not decrypt
past sessions.

In Go: TLS 1.3 *always* uses ephemeral (EC)DH. Go's TLS 1.2 default
suite list disables RSA key-exchange suites (which lacked forward
secrecy). The user gets it without configuration.

## 9. What does `InsecureSkipVerify: true` actually do?

It tells the TLS client to skip *all* of stdlib's verification:
chain-to-root, expiration, hostname matching. The connection is
still encrypted, but you have no idea who you're talking to. An
attacker on the path can present any certificate and you'll accept
it. There are exactly two legitimate uses:

1. Tests against a self-signed cert in code under your control.
2. Cert pinning where you do verification yourself in
   `VerifyConnection`.

Anything else is a bug. "We're behind a firewall" is not a reason.

## 10. How do you rotate TLS certs without downtime?

Use `tls.Config.GetCertificate` instead of static `Certificates`.
A reload goroutine watches the cert file and atomically swaps the
active `*tls.Certificate` when the file changes. In-flight
handshakes see one or the other; existing TCP connections keep
their already-handshook cert until they close. ACME/Let's Encrypt
automation uses exactly this pattern (see
`golang.org/x/crypto/acme/autocert`).

## 11. What's mTLS and when do you use it?

Mutual TLS: both client and server present certificates. The server
authenticates the client by verifying its cert against `ClientCAs`.
Used for service-to-service authentication in microservice meshes
where you want strong identity without bearer tokens. The server's
TLS config sets `ClientAuth: tls.RequireAndVerifyClientCert` and
provides `ClientCAs`. The handler reads
`r.TLS.PeerCertificates[0]` to get the client's identity.

## 12. Why is password hashing not in the standard library?

The Go authors chose to keep cutting-edge primitives in
`golang.org/x/crypto` so they can evolve faster than stdlib's
compatibility promise allows. Argon2 was a 2015 standard; bcrypt
predates Go. Both live in `golang.org/x/crypto`. Use `argon2id` for
new systems, `bcrypt` if you have a constraint (it's older and
simpler). Never use SHA-256 or MD5 for passwords — they're too
fast.

## 13. What's envelope encryption and when do you use it?

A two-tier scheme: a **KEK** (Key Encryption Key) lives in a KMS
and never leaves; a **DEK** (Data Encryption Key) is generated per
object with `crypto/rand` and encrypts the actual data. The DEK is
itself encrypted ("wrapped") by the KEK and stored alongside the
ciphertext. To rotate the KEK, you re-wrap the DEKs (cheap)
without re-encrypting the data (expensive). Standard pattern for
large-scale encryption at rest with KMS-grade key custody.

## 14. What does a JWT verifier need to check?

- **Signature** with the correct key.
- **`alg`** header matches the expected algorithm. Reject `alg: none`.
  Don't allow callers to switch between HS256 and RS256.
- **`kid`** to look up the right key when multiple are valid.
- **`exp`** — token not expired (with small leeway for clock skew).
- **`nbf`** — token already valid (with small leeway).
- **`aud`** — token addressed to *this* service.
- **`iss`** — token from a known issuer.
- **`jti`** — for replay prevention if you maintain a deny list.

A library that skips any of these has a CVE waiting to happen.

## 15. What's a "padding oracle" attack?

A vulnerability in unauthenticated CBC: the attacker submits modified
ciphertexts and observes whether the server reports a "bad padding"
error or some other error. From this binary signal, the attacker
recovers the plaintext byte by byte. Mitigated by AEAD (GCM,
ChaCha20-Poly1305) which authenticates before decrypting, so the
attacker only ever sees a single "bad" outcome regardless of which
byte was tampered.

## 16. When do you `f.Sync()` after writing key material?

After writing any file you'll later need to rely on across a crash.
A crashed process whose `Write` returned successfully can still lose
the data — it's in the OS page cache, not on disk. `Sync()` blocks
until the bytes are durable. For a write-then-rename atomic pattern,
sync the temp file before rename and sync the parent directory
after rename for full durability.

## 17. How big should an AES key be?

- AES-128 (16-byte key) is currently considered secure for general use.
- AES-256 (32-byte key) is the default for new code. The performance
  cost is a few percent on hardware with AES-NI; correctness is the
  same.
- AES-192 (24-byte key) is an option in the spec; almost no one uses
  it. The implementation in Go is slightly slower than 128 or 256.

For interop with a constrained partner: 128. For your own systems: 256.

## 18. Why is `crypto/rand` synchronous and blocking?

It reads from the OS entropy pool. On a freshly booted system before
the pool is seeded, the syscall (`getrandom(2)` on Linux) blocks.
Once seeded, it returns instantly. Go doesn't add a buffer or
worker pool because the throughput is already high (`getrandom(2)` is
a fast syscall, and the kernel's CSPRNG is high-bandwidth) and any
buffering would risk serving low-entropy bytes during early boot.

## 19. What's wrong with hashing SHA-256 of `secret || message`?

Vulnerability to length-extension attacks. SHA-256's internal state
after hashing `secret || message` can be derived from the output;
an attacker who knows the length of `secret` and the message can
compute a valid hash for `secret || message || padding || extra`
without knowing `secret`. HMAC's nested structure
(`H(key⊕opad || H(key⊕ipad || message))`) prevents this.

## 20. When does `crypto/aes` use the AES-NI hardware instructions?

On x86 CPUs with AES-NI (essentially all modern Intel/AMD), the Go
runtime detects the feature at startup and `crypto/aes` calls the
hardware path directly. On ARM with ARMv8 AES extensions, same
story. On platforms without the instructions, the package falls
back to a constant-time software implementation. You can't (and
shouldn't) influence this choice; the stdlib picks the fastest
correct path.

## 21. What's `crypto.Signer` for?

A polymorphic interface for "thing that can sign." Implemented by
all three private key types in the stdlib. The killer use case: a
KMS- or HSM-backed signer where the private key never enters your
process. Your code calls `Sign` on a `crypto.Signer`; the
implementation calls the KMS. Anything that takes a
`crypto.Signer` (`x509.CreateCertificate`, `tls.Certificate.PrivateKey`)
works transparently with either an in-memory key for tests or an
HSM key in production.

## 22. What's `tls.Config.VerifyConnection` for?

A hook that runs *after* stdlib's normal TLS verification. Use it
for application-specific extra checks: pin a specific cert,
require a particular SAN, block a known-bad fingerprint, log the
peer identity for audit. Returning an error aborts the handshake.

`VerifyPeerCertificate` is a different hook that runs *during*
verification and replaces stdlib's logic. Use it only for full
custom verification (cert pinning where you skip the chain check
entirely). For "stdlib + extra rule," use `VerifyConnection`.

## 23. What does `subtle.ConstantTimeCompare` do exactly?

Returns 1 if two byte slices are equal, 0 if not, in time
proportional only to `len(a)+len(b)` — independent of where they
first differ. Implemented as `XOR` accumulator: every byte
contributes to the result, no early exit. The length check at the
top is fast-path: if lengths differ, returns 0 without scanning,
but doesn't reveal the *contents* of either slice.

## 24. What's the danger of a long-lived JWT?

A leaked long-lived JWT is a credential that works for the entire
remaining lifetime, with no easy way to revoke it (JWTs are
stateless by design). Mitigations: short access-token lifetimes
(minutes), refresh-token rotation, server-side `jti`-based deny
lists for confirmed leaks, mTLS or DPoP binding to make stolen
tokens unusable elsewhere. The simplest defense is short
expiration combined with a refresh flow.

## 25. What is HKDF and when do you use it?

HMAC-based Key Derivation Function (RFC 5869). Two-step process:
*extract* turns a high-entropy-but-non-uniform input (like an ECDH
shared secret) into a uniformly random pseudo-random key; *expand*
stretches that key into one or more output keys with context
labels. Use it whenever you have one secret and need multiple
keys derived from it — different keys for signing vs. encryption,
different keys per session, key separation for protocol roles.
The `info` parameter is a label that makes derivations
deterministic and domain-separated.

## 26. Why is the AAD parameter important?

Additional Authenticated Data binds non-secret context to the
ciphertext's authentication. You use AAD for fields that travel
in plaintext but must not be modified — version numbers, key IDs,
recipient identifiers. If anyone tampers with the AAD, decryption
fails. Forgetting to include important metadata in the AAD lets
attackers swap version bytes, downgrade protocol negotiation, or
redirect ciphertexts to different recipients without tripping
authentication.

## 27. What's the difference between a session ticket and a session ID?

Session ID is server-side state: the server stores keys indexed by
ID and the client just sends back the ID. Session ticket is
client-side state: the server encrypts the session keys with a
ticket key and gives the encrypted blob to the client; the client
returns it on resumption. Tickets scale better (no server
storage) but break forward secrecy slightly — compromise of the
ticket key compromises every session that used it. Mitigation:
rotate ticket keys on a schedule shorter than your forward-secrecy
budget.

## 28. What is constant-time selection?

`subtle.ConstantTimeSelect(v, x, y)` returns `x` if `v == 1` and
`y` if `v == 0`, in constant time (no branch on `v`). Used inside
crypto primitives where you want to do "if secret then a else b"
without leaking the value of `secret` through branch timing or
cache. You rarely write this in application code; you'll see it in
constant-time field arithmetic, padding-removal logic, and similar
low-level routines.

## 29. Why does Go avoid exposing ECB?

Electronic Code Book mode encrypts each block independently and
deterministically. Two identical plaintext blocks produce
identical ciphertext blocks, so structural patterns leak through —
the famous "ECB penguin" image where the encrypted picture is
still recognizable. Go's `crypto/cipher` deliberately doesn't
provide an ECB constructor: there's no safe use case in modern
applications. If you need block-cipher behavior, use a proper mode
(CTR, CBC with HMAC, or AEAD). The omission is a feature.

## 30. When would you use `crypto/ecdh` over the older ECDH-via-ECDSA APIs?

Go 1.20+ added `crypto/ecdh` as a clean API for elliptic-curve
key exchange. Use it for any new code that needs ECDH (X25519 or
NIST curves). The older approach (using `*ecdsa.PrivateKey` and
calling `ScalarMult` manually) is error-prone — easy to forget
length normalization, easy to mismatch curve parameters. The new
package handles those for you and gives a simple `priv.ECDH(peerPub)`
call.

## 31. What's the practical difference between `Sign` and `SignASN1` in `crypto/ecdsa`?

`Sign` returns the raw `(r, s)` integer pair as `*big.Int` values;
you encode them yourself. `SignASN1` (Go 1.15+) returns the
DER-encoded ASN.1 sequence that most specs and protocols expect
(X.509, JWS-ES256). For new code, use `SignASN1`. The older
`Sign` exists for protocols that wanted custom encoding.

## 32. What's the difference between symmetric and asymmetric cryptography in one sentence each?

Symmetric: same secret on both sides, fast (GB/s), used for bulk
data. Asymmetric: keypair with public and private halves, slow
(KB/s), used for authentication, signing, and key exchange. The
practical pattern: asymmetric crypto agrees on a symmetric key,
symmetric crypto encrypts the actual data. TLS does this; so does
nearly every modern hybrid scheme.

## 33. Why are random salts important for password hashing?

Without a salt, identical passwords produce identical hashes
across users — an attacker who computes one hash table (rainbow
table) cracks every user with that password at once. With a
unique random salt per user, the attacker has to brute-force each
hash separately, multiplying the work by the number of users. The
salt doesn't need to be secret (it's stored alongside the hash),
just unique and unpredictable. 16 random bytes is sufficient.

## 34. When would you ever want `math/rand`?

Tests where reproducibility matters. Game logic. Backoff jitter
where the randomness is for spreading load, not for unguessability.
Any case where an attacker who guesses the value gains nothing of
value. The check is "if I could predict this, would security
break?" If yes: `crypto/rand`. If no: either is fine.
