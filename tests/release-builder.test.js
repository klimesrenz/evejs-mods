"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repositoryRoot = path.resolve(__dirname, "..");
const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");

for (const candidate of [
  { id: "pi-processing", archive: "PIProcessing-0.1.7.zip", root: "PIProcessing-0.1.7/" },
  { id: "skyhook-pi", archive: "SkyhookPI-0.1.17.zip", root: "SkyhookPI-0.1.17/" },
]) {
  test(`canonical release builder uses the verified ${candidate.id} package`, t => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "evejs-release-builder-"));
    t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
    fs.mkdirSync(path.join(fixture, "tools"), { recursive: true });
    fs.mkdirSync(path.join(fixture, "mods"), { recursive: true });
    fs.copyFileSync(path.join(repositoryRoot, "tools/build_release.py"), path.join(fixture, "tools/build_release.py"));
    fs.cpSync(path.join(repositoryRoot, "mods", candidate.id), path.join(fixture, "mods", candidate.id), { recursive: true });

    const built = spawnSync(python, ["tools/build_release.py", "--mod", candidate.id], {
      cwd: fixture,
      encoding: "utf8",
    });
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
    const archive = path.join(fixture, "dist", candidate.archive);
    const verified = spawnSync(process.execPath, [path.join(fixture, "mods", candidate.id, "scripts/package.js"), "verify", archive], {
      cwd: fixture,
      encoding: "utf8",
    });
    assert.equal(verified.status, 0, `${verified.stdout}\n${verified.stderr}`);
    const result = JSON.parse(verified.stdout.trim());
    assert.equal(result.root, candidate.root);
    assert.equal(result.manifest.id, candidate.id);
    assert.ok(fs.existsSync(archive.replace(/\.zip$/u, ".update.json")));
  });
}
