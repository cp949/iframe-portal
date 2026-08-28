import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { resolveBashExecutable } from "./bash-executable.mjs";

/**
 * Windows는 shebang을 해석하지 못해 .sh를 직접 실행할 수 없으므로 bash로 실행한다.
 * bash에는 backslash 대신 slash 경로를 넘겨야 escape로 오해되지 않는다.
 */
function resolveBuildCommand(buildScript) {
  if (process.platform !== "win32") {
    return { command: buildScript, args: [] };
  }

  return {
    command: resolveBashExecutable(),
    args: [buildScript.split(path.win32.sep).join("/")],
  };
}

/** MSYS 변환 제외 목록은 세미콜론으로 구분한다. */
function appendConversionExclusion(currentValue, entry) {
  const entries = (currentValue || "")
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (entries.includes(entry)) return entries.join(";");

  return [...entries, entry].join(";");
}

/**
 * MSYS는 Windows 프로그램을 실행할 때 POSIX 경로처럼 보이는 값을 Windows 경로로 바꾼다.
 * 그대로 두면 배포 경로 /a/b가 C:/Program Files/Git/a/b로 바뀌어 잘못된 산출물이 만들어지므로
 * IFRAME_PATH와 그 값을 환경변수/인자 변환 제외 목록에 추가한다.
 */
export function createBuildEnvironment(iframePath, baseEnv = process.env) {
  const env = { ...baseEnv, IFRAME_PATH: iframePath };

  if (process.platform !== "win32") return env;

  env.MSYS2_ENV_CONV_EXCL = appendConversionExclusion(
    env.MSYS2_ENV_CONV_EXCL,
    "IFRAME_PATH",
  );
  env.MSYS2_ARG_CONV_EXCL = appendConversionExclusion(
    env.MSYS2_ARG_CONV_EXCL,
    iframePath,
  );

  return env;
}

function runBuild(buildScript, projectDirectory, iframePath) {
  const { command, args } = resolveBuildCommand(buildScript);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectDirectory,
      env: createBuildEnvironment(iframePath),
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }

      reject(new Error(`빌드가 실패했습니다. 종료 코드: ${exitCode}`));
    });
  });
}

export async function discoverProjects(iframesDirectory) {
  let entries;
  try {
    entries = await readdir(iframesDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const projects = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const buildScript = path.join(
      iframesDirectory,
      entry.name,
      "iframe-build-html.sh",
    );

    try {
      if (!(await stat(buildScript)).isFile()) continue;
      // Windows에는 실행 권한 bit가 없어 POSIX에서만 실행 가능 여부를 확인한다.
      if (process.platform !== "win32") {
        await access(buildScript, constants.X_OK);
      }
      projects.push(entry.name);
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "EACCES") throw error;
    }
  }

  return projects.sort((left, right) => left.localeCompare(right));
}

export async function selectProjectNames({
  availableProjects,
  requestedProjects,
  shipAll,
  interactive,
  promptProject,
  nonInteractiveHint = "",
}) {
  if (shipAll && requestedProjects.length > 0) {
    throw new Error("--all과 프로젝트 이름을 함께 사용할 수 없습니다.");
  }

  if (shipAll) return availableProjects;

  if (requestedProjects.length === 0 && interactive) {
    const selectedProject = await promptProject(availableProjects);
    return selectedProject === null ? [] : [selectedProject];
  }

  if (requestedProjects.length === 0) {
    throw new Error(
      `비대화형 실행에는 프로젝트명 또는 --all이 필요합니다.${
        nonInteractiveHint ? `\n${nonInteractiveHint}` : ""
      }`,
    );
  }

  for (const projectName of requestedProjects) {
    if (!availableProjects.includes(projectName)) {
      throw new Error(`배포 가능한 프로젝트가 아닙니다: ${projectName}`);
    }
  }

  return requestedProjects;
}

export async function shipProjects({
  iframesDirectory,
  projectNames,
  adapter,
}) {
  for (const projectName of projectNames) {
    const projectDirectory = path.join(iframesDirectory, projectName);
    const buildScript = path.join(projectDirectory, "iframe-build-html.sh");
    const archivePath = path.join(
      projectDirectory,
      `${projectName}.tar.gz`,
    );
    const iframePath = adapter.getIframePath(projectName);

    if (typeof iframePath !== "string" || iframePath.length === 0) {
      throw new Error(
        `로컬 adapter가 ${projectName}의 IFRAME_PATH를 반환하지 않았습니다.`,
      );
    }

    await runBuild(buildScript, projectDirectory, iframePath);

    try {
      if (!(await stat(archivePath)).isFile()) throw new Error();
    } catch {
      throw new Error(`빌드 archive를 찾을 수 없습니다: ${archivePath}`);
    }

    await adapter.shipIframe(archivePath);
  }
}
