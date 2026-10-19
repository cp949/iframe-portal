#!/usr/bin/env node

import { select } from "@inquirer/prompts";
import { Command } from "commander";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  createHttpShipAdapter,
  loadShipConfig,
} from "./src/http-ship-adapter.mjs";
import {
  discoverProjects,
  selectProjectNames,
  shipProjects,
} from "./src/shipping.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const configHome =
  process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config");
const secretsConfigPath = path.join(scriptDirectory, ".secrets", "ship.json");
const defaultConfigPath = path.join(configHome, "iframe-portal", "ship.json");

/** 환경변수 > 저장소 .secrets/ship.json > 사용자 설정 디렉터리 순으로 고른다. */
async function resolveConfigPath() {
  if (process.env.IFRAME_PORTAL_SHIP_CONFIG_PATH !== undefined) {
    return process.env.IFRAME_PORTAL_SHIP_CONFIG_PATH;
  }
  try {
    await access(secretsConfigPath);
    return secretsConfigPath;
  } catch {
    return defaultConfigPath;
  }
}

const program = new Command()
  .name("ship")
  .description("iframe 프로젝트를 빌드하고 배포합니다.")
  .argument("[projects...]", "배포할 프로젝트 이름")
  .option("--all", "탐색된 모든 프로젝트 배포")
  .showHelpAfterError();

program.parse();

async function main() {
  const configPath = await resolveConfigPath();
  try {
    await access(configPath);
  } catch {
    throw new Error(
      `로컬 ship 설정을 찾을 수 없습니다: ${configPath}\nship-config.example.json을 참고하세요.`,
    );
  }

  const config = await loadShipConfig(configPath);
  console.log(`업로드 endpoint: ${config.endpoint}`);
  const adapter = createHttpShipAdapter(config);
  const iframesDirectory = path.join(scriptDirectory, "iframes");
  const availableProjects = await discoverProjects(iframesDirectory);
  const requestedProjects = program.args;
  const { all: shipAll } = program.opts();

  if (availableProjects.length === 0) {
    throw new Error(
      "배포 가능한 프로젝트가 없습니다. iframes/<project>/iframe-build-html.sh를 확인하세요.",
    );
  }

  const interactive =
    process.stdin.isTTY === true && process.stdout.isTTY === true;
  // mintty의 pty는 Node에서 TTY로 보이지 않아 대화형 메뉴를 열 수 없다.
  const isMintty =
    process.platform === "win32" && typeof process.env.MSYSTEM === "string";

  const projectNames = await selectProjectNames({
    availableProjects,
    requestedProjects,
    shipAll,
    interactive,
    nonInteractiveHint:
      !interactive && isMintty
        ? "Git Bash(mintty)에서는 대화형 메뉴를 열 수 없습니다. `winpty pnpm ship`으로 실행하거나 프로젝트명을 지정하세요."
        : "",
    promptProject: (projects) =>
      select({
        message: "배포할 iframe 프로젝트를 선택하세요.",
        choices: [
          ...projects.map((projectName) => ({
            name: projectName,
            value: projectName,
          })),
          { name: "취소", value: null },
        ],
      }),
  });

  if (projectNames.length === 0) {
    console.log("배포를 취소했습니다.");
    return;
  }

  console.log(`배포 시작: ${projectNames.join(", ")}`);
  await shipProjects({ iframesDirectory, projectNames, adapter });
  console.log(`배포 완료: ${projectNames.join(", ")}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
