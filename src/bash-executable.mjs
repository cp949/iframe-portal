import { statSync } from "node:fs";
import path from "node:path";

const BASH_EXECUTABLE_NAME = "bash.exe";

/** 실제 파일 여부만 확인한다. 접근 불가 경로는 후보에서 제외한다. */
function isExistingFile(candidatePath) {
  try {
    return statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Windows 시스템 디렉터리의 bash.exe는 WSL launcher이므로 제외한다.
 * WSL launcher는 Windows 경로 인자를 그대로 해석하지 못해 빌드가 실패한다.
 */
function isWindowsSystemDirectory(directory, env) {
  const systemRoot = env.SystemRoot || env.windir;
  if (!systemRoot) return false;

  const normalizedDirectory = path.win32.resolve(directory).toLowerCase();
  const normalizedSystemRoot = path.win32.resolve(systemRoot).toLowerCase();

  return (
    normalizedDirectory === normalizedSystemRoot ||
    normalizedDirectory.startsWith(`${normalizedSystemRoot}${path.win32.sep}`)
  );
}

/** Git Bash 설치 형태별로 bash.exe가 놓이는 위치를 모두 훑는다. */
function* collectBashCandidates(env) {
  // Git Bash가 설정하는 EXEPATH는 셸 종류에 따라 루트 또는 bin을 가리킨다.
  if (env.EXEPATH) {
    yield path.win32.join(env.EXEPATH, BASH_EXECUTABLE_NAME);
    yield path.win32.join(env.EXEPATH, "bin", BASH_EXECUTABLE_NAME);
    yield path.win32.join(env.EXEPATH, "usr", "bin", BASH_EXECUTABLE_NAME);
  }

  const installRoots = [
    env.ProgramW6432,
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, "Programs"),
  ];

  for (const installRoot of installRoots) {
    if (!installRoot) continue;
    yield path.win32.join(installRoot, "Git", "bin", BASH_EXECUTABLE_NAME);
    yield path.win32.join(
      installRoot,
      "Git",
      "usr",
      "bin",
      BASH_EXECUTABLE_NAME,
    );
  }

  for (const pathEntry of (env.Path || env.PATH || "").split(path.win32.delimiter)) {
    const directory = pathEntry.trim().replace(/^"|"$/g, "");
    if (directory.length === 0) continue;
    if (isWindowsSystemDirectory(directory, env)) continue;
    yield path.win32.join(directory, BASH_EXECUTABLE_NAME);
  }
}

/**
 * Windows에서 빌드 스크립트를 실행할 bash.exe 경로를 찾는다.
 * IFRAME_PORTAL_BASH로 직접 지정할 수 있고, 없으면 Git Bash 설치 위치를 탐색한다.
 */
export function resolveBashExecutable({
  env = process.env,
  fileExists = isExistingFile,
} = {}) {
  const override = (env.IFRAME_PORTAL_BASH || "").trim();

  if (override.length > 0) {
    if (!fileExists(override)) {
      throw new Error(
        `IFRAME_PORTAL_BASH가 가리키는 bash를 찾을 수 없습니다: ${override}`,
      );
    }
    return override;
  }

  for (const candidate of collectBashCandidates(env)) {
    if (fileExists(candidate)) return candidate;
  }

  throw new Error(
    "빌드 스크립트를 실행할 Git Bash를 찾을 수 없습니다. Git for Windows를 설치하거나 IFRAME_PORTAL_BASH에 bash.exe 경로를 지정하세요.",
  );
}
