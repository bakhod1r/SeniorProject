# 8.13 `crypto/*` — Professional

> **Audience.** You're shipping crypto in production: services that
> handle bearer tokens, encrypt user data, talk mTLS to a fleet of
> microservices, and pass a security audit every quarter. This file
> is the production playbook: KMS boundaries, envelope encryption,
> key rotation without downtime, observable handshake failures, and
> the operational hygiene that keeps secrets out of logs, dumps, and
> backups. The thread: **the crypto is the easy part — the operations
> around it are where systems fail**.

## 1. The KMS boundary

For any data that survives a process restart, the question isn't
"how do I encrypt it" but "where does the key live". The two
extremes:

| Pattern | Key location | Use it for |
|---------|--------------|------------|
| Inline | Process memory (env var, file) | Dev, ephemeral tokens, prototypes |
| KMS | Cloud KMS or HSM | Anything that lasts longer than a process |

The inline pattern in production has one persistent problem: every
copy of the binary, every Docker image layer, every backup of `/etc`,
every leaked memory dump contains the key. Rotating it requires
re-deploying every consumer.

The KMS pattern moves the key inside a service that signs/decrypts
on your behalf. The bytes never leave. Your code holds a *handle*
(an ARN, a key ID), not a key.

The envelope pattern (covered in senior.md, section 10) is how you
get KMS-grade rotation with bulk-data throughput: KMS wraps a DEK,
the DEK encrypts the data, rotation rewraps DEKs without touching
ciphertext.

A `crypto.Signer`-backed KMS adapter is the standard shape:

```go
type kmsSigner struct {
    keyID string
    pub   crypto.PublicKey
    api   KMSClient
}

func (k *kmsSigner) Public() crypto.PublicKey { return k.pub }

func (k *kmsSigner) Sign(_ io.Reader, digest []byte, opts crypto.SignerOpts) ([]byte, error) {
    return k.api.Sign(context.Background(), k.keyID, digest, opts.HashFunc())
}
```

Plug it into anything that takes a `crypto.Signer`: `x509.CreateCertificate`,
`tls.Certificate.PrivateKey`, your own JWT signer, your own SCEP
implementation. The same code path works with an in-memory key in
development and an HSM-backed key in production — the only change
is which `crypto.Signer` you instantiate.

## 2. Key rotation without downtime

Rotation has three phases:

1. **Both keys accepted, old key issued.** Add the new key to the
   verifier's keyset. Continue signing with the old key. All existing
   tokens still verify; new tokens still use the old key.
2. **Both keys accepted, new key issued.** Switch the signer to the
   new key. Verifiers accept either. New tokens are signed with the
   new key; tokens issued before the switch still verify until they
   expire.
3. **Old key removed.** After the longest-lived old token has
   expired, remove the old key from the verifier.

The keyset, not the key, is the unit of state. A verifier holds a
map keyed by key ID:

```go
type keyset struct {
    mu   sync.RWMutex
    keys map[string]crypto.PublicKey
}

func (k *keyset) Get(id string) (crypto.PublicKey, bool) {
    k.mu.RLock()
    defer k.mu.RUnlock()
    pub, ok := k.keys[id]
    return pub, ok
}

func (k *keyset) Set(id string, pub crypto.PublicKey) {
    k.mu.Lock()
    k.keys[id] = pub
    k.mu.Unlock()
}
```

Tokens carry the `kid` (key ID) header so the verifier knows which
key to look up. JWT does this; design your own with the same idea.

Three pitfalls of rotation:

- **No `kid` in the token.** Verifiers must try every key on every
  token. Works, but slow and noisy in logs.
- **Key removed too early.** A token signed yesterday with the old
  key reaches a verifier whose old key was rotated out today;
  verification fails despite the token being legitimate.
- **Single point of failure for the keyset.** If the keyset comes
  from a single config file, rolling it out is a fleet-wide
  operation. Use a config service or a reload-on-signal pattern.

