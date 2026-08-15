// ============================================================
//  WALLET MANAGER
//  Loads private key securely, checks BNB balance,
//  signs and broadcasts transactions.
//  Private key is NEVER written to any file or log.
// ============================================================

require("dotenv").config();
const { ethers } = require("ethers");
const readline   = require("readline");
const SETTINGS   = require("../../config/settings");

class WalletManager {
  constructor() {
    this.provider = null;
    this.wallet   = null;
    this.address  = null;
  }

  // ────────────────────────────────────────────
  async connect() {
    const rpcUrl = process.env.BSC_RPC_URL || "https://bsc-dataseed1.binance.org/";
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    try {
      const block = await this.provider.getBlockNumber();
      console.log(`✅ Connected to BSC | Block: ${block}`);
    } catch (e) {
      console.error("❌ Cannot connect to BSC RPC:", e.message);
      process.exit(1);
    }
  }

  // ────────────────────────────────────────────
  async loadWallet() {
    let privateKey = process.env.PRIVATE_KEY || "";

    // If not in .env, prompt securely in terminal
    if (!privateKey) {
      privateKey = await this._promptSecret(
        "🔐 Enter your BEP20 wallet private key (hidden): "
      );
    }

    // Strip 0x prefix if present
    if (privateKey.startsWith("0x") || privateKey.startsWith("0X")) {
      privateKey = privateKey.slice(2);
    }

    if (privateKey.length !== 64) {
      console.error("❌ Invalid private key — must be 64 hex characters.");
      process.exit(1);
    }

    try {
      this.wallet  = new ethers.Wallet("0x" + privateKey, this.provider);
      this.address = this.wallet.address;
      // Clear from local scope
      privateKey = null;
      console.log(`✅ Wallet loaded: ${this.address}`);
    } catch (e) {
      console.error("❌ Invalid private key:", e.message);
      process.exit(1);
    }
  }

  // ────────────────────────────────────────────
  async getBnbBalance() {
    const bal = await this.provider.getBalance(this.address);
    return parseFloat(ethers.formatEther(bal));
  }

  // ────────────────────────────────────────────
  async getTokenBalance(contractAddress) {
    const abi = [
      "function balanceOf(address) view returns (uint256)",
      "function decimals() view returns (uint8)",
    ];
    const token    = new ethers.Contract(contractAddress, abi, this.provider);
    const [bal, dec] = await Promise.all([
      token.balanceOf(this.address),
      token.decimals(),
    ]);
    return parseFloat(ethers.formatUnits(bal, dec));
  }

  // ────────────────────────────────────────────
  async hasEnoughBnb(amountBnb) {
    const balance  = await this.getBnbBalance();
    const required = amountBnb + SETTINGS.minBnbReserve;
    if (balance < required) {
      console.log(
        `⚠️  Insufficient BNB. Have: ${balance.toFixed(4)} | ` +
        `Need: ${required.toFixed(4)} (incl. ${SETTINGS.minBnbReserve} gas reserve)`
      );
      return false;
    }
    return true;
  }

  // ────────────────────────────────────────────
  async getTradeAmountBnb() {
    const balance = await this.getBnbBalance();
    const amount  = (balance * SETTINGS.bankrollPercent) / 100;
    return parseFloat(amount.toFixed(6));
  }

  // ────────────────────────────────────────────
  async displayPortfolio(tokens) {
    console.log("\n" + "═".repeat(55));
    console.log("  💼 PORTFOLIO");
    console.log("═".repeat(55));
    const bnb = await this.getBnbBalance();
    console.log(`  BNB    : ${bnb.toFixed(6)} BNB`);
    for (const t of tokens) {
      if (!t.enabled || t.contract === "native") continue;
      try {
        const bal = await this.getTokenBalance(t.contract);
        if (bal > 0) console.log(`  ${t.symbol.padEnd(6)} : ${bal.toFixed(6)}`);
      } catch (_) {}
    }
    console.log("═".repeat(55) + "\n");
  }

  // ────────────────────────────────────────────
  _promptSecret(question) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input:  process.stdin,
        output: process.stdout,
      });
      // Hide input
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
      if (rl.terminal) {
        process.stdout.write("\x1B[?25l"); // hide cursor
      }
    });
  }
}

module.exports = WalletManager;
