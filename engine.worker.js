/* =========================================================
   五子棋 WASM 引擎 Worker
   WASM 的加载、编译、初始化与算杀全部在本线程执行，
   主线程永不阻塞（彻底规避低配设备主线程 ANR 闪退）。
   ========================================================= */

var WASM_IMPORTS = { env: { abort: function () {} } };
var wasm = null;          // 引擎 exports
var moveId = 0;

function syncBoard(n, flat) {
  wasm.init(n);
  for (var r = 0; r < n; r++) {
    for (var c = 0; c < n; c++) {
      var v = flat[r * n + c];
      if (v !== 0) wasm.setCell(r, c, v);
    }
  }
}

function loadEngine() {
  return fetch("engine.wasm", { cache: "force-cache" })
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.arrayBuffer();
    })
    .then(function (buf) {
      return WebAssembly.instantiate(buf, WASM_IMPORTS);
    })
    .then(function (mod) {
      wasm = mod.instance.exports;
      wasm.init(15);
      return true;
    });
}

self.onmessage = function (e) {
  var d = e.data;
  if (!d) return;
  if (d.type === "load") {
    loadEngine().then(function () {
      self.postMessage({ id: d.id, type: "load", ok: true });
    }).catch(function (err) {
      self.postMessage({ id: d.id, type: "load", ok: false, err: String(err) });
    });
    return;
  }
  if (d.type === "move") {
    var result = { id: d.id, type: "move", r: -1, c: -1 };
    try {
      if (!wasm) throw new Error("engine not ready");
      syncBoard(d.n, d.board);
      wasm.think(d.me, d.budget);
      result.r = wasm.moveR();
      result.c = wasm.moveC();
    } catch (err) {
      result.err = String(err);
    }
    self.postMessage(result);
  }
};
