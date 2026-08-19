// ============================================================
//  CRYPTO TESTS — real crypto.js, no mocks (pure functions,
//  no network/Redis/chain involved, safe to test directly).
//  Verifies the wallet-key encrypt/decrypt round trip, password
//  hashing (bcrypt) for username/password login, and session
//  token hashing used for the "stay signed in forever" sessions.
//
//  Run: node test/test_crypto.js  (or `npm test`)
// ============================================================

process.env.ENCRYPTION_KEY = "a".repeat(64); // 32-byte hex key for this test run only

const {
  encrypt, decrypt,
  hashPassword, verifyPassword,
  hashToken, generateSessionToken, newProfileId,
} = require("../api/lib/crypto");

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); }
  else { console.error(`  ❌ ${msg}`); failures++; }
}

async function main() {
  console.log("\n── Wallet key encrypt/decrypt round trip ──");
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

  console.log("\n── Password hashing (bcrypt) ──");
  const pwHash = await hashPassword("correct horse battery staple");
  assert(typeof pwHash === "string" && pwHash.startsWith("$2"), "hashPassword() returns a bcrypt hash string");
  assert(pwHash !== "correct horse battery staple", "Hash does not equal the plaintext password");

  const okMatch = await verifyPassword("correct horse battery staple", pwHash);
  assert(okMatch === true, "verifyPassword() accepts the correct password");

  const badMatch = await verifyPassword("wrong password", pwHash);
  assert(badMatch === false, "verifyPassword() rejects an incorrect password");

  const hash2 = await hashPassword("correct horse battery staple");
  assert(hash2 !== pwHash, "Hashing the same password twice yields different hashes (bcrypt salt)");
  assert(await verifyPassword("correct horse battery staple", hash2), "...but both still verify correctly");

  console.log("\n── Session token hashing (fast lookup, not for passwords) ──");
  const t1 = generateSessionToken();
  const t2 = generateSessionToken();
  assert(t1 !== t2, "generateSessionToken() returns unique values");
  assert(/^[0-9a-f]{48}$/.test(t1), "Session token is a 48-char hex string");

  const h1 = hashToken(t1);
  const h2 = hashToken(t1);
  assert(h1 === h2, "Hashing the same token always yields the same hash (deterministic lookup)");
  assert(h1 !== hashToken(t2), "Different tokens hash to different values");
  assert(h1.length === 64, "Token hash is a 64-char hex string (SHA-256)");

  console.log("\n── Profile ID generator ──");
  const id1 = newProfileId(), id2 = newProfileId();
  assert(id1 !== id2, "newProfileId() returns unique values");

  console.log("\n" + "─".repeat(50));
  if (failures === 0) { console.log("✅ ALL CRYPTO TESTS PASSED"); process.exit(0); }
  else { console.log(`❌ ${failures} TEST(S) FAILED`); process.exit(1); }
}

main().catch(e => { console.error("❌ Test crashed:", e); process.exit(1); });
