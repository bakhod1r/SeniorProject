# 8.13 `crypto/*` — Junior

> **Audience.** You've heard of SHA-256 and `bcrypt`, you've copy-pasted
> AES code from Stack Overflow once, and you're not entirely sure when
> to use `math/rand` versus `crypto/rand`. By the end of this file you
> will know the four packages that matter on day one — `crypto`,
> `crypto/sha256`, `crypto/hmac`, `crypto/rand` — plus the single
> AEAD cipher you should reach for, the four mistakes that ship to
> production every week, and one sentence that summarizes the entire
> file: **never invent your own protocol, and never use `math/rand` for
> anything that has to be unguessable**.

## 1. Two rules, then everything else

These two rules cover most security incidents written in Go:

1. **Don't roll your own.** If you're combining primitives in a
   creative way, you're almost certainly building something subtly
   broken. Use AEAD (AES-GCM or ChaCha20-Poly1305) for encryption.
   Use HMAC for message authentication. Use `argon2id` for password
   hashing. Use TLS for transport. If your design doesn't fit one of
   those, the design is wrong, not the primitive.

2. **`math/rand` is not random.** `math/rand` produces predictable
   numbers. It is fine for shuffling a deck of cards in a game. It is
   catastrophic for tokens, IDs, nonces, keys, password reset codes,
   or any byte an attacker would benefit from guessing. The only RNG
   you should use for security is `crypto/rand`.

Internalize those two and you've already avoided the majority of
crypto bugs in production Go. The rest of this file shows you the
APIs that implement them correctly.

## 2. The `hash.Hash` interface

Every cryptographic hash in the stdlib implements one tiny interface:

```go
type Hash interface {
    io.Writer                       // feed it data
    Sum(b []byte) []byte            // finalize, append digest to b
    Reset()                         // start over
    Size() int                      // digest size in bytes
    BlockSize() int                 // internal block size
}
```

The pattern never changes:

```go
import "crypto/sha256"

h := sha256.New()
h.Write([]byte("hello, world"))
sum := h.Sum(nil) // []byte of length 32
fmt.Printf("%x\n", sum)
```

Because `hash.Hash` is also an `io.Writer`, you can stream data through
it with `io.Copy`, `io.TeeReader`, or any wrapper that takes a writer:

```go
f, err := os.Open("big.iso")
if err != nil { return err }
defer f.Close()

h := sha256.New()
if _, err := io.Copy(h, f); err != nil { return err }
fmt.Printf("%x\n", h.Sum(nil))
```

That's a streaming SHA-256 of a multi-gigabyte file in three lines and
constant memory. The same pattern works with any other hash.

For a one-shot digest of a small `[]byte`, the convenience function:

```go
sum := sha256.Sum256(data) // [32]byte (note: array, not slice)
```

`sha256.Sum256` returns a fixed-size array, which is annoying when you
want to pass it to `[]byte` APIs. Slice it:

```go
fmt.Printf("%x\n", sum[:])
```

## 3. The hashes you should know

| Algorithm | Output | Use it for | Notes |
|-----------|--------|------------|-------|
| `sha256.New()` | 32 bytes | The default. File hashes, HMAC, content addressing | Strong, fast on most CPUs |
| `sha512.New()` | 64 bytes | When you need more output bits | Faster than SHA-256 on 64-bit CPUs |
| `sha512.New384()` | 48 bytes | When a spec asks for SHA-384 (TLS, JWS) | |
| `sha1.New()` | 20 bytes | **Legacy**. Git, old TLS. Don't use for new things | Collisions are practical |
| `md5.New()` | 16 bytes | **Legacy**. Don't use for security at all | Trivially broken |
| `sha3.New256()` | 32 bytes | When a spec asks for SHA-3 | In `golang.org/x/crypto/sha3`, not stdlib |

The default for new code is **SHA-256**. There's no reason to pick
something else unless a spec or interop requirement says so.

