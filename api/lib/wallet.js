// ============================================================
//  WALLET — read-only helpers for Vercel serverless context
//  Private key comes from env var PRIVATE_KEY (set in Vercel)
// ============================================================

const { ethers } = require("ethers");

let provider;
let wallet;

function getProvider() {
  if (!provider) {
    const rpc = process.env.BSC_RPC_URL || "https://bsc-dataseed1.binance.org/";
    provider  = new ethers.JsonRpcProvider(rpc);
  }
  return provider;
}

function getWallet() {
  if (!wallet) {
    const key = process.env.PRIVATE_KEY || "";
    if (!key) throw new Error("PRIVATE_KEY env var not set.");
    const pk = key.startsWith("0x") ? key : "0x" + key;
    wallet   = new ethers.Wallet(pk, getProvider());
  }
  return wallet;
}

async function getBnbBalance() {
  const w   = getWallet();
  const bal = await getProvider().getBalance(w.address);
  return parseFloat(ethers.formatEther(bal));
}

async function getTokenBalance(contractAddress) {
  const abi = [
    "function balanceOf(address) view returns (uint256)",
    "function decimals() view returns (uint8)",
  ];
  const p   = getProvider();
  const tkn = new ethers.Contract(contractAddress, abi, p);
  const [bal, dec] = await Promise.all([tkn.balanceOf(getWallet().address), tkn.decimals()]);
  return parseFloat(ethers.formatUnits(bal, dec));
}

function getAddress() {
  return getWallet().address;
}

module.exports = { getProvider, getWallet, getAddress, getBnbBalance, getTokenBalance };
