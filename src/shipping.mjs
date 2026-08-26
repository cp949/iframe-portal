import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";

function runBuild(buildScript, projectDirectory, iframePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(buildScript, [], {
      cwd: projectDirectory,
      env: { ...process.env, IFRAME_PATH: iframePath },
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
      await access(buildScript, constants.X_OK);
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
      "비대화형 실행에는 프로젝트명 또는 --all이 필요합니다.",
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
