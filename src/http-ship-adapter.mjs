import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PROJECT_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const DISPLAYABLE_NETWORK_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ENOTFOUND",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "ETIMEDOUT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

function assertProjectName(projectName) {
  if (!PROJECT_NAME_PATTERN.test(projectName)) {
    throw new Error(`잘못된 프로젝트 이름입니다: ${projectName}`);
  }
}

function getDestinationPath(projectName) {
  assertProjectName(projectName);
  const destinationPath = projectName.startsWith("iframe-")
    ? projectName.slice("iframe-".length)
    : projectName;

  if (destinationPath.length === 0) {
    throw new Error("iframe 경로명이 비어 있을 수 없습니다.");
  }

  return destinationPath;
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

function formatNetworkError(error) {
  let current = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const code = typeof current.code === "string" ? current.code : null;
    if (code && DISPLAYABLE_NETWORK_ERROR_CODES.has(code)) {
      const message =
        typeof current.message === "string" && current.message !== "fetch failed"
          ? ` ${current.message}`
          : "";
      return `[${code}]${message}`;
    }
    current = current.cause;
  }
  return null;
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
  if (config.bodyType !== undefined && !["form-data", "raw"].includes(config.bodyType)) {
    throw new Error("ship 설정의 bodyType은 form-data 또는 raw여야 합니다.");
  }
  if (config.destinationPathField !== undefined) {
    assertNonEmptyString(config, "destinationPathField");
  }
  if (config.bodyType !== "raw") assertNonEmptyString(config, "fileField");
  assertStringRecord(config, "fields");

  return config;
}

async function createEncryptedArchive(archivePath, encryptionKey) {
  const archiveName = path.basename(archivePath);
  const archiveContent = await readFile(archivePath);
  const zipWriter = new ZipWriter(new BlobWriter("application/zip"));

  await zipWriter.add(
    archiveName,
    new BlobReader(new Blob([archiveContent])),
    { password: encryptionKey },
  );
  return await zipWriter.close();
}

export function createHttpShipAdapter(
  config,
  { fetchImpl = globalThis.fetch } = {},
) {
  return {
    getIframePath(projectName) {
      const destinationPath = getDestinationPath(projectName);
      return `${config.iframePrefix.replace(/\/+$/, "")}/${destinationPath}`;
    },
    async shipIframe(archivePath) {
      const archiveName = path.basename(archivePath);

      const extension = [".zip", ".tar.gz"].find((suffix) => archiveName.endsWith(suffix));
      if (!extension) {
        throw new Error(`zip 또는 tar.gz archive가 아닙니다: ${archiveName}`);
      }

      const projectName = archiveName.slice(0, -extension.length);
      const destinationPath = getDestinationPath(projectName);

      const archive = config.encryptionKey
        ? await createEncryptedArchive(archivePath, config.encryptionKey)
        : new Blob([await readFile(archivePath)], {
            type: extension === ".zip" ? "application/zip" : "application/gzip",
          });
      const destinationPathField = config.destinationPathField ?? "destinationPath";
      let endpoint = config.endpoint.replace(/\/+$/, "");
      let body = archive;
      let headers = config.headers;
      if (config.bodyType === "raw") {
        const url = new URL(endpoint);
        for (const [fieldName, fieldValue] of Object.entries(config.fields)) {
          url.searchParams.set(fieldName, fieldValue);
        }
        url.searchParams.set(destinationPathField, destinationPath);
        endpoint = url.toString();
        headers = new Headers(config.headers);
        if (!headers.has("Content-Type")) headers.set("Content-Type", archive.type);
      } else {
        const formData = new FormData();
        const uploadArchiveName = config.encryptionKey ? `${projectName}.zip` : archiveName;
        formData.append(config.fileField, archive, uploadArchiveName);
        for (const [fieldName, fieldValue] of Object.entries(config.fields)) {
          formData.append(fieldName, fieldValue);
        }
        formData.append(destinationPathField, destinationPath);
        body = formData;
      }

      let response;
      try {
        response = await fetchImpl(
          endpoint,
          {
            method: "POST",
            headers,
            body,
          },
        );
      } catch (error) {
        const detail = formatNetworkError(error);
        throw new Error(
          detail
            ? `배포 서버에 연결할 수 없습니다: ${detail}`
            : "배포 서버에 연결할 수 없습니다.",
          { cause: error },
        );
      }

      if (!response.ok) {
        throw new Error(`배포 요청이 실패했습니다: HTTP ${response.status}`);
      }
      if (config.bodyType === "raw") return;

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