`md5` and `sha1` are still in the stdlib because real systems still use
them — Git uses SHA-1, MD5 still appears in checksums and content
addressing of legacy files. They are *not* secure in the cryptographic
sense (resistance to a determined attacker). Use them for non-security
purposes only, and even then SHA-256 is usually the better default.

## 4. HMAC — the right way to authenticate a message

The textbook bug: you concatenate a secret with a message and hash it,
then send `(message, hash)` to the recipient who recomputes the hash
and compares. That's broken. SHA-256 of `secret || message` is
vulnerable to length-extension attacks. The fix is **HMAC**, which is
what every spec requires.

```go
import (
    "crypto/hmac"
    "crypto/sha256"
)

key := []byte("super-secret-shared-key")
msg := []byte("user=42&action=delete")

mac := hmac.New(sha256.New, key)
mac.Write(msg)
tag := mac.Sum(nil) // []byte of length 32
```

`hmac.New` returns a `hash.Hash` that's keyed with `key`. You feed it
the message the same way you feed `sha256.Sum256`. The output is the
authentication tag.

To verify on the other side:

```go
expected := hmac.New(sha256.New, key)
expected.Write(msg)
if !hmac.Equal(tag, expected.Sum(nil)) {
    return errors.New("bad MAC")
}
```

**`hmac.Equal` is critical.** It's a constant-time comparison —
running time depends only on the length of the inputs, not on where
they first differ. If you use `bytes.Equal` instead, an attacker can
measure response timing and recover the tag byte by byte. This is a
real attack, not a theoretical one. The rule: **never compare MACs,
hashes, or tokens with `==` or `bytes.Equal`. Always use
`hmac.Equal` or `subtle.ConstantTimeCompare`.**

## 5. `crypto/rand` — the only RNG you should use for security

```go
import "crypto/rand"

token := make([]byte, 32)
if _, err := rand.Read(token); err != nil {
    return err
}
fmt.Printf("%x\n", token) // 64 hex chars
```

That's it. `rand.Read` blocks until the OS RNG is seeded (rarely an
issue past boot) and fills the buffer with cryptographically secure
random bytes. The error is essentially never non-nil on a working
system, but check it anyway — on a misconfigured Linux container with
a broken `/dev/urandom`, this is the call that tells you.

For a random integer in `[0, max)`:

```go
n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
```

`rand.Int` does the modulo-bias-free thing for you. It returns a
`*big.Int`; convert to `int64` if you need it.

For a random prime (used by RSA key generation):

```go
p, err := rand.Prime(rand.Reader, 2048) // 2048-bit prime
```

You will rarely call this directly. `rsa.GenerateKey` uses it
internally.

### When to use `math/rand` instead

`math/rand` is fine for:

- Test fixtures and benchmarks where reproducibility helps.
- Game logic, simulations, jitter in retry backoff.
- Anything where an attacker guessing the value gives them nothing.

`math/rand` is **not** fine for:

- Session tokens, password reset codes, magic links.
- Encryption keys, MAC keys, IV/nonce generation.
- API keys, CSRF tokens, OAuth state parameters.
- Anything you'd be embarrassed to read in a CVE.

The Go 1.20+ default seed for `math/rand` is per-process random, but
the *output* is still a deterministic stream from that seed. Anyone
who guesses the seed predicts every future "random" number. The
attacker only needs a few outputs to recover the seed.

The rule, simplified: **if it's a security boundary, use `crypto/rand`.**

## 6. Generating tokens, IDs, and codes

The most common task: "give me a random URL-safe string of N bytes."

```go
import (
    "crypto/rand"
    "encoding/base64"
)

func newToken(nBytes int) (string, error) {
    b := make([]byte, nBytes)
    if _, err := rand.Read(b); err != nil { return "", err }
    return base64.RawURLEncoding.EncodeToString(b), nil
}

t, _ := newToken(32) // 43 url-safe chars, 256 bits of entropy
```

32 random bytes (256 bits) is the standard for session tokens and
similar high-value secrets. 16 bytes (128 bits) is the floor for
anything an attacker might want to brute-force.

