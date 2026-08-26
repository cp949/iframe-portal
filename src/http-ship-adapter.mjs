import { readFile } from "node:fs/promises";
import path from "node:path";

const PROJECT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

function assertProjectName(projectName) {
  if (!PROJECT_NAME_PATTERN.test(projectName)) {
    throw new Error(`잘못된 프로젝트 이름입니다: ${projectName}`);
  }
}

function assertNonEmptyString(config, key) {
  if (typeof config[key] !== "string" || config[key].length === 0) {
    throw new Error(
      `ship 설정의 ${key}는 비어 있지 않은 문자열이어야 합니다.`,
    );
  }
}

function assertStringRecord(config, key) {
  const value = config[key];
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.values(value).some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`ship 설정의 ${key}는 문자열 값 object여야 합니다.`);
  }
}

export async function loadShipConfig(configPath) {
  let config;
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(`ship 설정 JSON이 올바르지 않습니다: ${configPath}`, {
      cause: error,
    });
  }

  assertNonEmptyString(config, "iframePrefix");
  assertNonEmptyString(config, "endpoint");
  assertStringRecord(config, "headers");
  assertNonEmptyString(config, "fileField");
  assertStringRecord(config, "fields");

  return config;
}

export function createHttpShipAdapter(
  config,
  { fetchImpl = globalThis.fetch } = {},
) {
  return {
    getIframePath(projectName) {
      assertProjectName(projectName);
      return `${config.iframePrefix.replace(/\/+$/, "")}/${projectName}`;
    },
    async shipIframe(archivePath) {
      const archiveName = path.basename(archivePath);

      if (!archiveName.endsWith(".tar.gz")) {
        throw new Error(`tar.gz archive가 아닙니다: ${archiveName}`);
      }

      const projectName = archiveName.slice(0, -".tar.gz".length);
      assertProjectName(projectName);

      const formData = new FormData();
      const archive = new Blob([await readFile(archivePath)], {
        type: "application/gzip",
      });
      formData.append(config.fileField, archive, archiveName);

      for (const [fieldName, fieldValue] of Object.entries(config.fields)) {
        formData.append(fieldName, fieldValue);
      }

      let response;
      try {
        response = await fetchImpl(
          `${config.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(projectName)}`,
          {
            method: "POST",
            headers: config.headers,
            body: formData,
          },
        );
      } catch {
        throw new Error("배포 서버에 연결할 수 없습니다.");
      }

      if (!response.ok) {
        throw new Error(`배포 요청이 실패했습니다: HTTP ${response.status}`);
      }

      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error("배포 서버가 올바른 JSON 응답을 반환하지 않았습니다.");
      }
      if (result.success !== true) {
        const errorCode =
          typeof result.errorCode === "string" ? result.errorCode : "UNKNOWN";
        throw new Error(`배포 서버가 요청을 거부했습니다: ${errorCode}`);
      }
    },
  };
}
