/**
 * Windows에서 빌드 스크립트를 실행할 bash를 고르는 규칙을 검증한다.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { resolveBashExecutable } from "../src/bash-executable.mjs";

/** 지정한 경로 목록만 존재하는 파일 시스템을 흉내낸다. */
function existsOnly(...existingPaths) {
  const normalized = new Set(
    existingPaths.map((filePath) => filePath.toLowerCase()),
  );
  return (filePath) => normalized.has(filePath.toLowerCase());
}

test("IFRAME_PORTAL_BASH로 지정한 bash를 우선 사용한다", () => {
  const chosen = resolveBashExecutable({
    env: {
      IFRAME_PORTAL_BASH: "D:\\tools\\bash.exe",
      ProgramFiles: "C:\\Program Files",
    },
    fileExists: existsOnly(
      "D:\\tools\\bash.exe",
      "C:\\Program Files\\Git\\bin\\bash.exe",
    ),
  });

  assert.equal(chosen, "D:\\tools\\bash.exe");
});

test("IFRAME_PORTAL_BASH 경로가 없으면 지정 경로와 함께 실패한다", () => {
  assert.throws(
    () =>
      resolveBashExecutable({
        env: { IFRAME_PORTAL_BASH: "D:\\tools\\bash.exe" },
        fileExists: existsOnly("C:\\Program Files\\Git\\bin\\bash.exe"),
      }),
    /IFRAME_PORTAL_BASH가 가리키는 bash를 찾을 수 없습니다: D:\\tools\\bash\.exe/,
  );
});

test("Git Bash가 설정한 EXEPATH의 bash를 찾는다", () => {
  const chosen = resolveBashExecutable({
    env: { EXEPATH: "C:\\Program Files\\Git\\bin" },
    fileExists: existsOnly("C:\\Program Files\\Git\\bin\\bash.exe"),
  });

  assert.equal(chosen, "C:\\Program Files\\Git\\bin\\bash.exe");
});

test("EXEPATH가 설치 루트여도 하위 bash를 찾는다", () => {
  const chosen = resolveBashExecutable({
    env: { EXEPATH: "C:\\msys64" },
    fileExists: existsOnly("C:\\msys64\\usr\\bin\\bash.exe"),
  });

  assert.equal(chosen, "C:\\msys64\\usr\\bin\\bash.exe");
});

test("EXEPATH가 없으면 Git for Windows 기본 설치 경로에서 찾는다", () => {
  const chosen = resolveBashExecutable({
    env: { ProgramFiles: "C:\\Program Files" },
    fileExists: existsOnly("C:\\Program Files\\Git\\bin\\bash.exe"),
  });

  assert.equal(chosen, "C:\\Program Files\\Git\\bin\\bash.exe");
});

test("PATH의 bash도 후보로 사용한다", () => {
  const chosen = resolveBashExecutable({
    env: {
      SystemRoot: "C:\\Windows",
      Path: "C:\\Windows\\System32;D:\\portable\\git\\bin",
    },
    fileExists: existsOnly("D:\\portable\\git\\bin\\bash.exe"),
  });

  assert.equal(chosen, "D:\\portable\\git\\bin\\bash.exe");
});

test("Windows 시스템 디렉터리의 WSL launcher는 선택하지 않는다", () => {
  assert.throws(
    () =>
      resolveBashExecutable({
        env: {
          SystemRoot: "C:\\Windows",
          Path: "C:\\Windows\\System32",
        },
        fileExists: existsOnly("C:\\Windows\\System32\\bash.exe"),
      }),
    /Git Bash를 찾을 수 없습니다/,
  );
});
