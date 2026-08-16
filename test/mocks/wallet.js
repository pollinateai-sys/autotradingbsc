// ============================================================
//  MOCK WALLET — fake BNB balance for testing
// ============================================================
let fakeBnbBalance = 10.0; // start with 10 fake BNB
const fakeTokenBalances = {}; // contract -> balance

function getProvider() { return { fake: true }; }
function getWallet()   { return { address: "0xTestWalletAddress0000000000000000000001" }; }
function getAddress()  { return getWallet().address; }
async function getBnbBalance() { return fakeBnbBalance; }
async function getTokenBalance(contract) { return fakeTokenBalances[contract] || 0; }

// test helpers
function _setBnbBalance(v) { fakeBnbBalance = v; }
function _setTokenBalance(contract, v) { fakeTokenBalances[contract] = v; }
function _adjustBnbBalance(delta) { fakeBnbBalance += delta; }

module.exports = {
  getProvider, getWallet, getAddress, getBnbBalance, getTokenBalance,
  _setBnbBalance, _setTokenBalance, _adjustBnbBalance,
};
