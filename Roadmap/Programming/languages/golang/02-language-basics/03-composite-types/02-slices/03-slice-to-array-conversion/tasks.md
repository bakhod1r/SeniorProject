# Slice to Array Conversion — Tasks

## Task 1: Basic Conversion Practice (Junior)

**Description:** Write three functions demonstrating the three ways to convert a slice to an array.

**Starter Code:**
```go
package main

import "fmt"

// Method 1: pointer conversion (Go 1.17+)
func toPointer(s []int) *[4]int {
    // TODO: convert s to *[4]int (check length first)
}

// Method 2: value conversion (Go 1.20+)
func toValue(s []int) [4]int {
    // TODO: convert s to [4]int
}

// Method 3: classic copy
func toCopy(s []int) [4]int {
    // TODO: use copy(arr[:], s)
}

func main() {
    s := []int{10, 20, 30, 40, 50}

    ptr := toPointer(s)
    fmt.Println(*ptr) // [10 20 30 40]

    val := toValue(s)
    fmt.Println(val)  // [10 20 30 40]

    cpy := toCopy(s)
    fmt.Println(cpy)  // [10 20 30 40]
}
```

**Expected Output:**
```
[10 20 30 40]
[10 20 30 40]
[10 20 30 40]
```

**Evaluation Checklist:**
- [ ] Pointer form: `(*[4]int)(s)`
- [ ] Value form: `[4]int(s)`
- [ ] Copy form: `var arr [4]int; copy(arr[:], s)`
- [ ] All return correct values
- [ ] Length validation in pointer form

---

## Task 2: Shared Memory Demonstration (Junior)

**Description:** Write a program that proves pointer conversion shares memory and value conversion doesn't.

**Starter Code:**
```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3, 4, 5}

    // TODO: get pointer conversion
    // modify ptr[0] = 999
    // print s[0] — should be 999 (shared!)

    // TODO: get value conversion
    // modify arr[0] = 777
    // print s[0] — should still be 999 (not shared!)

    // Expected output:
    // After ptr modification: s[0] = 999
    // After arr modification: s[0] = 999
}
```

**Expected Output:**
```
After ptr modification: s[0] = 999
After arr modification: s[0] = 999
```

**Evaluation Checklist:**
- [ ] Correctly demonstrates pointer sharing
- [ ] Correctly demonstrates value independence
- [ ] Both modifications tested
- [ ] Output clearly shows the distinction

---

## Task 3: IPv4 Address Parser (Middle)

**Description:** Implement an IPv4 address type using `[4]byte` and convert from `[]byte`.

**Starter Code:**
```go
package main

import "fmt"

type IPv4 [4]byte

func (ip IPv4) String() string {
    return fmt.Sprintf("%d.%d.%d.%d", ip[0], ip[1], ip[2], ip[3])
}

func ParseIPv4(b []byte) (IPv4, error) {
    // TODO: validate length, convert using [4]byte(b)
}

func (ip IPv4) IsLoopback() bool {
    // TODO: return true if ip[0] == 127
}

func (ip IPv4) IsPrivate() bool {
    // TODO: check 10.x, 172.16-31.x, 192.168.x ranges
}

func main() {
    tests := [][]byte{
        {127, 0, 0, 1},
        {192, 168, 1, 100},
        {10, 0, 0, 1},
        {8, 8, 8, 8},
        {1, 2},         // too short
    }

    for _, b := range tests {
        ip, err := ParseIPv4(b)
        if err != nil {
            fmt.Printf("Error: %v\n", err)
            continue
        }
        fmt.Printf("%s loopback=%v private=%v\n",
            ip, ip.IsLoopback(), ip.IsPrivate())
    }
}
```

**Expected Output:**
```
127.0.0.1 loopback=true private=false
192.168.1.100 loopback=false private=true
10.0.0.1 loopback=false private=true
8.8.8.8 loopback=false private=false
Error: need 4 bytes, got 2
```

**Evaluation Checklist:**
- [ ] `ParseIPv4` validates len >= 4 and returns error if not
- [ ] Uses `[4]byte(b)` for conversion
- [ ] `IsLoopback()` correct for 127.x.x.x
- [ ] `IsPrivate()` handles all three private ranges
- [ ] `String()` method formats correctly

---

## Task 4: Fixed-Size Hash Comparison (Middle)

**Description:** Implement content-addressed storage using `[32]byte` as map keys, converting from `[]byte` hashes.