For TLS certs, rotation is `GetCertificate` plus a goroutine that
reloads from disk (senior.md, section 3). Same shape: atomic swap of
the active material, in-flight handshakes see one or the other.

## 3. The "encrypt at rest" checklist

When the audit asks "is this encrypted at rest", the right answer
is rarely "yes" — it's "here's the design". The checklist:

- **Where is the data?** Disk, S3, a database column, a Kafka topic,
  a backup tape. Each has a native encryption story; use it.
- **What's the threat model?** Stolen disk vs. compromised admin
  account vs. malicious DBA vs. nation-state. Different threats
  require different layers.
- **Who has access to the key?** If the same role that reads the
  data also reads the key, the encryption is theater.
- **Where does decryption happen?** In the application, in the
  database, in a sidecar, in the storage system. Each move shifts
  the trust boundary.
- **How is the key rotated?** A key that "can't be rotated" will
  eventually leak.
- **What's logged?** A successful decrypt is fine to log. The
  plaintext is not.

The minimum viable production answer for "encrypt user PII at rest":

```
- Each row's PII columns are encrypted with AES-GCM under a per-tenant DEK.
- DEKs are wrapped with a KEK in AWS KMS.
- The KEK rotates yearly; DEKs rewrap automatically on rotation.
- The application has IAM permission to use the KEK; no human role does.
- Plaintext is decrypted in-process and never written to logs or backups.
- Database backups contain ciphertext only; restore-and-decrypt
  requires the KEK.
```

The list is unimpressive on purpose. Most "encryption at rest"
incidents come from skipped items, not from broken algorithms.

## 4. Bearer tokens and replay

A bearer token is a credential: anyone holding it can act as the
holder. Production bearer tokens have:

| Property | Why |
|----------|-----|
| Short lifetime (minutes) | Limits blast radius of leakage |
| Bound to a session | Server can revoke without rotating keys |
| Bound to a client (mTLS, DPoP) | Stolen token doesn't work elsewhere |
| `kid` header | Rotation works |
| `aud` claim | Token for service A doesn't work on service B |
| `exp` claim | Forced expiration |
| `nbf` claim | Defense against clock skew on the issuer |
| `jti` claim | Unique ID for replay prevention |

Verification has to check **all** of these — `exp`, `nbf`, `aud`,
`iss`, `kid`, signature. A library that forgets `aud` is a library
that lets cross-service token replay through. A library that's
permissive on `alg` (accepts both `none` and a real algorithm) is
the famous JWT misuse.

For server-side state, keep a small "revocation list" indexed by
`jti` for tokens you've explicitly invalidated (logout, suspected
leak). Don't try to make the token itself revocable without state —
"stateless revocable JWT" is a misnomer.

For long-lived sessions, use the **refresh token** pattern: a long
refresh token (stored server-side, opaque, rotated on use) plus a
short access token (signed JWT, stateless). The access token does
the work; the refresh token gets new access tokens. Rotation of
refresh tokens (each use returns a new one, the old becomes
invalid) detects token theft when the legitimate user comes back
and finds their refresh token rejected.

## 5. Signed cookies vs. stateful sessions

| Style | Storage | Revocation | Scale |
|-------|---------|------------|-------|
| Signed cookie | Client (cookie) | Hard — needs a deny list | Stateless server |
| Stateful session | Server (Redis, DB) | Easy — delete the row | Needs shared store |

Signed cookies use HMAC. Encrypted cookies use authenticated
encryption (AES-GCM). Both put the data on the client; the
difference is whether the client can read it.

Pitfalls:

- **Signed != encrypted.** A signed cookie is tamper-evident, not
  secret. Don't put a session ID in a signed cookie thinking it's
  hidden — it's base64 in plain sight.
- **No expiry in the cookie.** The cookie's HTTP `Expires` attribute
  is enforced by the browser, not the server. An attacker can replay
  an expired-looking cookie indefinitely. Put `exp` *inside* the
  signed payload.