For human-readable codes (think SMS verification "123456"), 6 digits
gives you only ~20 bits of entropy. That's fine because you also
rate-limit the number of guesses. Without rate limiting, six digits
is brute-forceable in seconds.

```go
n, _ := rand.Int(rand.Reader, big.NewInt(1_000_000))
code := fmt.Sprintf("%06d", n.Int64()) // "000042" .. "999999"
```

Note: `%06d` zero-pads. Without it, "42" becomes "42" not "000042"
and your code length varies — annoying for the user and for any
length-validating client.

## 7. AES-GCM — the AEAD you should default to

AEAD stands for Authenticated Encryption with Associated Data. It does
two things at once: encrypts the plaintext, and produces a tag that
authenticates both the ciphertext and an optional "associated data"
header. If anyone tampers with either, decryption fails.

The Go stdlib gives you AES-GCM via `crypto/cipher`:

```go
import (
    "crypto/aes"
    "crypto/cipher"
    "crypto/rand"
)

func encrypt(key, plaintext, aad []byte) ([]byte, error) {
    block, err := aes.NewCipher(key) // key must be 16, 24, or 32 bytes
    if err != nil { return nil, err }

    aead, err := cipher.NewGCM(block)
    if err != nil { return nil, err }

    nonce := make([]byte, aead.NonceSize()) // 12 bytes for GCM
    if _, err := rand.Read(nonce); err != nil { return nil, err }

    // Seal returns nonce || ciphertext || tag
    return aead.Seal(nonce, nonce, plaintext, aad), nil
}

func decrypt(key, ciphertext, aad []byte) ([]byte, error) {
    block, err := aes.NewCipher(key)
    if err != nil { return nil, err }

    aead, err := cipher.NewGCM(block)
    if err != nil { return nil, err }

    if len(ciphertext) < aead.NonceSize() {
        return nil, errors.New("ciphertext too short")
    }
    nonce, ct := ciphertext[:aead.NonceSize()], ciphertext[aead.NonceSize():]
    return aead.Open(nil, nonce, ct, aad)
}
```

Three things to internalize:

1. **The nonce must be unique per `(key, plaintext)` pair.** Repeating
   a nonce with the same key in GCM is *catastrophic*: an attacker
   who sees two ciphertexts under the same nonce can recover the
   XOR of the plaintexts and forge tags. **Always generate the
   nonce randomly with `crypto/rand`** unless you have a counter
   discipline you can prove correct.

2. **The nonce is prepended to the ciphertext.** That's the
   `aead.Seal(nonce, nonce, ...)` idiom — the first argument is the
   buffer to append to (`nonce`), the second is the nonce used for
   the encryption itself. The output is `nonce || ciphertext || tag`.
   The recipient splits it back apart.

3. **`aad` is authenticated, not encrypted.** Use it for headers that
   travel in the clear but must not be tampered with — record version,
   key ID, recipient ID. The receiver passes the same `aad` to `Open`
   or decryption fails.

The 12-byte nonce of GCM means you can safely encrypt about 2^32
messages under one key before nonce collision becomes likely (birthday
bound). For hotter keys, rotate.

## 8. Choosing a key

A 32-byte key is a 256-bit key, which is the AES-256 setting and the
right default. Where does it come from?

- **For storage** (disk encryption, vault): generate once with
  `crypto/rand`, store in a KMS/secret manager, never ship in code.
- **From a password**: never use the password directly. Run it through
  `argon2id` or `pbkdf2` (in `golang.org/x/crypto`, not stdlib) with
  a per-user salt. This is *key derivation*, covered in middle.md.
- **For TLS**: you don't pick this. The TLS library negotiates a
  session key with the peer.

The wrong source for a key is `[]byte("my super secret password")`.
Hard-coded keys end up on GitHub and breached within hours. They're
also low-entropy: a 16-character ASCII string has at most ~104 bits
of entropy, often much less in practice.

## 9. The four mistakes that ship every week

### Mistake 1: comparing MACs with `bytes.Equal`

```go
// WRONG — timing leak
if bytes.Equal(received, computed) { ... }

// CORRECT — constant time
if hmac.Equal(received, computed) { ... }
```

