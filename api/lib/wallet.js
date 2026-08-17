// ============================================================
//  WALLET — profile-aware
//  Each profile connects its own wallet by entering a private
//  key once via the dashboard. It's encrypted (AES-256-GCM,
//  see crypto.js) and stored in Redis so the server can keep
//  signing trades for that profile even while the person is
//  offline — decrypted on demand, never cached beyond the call
//  that needs it.
// ============================================================

const { ethers } = require("ethers");
const { encrypt, decrypt } = require("./crypto");
const {
  getWalletRecord, setWalletRecord, deleteWalletRecord, hasWallet,
} = require("./redis");

let provider;
function getProvider() {
  if (!provider) {
    const rpc = process.env.BSC_RPC_URL || "https://bsc-dataseed1.binance.org/";
    provider  = new ethers.JsonRpcProvider(rpc);
  }
  return provider;
}

/** Validate + encrypt + store a private key for this profile. Returns { address }. */
async function connectWallet(profileId, privateKeyRaw) {
  let pk = String(privateKeyRaw || "").trim();
  if (pk.startsWith("0x") || pk.startsWith("0X")) pk = pk.slice(2);
  if (!/^[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error("Invalid private key — must be 64 hex characters (with or without 0x prefix).");
  }

  const wallet = new ethers.Wallet("0x" + pk);
  const address = wallet.address;
  const enc     = encrypt(pk);
  pk = null; // drop reference asap

  await setWalletRecord(profileId, { address, enc, connectedAt: new Date().toISOString() });
  return { address };
}

async function disconnectWallet(profileId) {
  await deleteWalletRecord(profileId);
}

/** Public-safe info (no key material) — for the dashboard wallet chip. */
async function getWalletInfo(profileId) {
  const rec = await getWalletRecord(profileId);
  if (!rec) return null;
  return { address: rec.address, connectedAt: rec.connectedAt };
}

/** Decrypt and return a signer for this profile. Throws if no wallet connected. */
async function getSignerWallet(profileId) {
  const rec = await getWalletRecord(profileId);
  if (!rec) throw new Error("No wallet connected for this profile — enter your private key first.");
  const pk = decrypt(rec.enc);
  return new ethers.Wallet("0x" + pk, getProvider());
}

async function getAddress(profileId) {
  const rec = await getWalletRecord(profileId);
  if (!rec) throw new Error("No wallet connected for this profile.");
  return rec.address;
}

async function getBnbBalance(profileId) {
  const address = await getAddress(profileId);
  const bal = await getProvider().getBalance(address);
  return parseFloat(ethers.formatEther(bal));
}

async function getTokenBalance(profileId, contractAddress) {
  const address = await getAddress(profileId);
  const abi = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ];
  const token = new ethers.Contract(contractAddress, abi, getProvider());
  const [bal, dec] = await Promise.all([token.balanceOf(address), token.decimals()]);
  return parseFloat(ethers.formatUnits(bal, dec));
}

module.exports = {
  getProvider,
  connectWallet, disconnectWallet, getWalletInfo, hasWallet,
  getSignerWallet, getAddress, getBnbBalance, getTokenBalance,
};
