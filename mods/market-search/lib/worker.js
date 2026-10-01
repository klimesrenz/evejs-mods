"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const { query } = require("./database");
try {
  parentPort.postMessage({ success: true, ...query(workerData.root, workerData.query) });
} catch (error) {
  parentPort.postMessage({ success: false, message: String(error.message).slice(0, 500) });
}
