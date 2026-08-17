// ============================================================
//  MOCK WALLET — profile-aware. Delegates wallet-record storage
//  (address, connectedAt) to the mock redis store, exactly like
//  the real wallet.js delegates to the real redis.js — so
//  routes/scanner code calling redis.hasWallet() sees the same
//  truth as code calling wallet.getSignerWallet().
// ============================================================
const { ethers } = require("ethers");
const redisMock = require("./redis");

const bnbBalances   = {}; // profileId -> number
const tokenBalances = {}; // profileId -> { contract: amount }

function getProvider() { return { fake: true }; }

async function connectWallet(profileId, privateKeyRaw) {
  let pk = String(privateKeyRaw || "").trim();
  if (pk.startsWith("0x") || pk.startsWith("0X")) pk = pk.slice(2);
  if (!/^[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error("Invalid private key — must be 64 hex characters (with or without 0x prefix).");
  }
  const w = new ethers.Wallet("0x" + pk);
  await redisMock.setWalletRecord(profileId, { address: w.address, connectedAt: new Date().toISOString() });
  if (bnbBalances[profileId] === undefined) bnbBalances[profileId] = 10.0; // fake starting balance
  return { address: w.address };
}

async function disconnectWallet(profileId) { await redisMock.deleteWalletRecord(profileId); }

async function getWalletInfo(profileId) { return redisMock.getWalletRecord(profileId); }

async function getAddress(profileId) {
  const rec = await redisMock.getWalletRecord(profileId);
  if (!rec) throw new Error("No wallet connected for this profile.");
  return rec.address;
}

async function getSignerWallet(profileId) {
  const rec = await redisMock.getWalletRecord(profileId);
  if (!rec) throw new Error("No wallet connected for this profile — enter your private key first.");
  // Fake signer: carries _profileId so the mock pancakeswap module knows
  // whose in-memory balance to adjust.
  return { address: rec.address, provider: getProvider(), _profileId: profileId };
}

async function getBnbBalance(profileId) {
  await getAddress(profileId); // throws if not connected, matching real behavior
  return bnbBalances[profileId] ?? 0;
}

async function getTokenBalance(profileId, contract) {
  return (tokenBalances[profileId] && tokenBalances[profileId][contract]) || 0;
}

// ── test helpers ──────────────────────────────────────────────
function _setBnbBalance(profileId, v) { bnbBalances[profileId] = v; }
function _setTokenBalance(profileId, contract, v) {
  tokenBalances[profileId] = tokenBalances[profileId] || {};
  tokenBalances[profileId][contract] = v;
}
function _adjustBnbBalance(profileId, delta) { bnbBalances[profileId] = (bnbBalances[profileId] || 0) + delta; }

module.exports = {
  getProvider, connectWallet, disconnectWallet, getWalletInfo,
  getAddress, getSignerWallet, getBnbBalance, getTokenBalance,
  _setBnbBalance, _setTokenBalance, _adjustBnbBalance,
};