### Mistake 2: using `math/rand` for tokens

```go
// WRONG — predictable
import "math/rand"
b := make([]byte, 32)
rand.Read(b) // math/rand.Read is NOT secure

// CORRECT
import "crypto/rand"
b := make([]byte, 32)
crypto_rand.Read(b)
```

### Mistake 3: reusing GCM nonces

```go
// WRONG — fixed nonce
nonce := make([]byte, 12) // all zeroes
aead.Seal(nil, nonce, plaintext, nil)
aead.Seal(nil, nonce, otherText, nil) // catastrophic

// CORRECT
nonce := make([]byte, aead.NonceSize())
rand.Read(nonce)
```

Hard-coding a nonce ("just use a fixed one for simplicity") is a
ship-stopping bug. Reviewers should reject any PR that does this.

### Mistake 4: hashing the password directly

```go
// WRONG — fast hash, no salt, no work factor
sum := sha256.Sum256([]byte(userPassword))
db.Save(user, sum[:])

// CORRECT — use argon2 or bcrypt from x/crypto
hash, _ := argon2id.CreateHash(userPassword, argon2id.DefaultParams)
db.Save(user, hash)
```

SHA-256 of a password is brute-forceable at billions of guesses per
second on a GPU. Password hashing must be slow on purpose; that's what
`argon2id`, `scrypt`, `bcrypt`, and `pbkdf2` do.

Password hashing is **not in the standard library**. It's in
`golang.org/x/crypto`. Don't try to substitute SHA-256.

## 10. A complete example: signed cookies

Putting hashing, HMAC, and `crypto/rand` together — here's a minimal
signed cookie:

```go
package main

import (
    "crypto/hmac"
    "crypto/rand"
    "crypto/sha256"
    "encoding/base64"
    "errors"
    "fmt"
    "strings"
)

var key = mustKey() // 32 random bytes, generated once at startup

func mustKey() []byte {
    k := make([]byte, 32)
    if _, err := rand.Read(k); err != nil { panic(err) }
    return k
}

func sign(payload string) string {
    mac := hmac.New(sha256.New, key)
    mac.Write([]byte(payload))
    tag := mac.Sum(nil)
    return payload + "." + base64.RawURLEncoding.EncodeToString(tag)
}

func verify(token string) (string, error) {
    i := strings.LastIndex(token, ".")
    if i < 0 { return "", errors.New("malformed") }
    payload, b64tag := token[:i], token[i+1:]
    tag, err := base64.RawURLEncoding.DecodeString(b64tag)
    if err != nil { return "", err }

    mac := hmac.New(sha256.New, key)
    mac.Write([]byte(payload))
    if !hmac.Equal(tag, mac.Sum(nil)) {
        return "", errors.New("bad signature")
    }
    return payload, nil
}

func main() {
    t := sign("user=42")
    fmt.Println(t)
    p, err := verify(t)
    fmt.Println(p, err)
}
```

It's not complete (no expiration, no replay protection, no key
rotation), but it shows the shape: HMAC the payload, encode the tag,
compare with `hmac.Equal` on verify. middle.md adds expiration and
encryption.

## 11a. Hashing other things you'll meet

Every once in a while you'll meet a non-cryptographic hash and
wonder if you can use it for security. The short list to file
under "no":

| Hash | Use it for | Don't use it for |
|------|------------|------------------|
| FNV-1a (`hash/fnv`) | hash-table keys in maps | tokens, signatures, content addressing |
| `hash/crc32` | data integrity over a noisy channel | adversarial integrity |
| `hash/maphash` | randomized in-process hashing | anything stable across processes |
| `xxhash` (third-party) | fast deduplication | tokens, signatures |

The distinguishing question: "what does an attacker get if they can
make this hash collide?" If the answer is "nothing", a fast
non-cryptographic hash is fine. If the answer is "they can forge a
token / impersonate a user / replay a request", you need a
cryptographic hash and almost always SHA-256.

## 11b. Encoding random bytes for humans