- **Per-instance keys.** If each replica has its own HMAC key,
  cookies break on load balancer rotation. Use one key (rotated
  centrally) per service.
- **Long-lived signing keys.** Six-month-old HMAC key with a
  six-month token lifetime: a stolen key compromises six months of
  cookies. Rotate keys quarterly at minimum, with a rolling window
  (section 2).

## 6. mTLS at scale

When you have 50 services talking to 50 services, mTLS gives you:

- Encrypted transport (free with TLS).
- Strong authentication of the *caller service* (the cert proves it).
- A natural place to enforce service-to-service authorization.

The operational picture:

1. **A private CA issues certs.** Either run your own (cfssl, Vault
   PKI) or use a managed one (AWS Private CA, GCP CA Service).
2. **Each service has a short-lived cert** (hours to days). The
   issuance system rotates them automatically.
3. **Services consume their certs from a known path** (the cert
   manager writes to disk). The server uses `GetCertificate` for
   hot reload.
4. **The server's TLS config requires and verifies client certs**
   chained to the private CA.
5. **The server reads the client's identity** from the verified cert
   (`SAN URI`, `CN`, or a custom OID) and applies authorization
   from there.

The piece most teams skip: certificate rotation that doesn't drop
in-flight requests. The recipe:

- Cert manager writes to a temp file then renames atomically.
- Server's reload goroutine watches the file (inotify/fsnotify) or
  polls every 5 minutes.
- On reload: parse, validate the new cert isn't expired, atomically
  swap the active `*tls.Certificate`.
- Existing TCP connections keep using the old cert (TLS doesn't
  renegotiate); new connections pick up the new cert.

## 7. Observability for crypto

What to expose as metrics:

- **`tls_handshake_total{result, protocol, cipher}`** — handshake
  count, labeled with success/failure, TLS version, cipher suite.
- **`tls_handshake_duration_seconds`** — histogram of handshake
  latency. Spikes here often mean CA load, OCSP issues, or a
  CPU-starved server.
- **`tls_cert_expiry_seconds{name}`** — gauge of "seconds until
  this cert expires". Alert when below threshold (24h, 7d, 30d).
- **`crypto_sign_total{algorithm}`** and **`crypto_verify_total{algorithm, result}`**
  — track who's signing what and how often verification fails.
- **`token_verify_total{result, reason}`** — labels: `valid`,
  `expired`, `bad_sig`, `unknown_kid`, `not_yet_valid`. Helps you
  spot rotation problems before they're outages.

`tls.Config.VerifyConnection` is a good place to attach metrics —
you have the full handshake context, including the negotiated
version and peer cert.

## 8. Audit logging

For security-sensitive operations, log enough to reconstruct what
happened *without* logging the secret material:

- **Sign**: log `(actor, key_id, digest_prefix, timestamp)`. Don't log
  the message or the signature. The digest prefix (first 8 bytes of
  hex) is enough to correlate with downstream verification logs.
- **Verify**: log `(actor, key_id, result, error_class)`. Don't log
  the token; "bad signature" is enough.
- **Encrypt/decrypt**: log `(actor, key_id, object_id, result)`.
  Don't log plaintext or ciphertext.
- **Cert issuance**: log subject, SAN list, validity window, issuer
  key ID.

The log itself is sensitive — an attacker who reads "actor=x,
verify=ok" learns who has valid sessions. Ship it to a separate
store with stricter access than your application logs.

## 9. Secret hygiene checklist

Things that should *never* end up in places they tend to:

| Place | What's leaked there |
|-------|---------------------|
| Application logs | Tokens, passwords, key material |
| Stack traces | Anything in a struct field that gets `%+v`-printed during a panic |
| Crash dumps | Process memory; assume keys are visible |
| Heap profiles | Allocations may include in-flight plaintext |
| Build artifacts | Hard-coded keys baked into binaries |
| Container images | Build-time `ARG` values; cached layers with secrets |
| Backup snapshots | Database rows with plaintext columns |
| Browser console / network tab | Tokens in URLs (use Authorization header) |
| Search indexes | If you index logs, the index has the secrets too |