**Starter Code:**
```go
package main

import (
    "crypto/sha256"
    "fmt"
)

type ContentStore struct {
    // TODO: map[[32]byte][]byte
}

func NewContentStore() *ContentStore {
    // TODO
}

func (cs *ContentStore) Store(data []byte) [32]byte {
    // TODO: compute sha256, store, return hash
}

func (cs *ContentStore) Retrieve(hashBytes []byte) ([]byte, bool) {
    // TODO: convert hashBytes to [32]byte key, lookup
}

func (cs *ContentStore) Has(hashBytes []byte) bool {
    // TODO: check if key exists
}

func main() {
    store := NewContentStore()

    h1 := store.Store([]byte("hello world"))
    h2 := store.Store([]byte("foo bar"))

    data, ok := store.Retrieve(h1[:])
    fmt.Println(ok, string(data)) // true hello world

    fmt.Println(store.Has(h2[:]))  // true
    fmt.Println(store.Has(make([]byte, 32))) // false
}
```

**Expected Output:**
```
true hello world
true
false
```

**Evaluation Checklist:**
- [ ] Map uses `[32]byte` as key type
- [ ] `Store` uses `sha256.Sum256` and stores correctly
- [ ] `Retrieve` uses `[32]byte(hashBytes)` for key conversion
- [ ] `Has` correctly checks existence
- [ ] Short hashBytes handled in Retrieve/Has

---

## Task 5: Network Frame Parser (Middle)

**Description:** Parse a binary protocol frame with a fixed 8-byte header using zero-copy pointer conversion.

**Starter Code:**
```go
package main

import (
    "encoding/binary"
    "errors"
    "fmt"
)

const FrameHeaderSize = 8

type FrameHeader struct {
    Magic   uint32
    Length  uint32
}

type Frame struct {
    Header FrameHeader
    Body   []byte
}

var ErrShortFrame = errors.New("frame too short")
var ErrInvalidMagic = errors.New("invalid magic number")

const FrameMagic = 0xDEADBEEF

func ParseFrame(data []byte) (*Frame, error) {
    // TODO:
    // 1. Check len(data) >= 8
    // 2. Use (*[8]byte)(data[:8]) for zero-copy header read
    // 3. Parse magic and length from header bytes
    // 4. Validate magic == FrameMagic
    // 5. Check len(data) >= 8+length
    // 6. Return Frame with Header and Body
}

func main() {
    // Build a test frame
    frame := make([]byte, 16)
    binary.BigEndian.PutUint32(frame[0:4], FrameMagic)
    binary.BigEndian.PutUint32(frame[4:8], 8) // body length = 8
    copy(frame[8:], []byte("TESTDATA"))

    f, err := ParseFrame(frame)
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    fmt.Printf("Magic: 0x%X\n", f.Header.Magic)
    fmt.Printf("Body: %s\n", f.Body)

    // Test error cases
    _, err = ParseFrame([]byte{1, 2, 3})
    fmt.Println(err) // frame too short

    bad := make([]byte, 8)
    _, err = ParseFrame(bad)
    fmt.Println(err) // invalid magic number
}
```

**Expected Output:**
```
Magic: 0xDEADBEEF
Body: TESTDATA
frame too short
invalid magic number
```

**Evaluation Checklist:**
- [ ] Uses `(*[8]byte)(data[:8])` for zero-copy header parsing
- [ ] Validates magic number
- [ ] Returns appropriate errors
- [ ] Body is a sub-slice of data (not a copy)
- [ ] Handles short data correctly

---

## Task 6: MAC Address Type (Middle)

**Description:** Implement a `MACAddress` type backed by `[6]byte` with parsing and formatting.

**Starter Code:**
```go
package main

import (
    "fmt"
    "strings"
)

type MACAddress [6]byte

func ParseMAC(b []byte) (MACAddress, error) {
    // TODO: validate len >= 6, convert
}

func ParseMACString(s string) (MACAddress, error) {
    // TODO: parse "AA:BB:CC:DD:EE:FF" format
    // split by ":", parse each hex pair
}

func (m MACAddress) String() string {
    // TODO: format as "AA:BB:CC:DD:EE:FF"
}

func (m MACAddress) IsBroadcast() bool {
    return m == MACAddress{0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF}
}

func main() {
    raw := []byte{0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF}
    mac, _ := ParseMAC(raw)
    fmt.Println(mac) // AA:BB:CC:DD:EE:FF

    mac2, _ := ParseMACString("FF:FF:FF:FF:FF:FF")
    fmt.Println(mac2.IsBroadcast()) // true

    mac3, err := ParseMAC([]byte{1, 2, 3})
    fmt.Println(err) // need 6 bytes, got 3
    _ = mac3
    _ = strings.Split
}
```

**Expected Output:**
```
AA:BB:CC:DD:EE:FF
true
need 6 bytes, got 3
```