Not all encodings are equal. The four you'll meet:

| Encoding | Use it for | Notes |
|----------|------------|-------|
| `hex` | Debug output, fingerprints | 2 chars per byte; case-insensitive |
| `base64.StdEncoding` | Email, MIME | 4 chars per 3 bytes; uses `+`, `/`, `=` padding — bad in URLs |
| `base64.URLEncoding` | URLs (with padding) | Replaces `+` with `-`, `/` with `_` |
| `base64.RawURLEncoding` | Tokens, JWTs | URL-safe and *no padding* |

For tokens that go in URLs or HTTP headers, `RawURLEncoding` is
the safe default. Padding (`=` characters) breaks some parsers and
adds noise without information. JWTs use `RawURLEncoding` by
spec — copy that habit.

## 11c. The "secret length" question

A common question: how many bytes for "enough" entropy?

| Bytes | Bits | Use case |
|-------|------|----------|
| 16 | 128 | Floor for any cryptographic secret. Symmetric keys, nonces, session IDs |
| 32 | 256 | Recommended default. Tokens, OAuth state, password reset codes |
| 64 | 512 | Overkill for most. Only when a spec demands it |

Generating less than 128 bits is asking for a brute-force write-up.
Generating more than 256 bits adds bytes without adding meaningful
security — the universe ends before an attacker tries 2^256 things.

## 11d. Verifying content with a known hash

Pattern: a download claims to have SHA-256 `<X>`; verify it on the
client.

```go
func verifyDownload(data []byte, expectedHex string) error {
    expected, err := hex.DecodeString(expectedHex)
    if err != nil { return err }
    actual := sha256.Sum256(data)
    if !hmac.Equal(actual[:], expected) {
        return errors.New("hash mismatch")
    }
    return nil
}
```

Note `hmac.Equal` even though this isn't a MAC — it's the constant-
time equality you should reach for. `bytes.Equal` would also work
*for non-secret* hashes, but the habit of always using
`hmac.Equal` for any byte-by-byte comparison of a security-relevant
value is worth more than saving the keystrokes.

## 11e. The boring crypto policy

A pattern Google has documented and many other shops follow: when
faced with a crypto choice, prefer the *boring* option — the most
widely deployed, most reviewed, most analyzed primitive that fits.
For Go in 2026 that's:

- SHA-256 for hashing.
- HMAC-SHA256 for symmetric MACs.
- AES-256-GCM for symmetric authenticated encryption.
- Ed25519 for new signatures.
- TLS 1.3 (with TLS 1.2 floor for compatibility) for transport.
- argon2id for password hashing.

Those are the right defaults. Don't reach for the newer or more
exotic primitive unless you have a real reason — a spec demand,
a hardware constraint, an interop requirement. The boring choice
is boring because thousands of audits and decades of attacks have
already happened to it; your traffic isn't the test.

When you read a code review and someone says "let's use Schnorr
signatures because they're cooler," the right response is "what
problem does that solve that Ed25519 doesn't?" Ninety percent of
the time, the answer reveals there isn't one.

## 12. The Reader interface for `crypto/rand`

`crypto/rand.Reader` is exported as a `var Reader io.Reader`. This
is a deliberate piece of API design: any function that needs
random bytes should take an `io.Reader`, and your code passes
`rand.Reader` (in production) or a deterministic stream (in
tests).

```go
import "crypto/rand"

priv, _ := ed25519.GenerateKey(rand.Reader)
priv2, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
sig, _ := ecdsa.SignASN1(rand.Reader, priv2, digest)
```

Most stdlib functions that need randomness accept `io.Reader`.
This is also why `nil` works in some places — when a function
treats `nil` as "use `rand.Reader`", that's a convenience, but
explicit is better.

For tests, you sometimes want determinism. The right pattern is to
construct a deterministic but unpredictable-looking reader from a
seed:

