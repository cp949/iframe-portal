/**
 * iframe 배포 CLI의 인자 interface와 사용자 출력을 검증한다.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDirectory = path.dirname(
  path.dirname(fileURLToPath(import.meta.url)),
);
const cliPath = path.join(rootDirectory, "ship.mjs");

/** 실제 Node 프로세스에서 공개 CLI를 실행한다. */
function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: rootDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      IFRAME_PORTAL_SHIP_CONFIG_PATH: path.join(
        rootDirectory,
        ".missing-config-for-test.json",
      ),
    },
  });
}

/** 사용자가 입력하는 pnpm script 진입점을 실행한다. */
function runPackageCli(args) {
  return spawnSync("pnpm", ["ship", ...args], {
    cwd: rootDirectory,
    encoding: "utf8",
    env: {
      ...process.env,
      IFRAME_PORTAL_SHIP_CONFIG_PATH: path.join(
        rootDirectory,
        ".missing-config-for-test.json",
      ),
    },
  });
}

test("--help는 프로젝트 지정과 전체 배포 사용법을 안내한다", () => {
  const result = runCli(["--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ship \[options\] \[projects\.\.\.\]/);
  assert.match(result.stdout, /--all/);
});

test("pnpm ship 진입점이 공개 CLI를 실행한다", () => {
  const result = runPackageCli(["--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ship \[options\] \[projects\.\.\.\]/);
});

test("로컬 설정이 없으면 빌드 전에 실패한다", () => {
  const result = runCli(["iframe-image-editor"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /로컬 ship 설정을 찾을 수 없습니다/);
});
