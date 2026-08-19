// ============================================================
//  CRYPTO HELPERS
//  1. AES-256-GCM encryption for stored wallet private keys.
//  2. bcrypt password hashing for username/password login.
//  3. SHA-256 hashing for session tokens (fast lookup — tokens
//     are high-entropy random values, not human passwords, so a
//     slow hash isn't needed the way it is for #2).
//
//  ENCRYPTION_KEY (env var) is the ONE secret that lets the
//  server decrypt any profile's wallet key — this is what makes
//  24/7 unattended trading possible (no per-user passphrase is
//  needed at trade time). Keep it as secret as the private keys
//  themselves; anyone with this + Redis access can decrypt every
//  connected wallet.
// ============================================================

const crypto  = require("crypto");
const bcrypt  = require("bcryptjs");
const ALGO    = "aes-256-gcm";
const BCRYPT_ROUNDS = 10;

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

/** Encrypt a UTF-8 string (used for wallet private keys). Returns { iv, ciphertext, authTag } as hex. */
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

// ── Passwords (bcrypt — slow on purpose, resists brute force) ──
async function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// ── Session tokens (SHA-256 — fast lookup, tokens are already
//    high-entropy random values so a slow hash adds no security,
//    only latency on every single authenticated request) ──
function hashToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}
function generateSessionToken() {
  return crypto.randomBytes(24).toString("hex"); // 48 hex chars
}

/** Generate a short random profile ID for internal Redis keys. */
function newProfileId() {
  return crypto.randomBytes(8).toString("hex");
}

module.exports = {
  encrypt, decrypt, getEncryptionKey,
  hashPassword, verifyPassword,
  hashToken, generateSessionToken,
  newProfileId,
};