The defenses:

- Use redacted types (`String()` returns `[REDACTED]`) for password,
  token, key fields.
- Strip `Authorization` headers from request logs at the middleware
  layer.
- Avoid `panic` paths that print struct values; recover and log a
  curated message.
- Never put secrets in URLs (path or query string).
- For build-time secrets, use a multi-stage Docker build that
  doesn't carry the secret into the final image.

## 10. The "we need crypto" conversation

When a colleague says "we need to encrypt this":

1. **What's the threat?** "Encrypt" without a threat model is theater.
   Disk theft? Compromised DBA? In-flight inspection? Each gets a
   different answer.
2. **Is there an existing primitive?** TLS handles most in-flight
   needs. Disk-level or column-level encryption handles most at-rest
   needs. Roll your own only when neither fits.
3. **Where does the key live?** The KMS question. If the answer is
   "in the same place as the data", the encryption is decorative.
4. **How does it rotate?** A key that can't be rotated will eventually
   need to be — usually under time pressure during an incident.
5. **Who reviews?** Crypto code is high-stakes. Don't merge without
   a second pair of eyes who has done this before.

The right answer to "we need to encrypt this" is sometimes "no — we
need to *not store this*". The cheapest way to keep a secret is not
to have it.

## 11. Picking libraries

Stdlib + `golang.org/x/crypto` covers most needs. When you reach
beyond that, the well-maintained options:

| Need | Library |
|------|---------|
| File encryption | `filippo.io/age` |
| Modern HTTPS server with auto-cert | `golang.org/x/crypto/acme/autocert` |
| JWT (with all the safety rails) | `github.com/golang-jwt/jwt/v5` (verify carefully) |
| Argon2 wrapper | `github.com/alexedwards/argon2id` |
| Constant-time JSON-ish for secrets | Roll your own redacted types |
| Password reset, MFA | Frame yourself with `crypto/rand`; the libraries here are application-level |
| Identity / OAuth | `golang.org/x/oauth2`, `github.com/coreos/go-oidc` |

Things to avoid:

- Crypto libraries with low download counts and no security review.
- "Simple" encryption wrappers that hide the nonce or key from you.
- Anything that promises "easy" homomorphic encryption or "easy" zero-knowledge proofs without a real cryptographer on the team.
- Re-implementations of standard primitives in Go for "performance".
  The stdlib AES is hand-tuned assembly; you won't beat it.

## 12. FIPS, BoringCrypto, and policy

Some shops require FIPS 140-validated crypto. Go has two paths:

1. **BoringCrypto** — Google's branch with FIPS-validated AES and
   HMAC. Built into the Google-internal Go; available externally as
   `GOEXPERIMENT=boringcrypto`.
2. **Microsoft Go FIPS** — a fork integrating with the OS-level
   FIPS module on Windows.

If FIPS isn't a hard requirement, use stock Go. The standard `crypto/tls`,
`crypto/aes`, etc., are not FIPS-validated as a *module*, but their
algorithms are correct.

If FIPS is required, expect:

- A specific Go toolchain (BoringCrypto, Red Hat Go, MS Go).
- Restricted algorithm choices (no Ed25519 in some validated modules).
- A signed module-validation audit you must reference.

This is rarely a tech decision; it's a compliance decision. The
crypto code looks the same; the build pipeline differs.

## 13. The "two keys" rule

For any system that's signing *and* encrypting, never use the same
key for both purposes. The reasons:

- **Different rotation cadences.** Signing keys often live for
  months (cert lifetime); encryption keys may rotate weekly. Same
  key forces them onto the same schedule.