**Evaluation Checklist:**
- [ ] `ParseMAC` uses `[6]byte(b)` conversion
- [ ] `ParseMACString` correctly parses hex format
- [ ] `String()` outputs correct format
- [ ] `IsBroadcast()` uses array comparison (not loop)
- [ ] Error cases handled

---

## Task 7: Cryptographic Key Derivation (Senior)

**Description:** Implement a key derivation function that uses slice-to-array conversions for type safety.

**Starter Code:**
```go
package main

import (
    "crypto/hmac"
    "crypto/sha256"
    "fmt"
)

type MasterKey [32]byte
type DerivedKey [32]byte

func NewMasterKey(raw []byte) (MasterKey, error) {
    // TODO: validate len == 32, convert, return
}

func DeriveKey(master MasterKey, context string) DerivedKey {
    // TODO: use HMAC-SHA256(master[:], []byte(context))
    // convert result to DerivedKey via [32]byte conversion
}

func (k DerivedKey) Equal(other []byte) bool {
    // TODO: convert other to [32]byte and compare with k
    // Return false if len(other) != 32
}

func main() {
    rawKey := make([]byte, 32)
    for i := range rawKey { rawKey[i] = byte(i) }

    master, err := NewMasterKey(rawKey)
    if err != nil {
        panic(err)
    }

    enc := DeriveKey(master, "encryption")
    mac := DeriveKey(master, "authentication")

    fmt.Printf("Enc key: %x...\n", enc[:4])
    fmt.Printf("MAC key: %x...\n", mac[:4])

    // Verify determinism
    enc2 := DeriveKey(master, "encryption")
    fmt.Println("Deterministic:", enc.Equal(enc2[:]))

    _, err = NewMasterKey(rawKey[:16])
    fmt.Println("Short key error:", err != nil) // true

    _ = hmac.New
    _ = sha256.New
}
```

**Expected Output:**
```
Enc key: [some 4 hex bytes]...
MAC key: [different 4 hex bytes]...
Deterministic: true
Short key error: true
```

**Evaluation Checklist:**
- [ ] `NewMasterKey` validates exactly 32 bytes
- [ ] `DeriveKey` uses HMAC-SHA256 correctly
- [ ] Result converted to `DerivedKey` via `[32]byte(hash)` or assignment
- [ ] `Equal` converts other to `[32]byte` before comparing
- [ ] `Equal` returns false for wrong length
- [ ] Keys for different contexts are different

---

## Task 8: Binary File Header Reader (Senior)

**Description:** Parse a binary file format with multiple fixed-size sections using array conversions.

**Starter Code:**
```go
package main

import (
    "encoding/binary"
    "fmt"
    "io"
)

// File format:
// Offset 0-3:   Magic "GOFM" (4 bytes)
// Offset 4-7:   Version (uint32, big-endian)
// Offset 8-15:  Timestamp (uint64, big-endian)
// Offset 16-47: Reserved (32 bytes)
// Offset 48+:   Data sections

type FileHeader struct {
    Magic     [4]byte
    Version   uint32
    Timestamp uint64
    Reserved  [32]byte
}

func ParseFileHeader(r io.Reader) (*FileHeader, error) {
    // TODO:
    // Read 48 bytes into a buffer
    // Use array conversions to extract each field
    // Validate magic == "GOFM"
}

func main() {
    // Build test data
    buf := make([]byte, 64)
    copy(buf[0:4], "GOFM")
    binary.BigEndian.PutUint32(buf[4:8], 1)
    binary.BigEndian.PutUint64(buf[8:16], 1711584000) // 2024-03-28 00:00:00

    r := &mockReader{data: buf}
    hdr, err := ParseFileHeader(r)
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    fmt.Printf("Magic: %s\n", hdr.Magic)
    fmt.Printf("Version: %d\n", hdr.Version)
    fmt.Printf("Timestamp: %d\n", hdr.Timestamp)
}

type mockReader struct {
    data []byte
    pos  int
}

func (m *mockReader) Read(p []byte) (int, error) {
    n := copy(p, m.data[m.pos:])
    m.pos += n
    if n == 0 { return 0, io.EOF }
    return n, nil
}
```

**Expected Output:**
```
Magic: GOFM
Version: 1
Timestamp: 1711584000
```

**Evaluation Checklist:**
- [ ] Reads exactly 48 bytes using `io.ReadFull`
- [ ] Uses array conversion for magic `[4]byte(buf[0:4])`
- [ ] Uses array conversion for reserved `[32]byte(buf[16:48])`
- [ ] Validates magic number
- [ ] Parses version and timestamp correctly

