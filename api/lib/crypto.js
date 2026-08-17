// ============================================================
//  CRYPTO HELPERS
//  AES-256-GCM encryption for stored wallet private keys, plus
//  API key hashing/generation for the per-profile auth system.
//
//  ENCRYPTION_KEY (env var) is the ONE secret that lets the
//  server decrypt any profile's wallet key — this is what makes
//  24/7 unattended trading possible (no per-user passphrase is
//  needed at trade time). Keep it as secret as the private keys
//  themselves; anyone with this + Redis access can decrypt every
//  connected wallet.
// ============================================================

const crypto = require("crypto");
const ALGO   = "aes-256-gcm";

function getEncryptionKey() {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "ENCRYPTION_KEY must be set in .env as a 64-character hex string (32 bytes). " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return Buffer.from(hex, "hex");
}

/** Encrypt a UTF-8 string. Returns { iv, ciphertext, authTag } as hex strings. */
function encrypt(plaintext) {
  const key    = getEncryptionKey();
  const iv     = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag     = cipher.getAuthTag();
  return {
    iv:         iv.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
    authTag:    authTag.toString("hex"),
  };
}

/** Reverse of encrypt(). Throws if the auth tag doesn't match (tampered/wrong key). */
function decrypt({ iv, ciphertext, authTag }) {
  const key      = getEncryptionKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(authTag, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** SHA-256 hash of an API key, used as the Redis lookup key (never store the raw key). */
function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(apiKey, "utf8").digest("hex");
}

/** Generate a strong random API key (40 hex chars) — offered as a UI convenience. */
function generateApiKey() {
  return crypto.randomBytes(20).toString("hex");
}

/** Generate a short random profile ID for internal Redis keys. */
function newProfileId() {
  return crypto.randomBytes(8).toString("hex");
}

module.exports = { encrypt, decrypt, hashApiKey, generateApiKey, newProfileId, getEncryptionKey };