- **Different attack surfaces.** A signing oracle (something that
  signs whatever you ask) is not the same as a decryption oracle.
  Mixing keys means a vulnerability in either path compromises both.
- **Key agility.** When you need to switch one algorithm (say, RSA
  to Ed25519), you can't if the same key is doing two jobs in two
  different specs.

The pattern: derive separate keys from a master with HKDF, or
generate them independently with separate KMS handles.

```go
import "golang.org/x/crypto/hkdf"

masterKey := loadMaster() // 32 bytes
signKey := deriveKey(masterKey, "sign-v1", 32)
encKey  := deriveKey(masterKey, "enc-v1", 32)

func deriveKey(master []byte, info string, n int) []byte {
    h := hkdf.New(sha256.New, master, nil, []byte(info))
    out := make([]byte, n)
    io.ReadFull(h, out)
    return out
}
```

The `info` string makes the derivation deterministic and labeled.
Two services can derive the same `signKey` from the same master if
they agree on the label, without coordinating directly.

## 14. Build pipeline hygiene

Crypto code in production lives or dies on what doesn't end up in
the build artifact. The audit list:

- **No keys in the source tree.** `git grep -i 'BEGIN.*PRIVATE'`
  on every PR. Pre-commit hooks catch most accidents.
- **No keys in `Dockerfile` ARGs that persist.** Multi-stage
  builds where the secret is only available to the build stage,
  not the final image, are the right pattern. Or use BuildKit
  secrets (`--mount=type=secret`) which never end up in layers.
- **No keys in environment variables logged at startup.** Many
  framework-default `log.Printf("env: %v", os.Environ())` paths
  exist; one of them will eventually log your `DB_PASSWORD`.
- **CI runners can't print keys.** A CI step that runs `printenv`
  for "debugging" is now a key disclosure path. Audit your job
  outputs.

For the "verify the binary doesn't ship secrets" check:

```sh
strings ./mybinary | grep -E 'BEGIN (RSA|EC|DSA|PGP|OPENSSH) PRIVATE'
strings ./mybinary | grep -E 'AKIA[0-9A-Z]{16}'
```

If either matches, your build is leaking. Add a CI step that fails
the build on a match.

## 15. Disaster planning

What's your plan for the day when:

- A signing key leaks publicly?
- A KMS region is unavailable?
- A cert authority you trust gets revoked?
- The OS RNG returns the same bytes twice (a real hardware bug)?

The plans:

1. **Key leak**: rotation flow you've practiced. Add the new key
   to the verifier before the issuer switches; remove the old key
   only after the longest-lived token expires. Have a "kill switch"
   that pushes the old key to a deny list immediately, accepting
   the disruption to in-flight tokens.
2. **KMS unavailable**: cache wrapped DEKs in process memory after
   first unwrap; serve reads from the cache during outages.
   Writes that need a fresh wrap fail loudly. Don't fall back to
   in-process keys.
3. **CA revocation**: maintain a list of *expected* CAs; alert
   when a cert presents an unexpected one. Have a script ready to
   pull a different CA.
4. **RNG anomaly**: integrate `crypto/rand`'s `Read` returning the
   same value twice as a panic-level event (it's a bug in the OS
   or CPU; the process should die rather than continue with broken
   randomness).

Run the runbook in a game day every quarter. The plans you haven't
practiced are theoretical and will fail the day you need them.

## 16. What to read next

- [find-bug.md](find-bug.md) — production-shaped crypto bugs:
  comparison-timing, nonce reuse, signature-skipping, leaked
  bearer tokens, expired-cert outages.
- [optimize.md](optimize.md) — when production correctness is fine
  but the throughput isn't.
- [interview.md](interview.md) — the questions an audit (or a
  thoughtful interviewer) will ask.
- External: the [OWASP Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html),
  RFC 8725 (JWT BCP), and Filippo Valsorda's blog posts on Go's
  crypto stack are the canonical references.
