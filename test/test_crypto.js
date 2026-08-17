// ============================================================
//  CRYPTO TESTS — real crypto.js, no mocks (pure functions,
//  no network/Redis/chain involved, safe to test directly).
//  Verifies the actual encrypt/decrypt round trip used to store
//  private keys, plus API key hashing behavior.
//
//  Run: node test/test_crypto.js  (or `npm test`)
// ============================================================

process.env.ENCRYPTION_KEY = "a".repeat(64); // 32-byte hex key for this test run only

const { encrypt, decrypt, hashApiKey, generateApiKey, newProfileId } = require("../api/lib/crypto");

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); }
  else { console.error(`  ❌ ${msg}`); failures++; }
}

function main() {
  console.log("\n── Encrypt/decrypt round trip ──");
  const pk = "4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318".slice(0, 64);
  const enc = encrypt(pk);
  assert(typeof enc.iv === "string" && typeof enc.ciphertext === "string" && typeof enc.authTag === "string",
    "encrypt() returns iv/ciphertext/authTag as strings");
  assert(enc.ciphertext !== pk, "ciphertext does not equal the plaintext");

  const dec = decrypt(enc);
  assert(dec === pk, "decrypt() recovers the exact original private key");

  console.log("\n── Tamper detection ──");
  let tamperThrew = false;
  try {
    decrypt({ ...enc, ciphertext: enc.ciphertext.slice(0, -2) + "ff" });
  } catch { tamperThrew = true; }
  assert(tamperThrew, "Decrypting a tampered ciphertext throws (auth tag mismatch)");

  console.log("\n── Different plaintexts never produce the same ciphertext ──");
  const encA = encrypt(pk);
  const encB = encrypt(pk);
  assert(encA.ciphertext !== encB.ciphertext, "Same plaintext encrypted twice yields different ciphertext (random IV)");
  assert(decrypt(encA) === decrypt(encB), "...but both still decrypt back to the same original value");

  console.log("\n── API key hashing ──");
  const h1 = hashApiKey("my-secret-key-123");
  const h2 = hashApiKey("my-secret-key-123");
  const h3 = hashApiKey("a-different-key-456");
  assert(h1 === h2, "Same API key always hashes to the same value (lookup is deterministic)");
  assert(h1 !== h3, "Different API keys hash to different values");
  assert(h1.length === 64, "Hash is a 64-char hex string (SHA-256)");

  console.log("\n── Generators ──");
  const genKey = generateApiKey();
  assert(genKey.length === 40 && /^[0-9a-f]{40}$/.test(genKey), "generateApiKey() returns a 40-char hex string");
  const id1 = newProfileId(), id2 = newProfileId();
  assert(id1 !== id2, "newProfileId() returns unique values");

  console.log("\n" + "─".repeat(50));
  if (failures === 0) { console.log("✅ ALL CRYPTO TESTS PASSED"); process.exit(0); }
  else { console.log(`❌ ${failures} TEST(S) FAILED`); process.exit(1); }
}

main();