---

## Task 9: ARP Packet Parser (Senior)

**Description:** Parse ARP (Address Resolution Protocol) packets using fixed-size array conversions.

**Starter Code:**
```go
package main

import (
    "encoding/binary"
    "fmt"
)

type ARPPacket struct {
    HardwareType uint16
    ProtocolType uint16
    HardwareSize uint8
    ProtocolSize uint8
    Operation    uint16
    SenderMAC    [6]byte
    SenderIP     [4]byte
    TargetMAC    [6]byte
    TargetIP     [4]byte
}

const ARPPacketSize = 28

func ParseARP(data []byte) (*ARPPacket, error) {
    // TODO:
    // Check len >= 28
    // Parse each field using appropriate conversions
    // Use (*[N]byte) for zero-copy reading
}

func (p *ARPPacket) IsRequest() bool { return p.Operation == 1 }
func (p *ARPPacket) IsReply() bool   { return p.Operation == 2 }

func main() {
    // ARP Request: who has 192.168.1.1? Tell 192.168.1.100
    packet := []byte{
        0x00, 0x01,                         // HW type: Ethernet
        0x08, 0x00,                         // Protocol: IPv4
        0x06,                               // HW size: 6
        0x04,                               // Protocol size: 4
        0x00, 0x01,                         // Operation: Request
        0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, // Sender MAC
        192, 168, 1, 100,                   // Sender IP
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // Target MAC (unknown)
        192, 168, 1, 1,                     // Target IP
    }

    arp, err := ParseARP(packet)
    if err != nil { panic(err) }

    fmt.Printf("Request: %v\n", arp.IsRequest()) // true
    fmt.Printf("Sender MAC: %X\n", arp.SenderMAC)
    fmt.Printf("Sender IP: %d.%d.%d.%d\n",
        arp.SenderIP[0], arp.SenderIP[1],
        arp.SenderIP[2], arp.SenderIP[3])
    fmt.Printf("Target IP: %d.%d.%d.%d\n",
        arp.TargetIP[0], arp.TargetIP[1],
        arp.TargetIP[2], arp.TargetIP[3])
    _ = binary.BigEndian
}
```

**Expected Output:**
```
Request: true
Sender MAC: AABBCCDDEEFF
Sender IP: 192.168.1.100
Target IP: 192.168.1.1
```

**Evaluation Checklist:**
- [ ] Validates `len(data) >= 28`
- [ ] Uses pointer conversion for MAC addresses (6 bytes)
- [ ] Uses pointer or value conversion for IP addresses (4 bytes)
- [ ] Parses uint16 fields correctly with binary.BigEndian
- [ ] `IsRequest()` and `IsReply()` work correctly

---

## Task 10: Sliding Window with Fixed Array (Senior)

**Description:** Compute HMAC over sliding windows of a data stream using fixed-size array conversion to avoid allocations.

**Starter Code:**
```go
package main

import (
    "crypto/hmac"
    "crypto/sha256"
    "fmt"
)

const windowSize = 16

type WindowHMAC [32]byte

func computeWindowHMACs(data []byte, key []byte) []WindowHMAC {
    if len(data) < windowSize {
        return nil
    }

    n := len(data) - windowSize + 1
    results := make([]WindowHMAC, n)

    // TODO:
    // For each window position i:
    //   window := data[i : i+windowSize]
    //   Convert window to *[windowSize]byte for zero-copy
    //   Compute HMAC-SHA256 and convert result to WindowHMAC
    //   Store in results[i]

    return results
}

func main() {
    data := []byte("Hello World! This is test data...")
    key := []byte("secret-key")

    hashes := computeWindowHMACs(data, key)
    fmt.Printf("Windows: %d\n", len(hashes))
    fmt.Printf("First hash: %x...\n", hashes[0][:4])
    fmt.Printf("Last hash:  %x...\n", hashes[len(hashes)-1][:4])

    // Verify: adjacent windows should differ
    fmt.Printf("Different: %v\n", hashes[0] != hashes[1])
    _ = hmac.New
    _ = sha256.New
}
```

**Expected Output:**
```
Windows: 17
First hash: [some bytes]...
Last hash:  [different bytes]...
Different: true
```

**Evaluation Checklist:**
- [ ] Pre-allocates results with correct count
- [ ] Uses `(*[16]byte)(data[i:i+16])` or `[16]byte(data[i:i+16])`
- [ ] Computes HMAC correctly for each window
- [ ] Stores result using `WindowHMAC(mac)` or `[32]byte(...)`
- [ ] No unnecessary allocations in the loop (reuse mac buffer if possible)