```go
import (
    "crypto/sha256"
    "encoding/binary"
    "io"
)

type seedReader struct {
    counter uint64
    seed    [32]byte
}

func (r *seedReader) Read(p []byte) (int, error) {
    n := 0
    for n < len(p) {
        var nonce [8]byte
        binary.BigEndian.PutUint64(nonce[:], r.counter)
        block := sha256.Sum256(append(r.seed[:], nonce[:]...))
        copied := copy(p[n:], block[:])
        n += copied
        r.counter++
    }
    return n, nil
}
```

This `Reader` is deterministic given a seed, so tests are
reproducible, but it's not predictable to anyone who doesn't know
the seed. Don't use it in production — that's `crypto/rand.Reader`'s
job.

## 13. What about TLS?

TLS is the right transport for almost every network call. Go's
`net/http` already uses it for `https://` URLs by default. You rarely
need to configure it manually as a client. As a server, you call
`http.ListenAndServeTLS` and that's most of the job.

For now, two facts:

1. **Use HTTPS everywhere.** If you're writing an internal service
   and somebody says "we don't need TLS, we're behind a firewall,"
   they're wrong. The firewall does not stop the database admin
   running tcpdump.
2. **Trust the defaults.** `tls.Config{}` in modern Go is sane out
   of the box: TLS 1.2 minimum, strong cipher suites only, server
   verification on. Don't set `InsecureSkipVerify: true` to fix a
   cert error — fix the cert.

senior.md covers TLS in depth: configuration, client auth, hot
reload of certificates, and the real meaning of `InsecureSkipVerify`.

## 14. Common errors at this level

| Symptom | Likely cause |
|---------|--------------|
| `cipher: incorrect key size` | AES key not 16, 24, or 32 bytes |
| `cipher: message authentication failed` | Wrong key, tampered ciphertext, or wrong AAD |
| `chacha20poly1305: bad key length` | ChaCha20-Poly1305 needs exactly 32 bytes |
| Random sometimes empty in container | `/dev/urandom` not present in chroot or scratch image |
| Tokens guessable | `math/rand` instead of `crypto/rand` |
| MAC verifies on wrong message | Compared with `bytes.Equal` and got a timing leak (but probably also a logic bug) |
| Decryption succeeds on tampered ciphertext | Used `cipher.NewCTR` or `NewCBC` without an AEAD wrapper. Use GCM. |

## 15. The five-line review checklist

When a colleague pushes a PR that touches crypto, your eyes scan
for these five patterns. Each one takes a second and catches the
common bugs:

1. **Is `crypto/rand` imported, not `math/rand`?** Search for
   `math/rand`. Any use near a token, key, ID, or nonce is a bug.
2. **Is comparison done with `hmac.Equal` or
   `subtle.ConstantTimeCompare`?** Search for `bytes.Equal` and
   `==` near tag/digest/secret variables.
3. **Is the AEAD nonce random per-message?** Look at every call
   to `aead.Seal`. The second argument should come from a fresh
   `rand.Read`, not from a constant or a counter that resets.
4. **Is `InsecureSkipVerify` true?** If yes and there's no
   accompanying `VerifyConnection` doing pinning, that's a bug.
5. **Are passwords hashed with argon2/bcrypt?** Search for
   `sha256.Sum256` or `sha512.Sum512` near a password variable.

These five take ten seconds and catch the majority of crypto bugs
that ship.

## 16. What to read next

- [middle.md](middle.md) — streaming AEAD, RSA/ECDSA/Ed25519 sign and
  verify, X.509 basics, key derivation from passwords.
- [senior.md](senior.md) — TLS configuration, mTLS, cert rotation,
  side channels, and `crypto/subtle`.
- [tasks.md](tasks.md) — exercises that put this junior material into
  practice.
- The official package docs: [`crypto`](https://pkg.go.dev/crypto),
  [`crypto/aes`](https://pkg.go.dev/crypto/aes),
  [`crypto/cipher`](https://pkg.go.dev/crypto/cipher),
  [`crypto/hmac`](https://pkg.go.dev/crypto/hmac),
  [`crypto/rand`](https://pkg.go.dev/crypto/rand),
  [`crypto/sha256`](https://pkg.go.dev/crypto/sha256).
