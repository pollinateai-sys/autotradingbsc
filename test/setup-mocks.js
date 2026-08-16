// ============================================================
//  TEST MOCK INJECTOR
//  Swaps api/lib/{redis,wallet,pancakeswap,market}.js for
//  in-memory fakes via require.cache — WITHOUT ever touching
//  or overwriting the real files on disk.
//
//  This lets the test suite exercise the REAL business logic
//  (api/lib/strategy.js, api/lib/scanner.js, and every route)
//  with zero risk of hitting a real wallet, real BSC RPC, or
//  real Redis instance, even if run by accident.
// ============================================================
const path = require("path");

function injectMock(realRelativePath, mockRelativePath) {
  const realResolved = require.resolve(path.join(__dirname, realRelativePath));
  const mockExports   = require(path.join(__dirname, mockRelativePath));
  require.cache[realResolved] = {
    id: realResolved,
    filename: realResolved,
    loaded: true,
    exports: mockExports,
  };
}

injectMock("../api/lib/redis.js",       "./mocks/redis.js");
injectMock("../api/lib/wallet.js",      "./mocks/wallet.js");
injectMock("../api/lib/pancakeswap.js", "./mocks/pancakeswap.js");
injectMock("../api/lib/market.js",      "./mocks/market.js");

module.exports = {
  wallet: require("./mocks/wallet.js"),
  swap:   require("./mocks/pancakeswap.js"),
  market: require("./mocks/market.js"),
  redis:  require("./mocks/redis.js"),
};
