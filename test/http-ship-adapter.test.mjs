/**
 * JSON 설정 기반 HTTP ship adapter의 경로 계산과 업로드 판정을 검증한다.
 */

import assert from "node:assert/strict";
import { BlobReader, BlobWriter, ZipReader } from "@zip.js/zip.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createHttpShipAdapter,
  loadShipConfig,
} from "../src/http-ship-adapter.mjs";

/** 민감한 실제 값 없이 generic uploader 계약을 표현하는 설정을 만든다. */
function createConfig() {
  return {
    iframePrefix: "/private/iframe",
    endpoint: "https://private.invalid/upload",
    headers: { "x-private-auth": "secret" },
    encryptionKey: "archive-password",
    fileField: "archive",
    fields: { stripTop: "true" },
  };
}

test("JSON 설정으로 프로젝트의 전체 IFRAME_PATH를 계산한다", async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "ship-config-"));
  const configPath = path.join(tempDirectory, "ship.json");

  try {
    await writeFile(
      configPath,
      JSON.stringify(createConfig()),
    );

    const config = await loadShipConfig(configPath);
    const adapter = createHttpShipAdapter(config);

    assert.equal(
      adapter.getIframePath("iframe-image-editor"),
      "/private/iframe/image-editor",
    );

    assert.equal(
      adapter.getIframePath("image-editor"),
      "/private/iframe/image-editor",
    );

    assert.throws(
      () => adapter.getIframePath("iframe-"),
      /iframe 경로명이 비어 있을 수 없습니다/,
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("잘못된 필수 설정은 로드 단계에서 거부한다", async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "ship-config-"));
  const configPath = path.join(tempDirectory, "ship.json");

  try {
    const cases = [
      {
        config: { ...createConfig(), iframePrefix: "" },
        expected: /ship 설정의 iframePrefix는 비어 있지 않은 문자열이어야 합니다/,
      },
      {
        config: { ...createConfig(), endpoint: "" },
        expected: /ship 설정의 endpoint는 비어 있지 않은 문자열이어야 합니다/,
      },
      {
        config: { ...createConfig(), headers: [] },
        expected: /ship 설정의 headers는 문자열 값 object여야 합니다/,
      },
      {
        config: { ...createConfig(), fileField: "" },
        expected: /ship 설정의 fileField는 비어 있지 않은 문자열이어야 합니다/,
      },
      {
        config: { ...createConfig(), fields: { stripTop: true } },
        expected: /ship 설정의 fields는 문자열 값 object여야 합니다/,
      },
    ];

    for (const { config, expected } of cases) {
      await writeFile(configPath, JSON.stringify(config));
      await assert.rejects(loadShipConfig(configPath), expected);
    }
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("잘못된 JSON 설정은 설정 파일 경로와 함께 거부한다", async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "ship-config-"));
  const configPath = path.join(tempDirectory, "ship.json");

  try {
    await writeFile(configPath, "{ invalid json");

    await assert.rejects(
      loadShipConfig(configPath),
      (error) => {
        assert.equal(
          error.message,
          `ship 설정 JSON이 올바르지 않습니다: ${configPath}`,
        );
        assert.ok(error.cause instanceof SyntaxError);
        return true;
      },
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("tar.gz를 암호화 ZIP으로 포장해 설정된 multipart 요청을 보낸다", async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "ship-archive-"));
  const archivePath = path.join(
    tempDirectory,
    "iframe-image-editor.tar.gz",
  );

  try {
    await writeFile(archivePath, "archive-content");
    const adapter = createHttpShipAdapter(createConfig(), {
      fetchImpl: async (url, options) => {
        assert.equal(
          url,
          "https://private.invalid/upload",
        );
        assert.equal(options.method, "POST");
        assert.equal(options.headers["x-private-auth"], "secret");
        assert.equal(options.body.get("stripTop"), "true");
        assert.equal(options.body.get("destinationPath"), "image-editor");

        const archive = options.body.get("archive");
        assert.equal(archive.name, "iframe-image-editor.zip");

        const zipReader = new ZipReader(new BlobReader(archive));
        try {
          const entries = await zipReader.getEntries();
          assert.equal(entries.length, 1);
          assert.equal(entries[0].filename, "iframe-image-editor.tar.gz");

          const extracted = await entries[0].getData(new BlobWriter(), {
            password: "archive-password",
          });
          assert.equal(await extracted.text(), "archive-content");
        } finally {
          await zipReader.close();
        }

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
        });
      },
    });

    await adapter.shipIframe(archivePath);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

for (const encryptionKey of [undefined, null, ""]) {
  test(`encryptionKey가 ${encryptionKey === "" ? "빈 문자열" : String(encryptionKey)}이면 원본 archive를 보낸다`, async () => {
    const tempDirectory = await mkdtemp(path.join(tmpdir(), "ship-plain-archive-"));
    const archivePath = path.join(
      tempDirectory,
      "iframe-image-editor.tar.gz",
    );
    const expectedArchiveName = path.basename(archivePath);

    try {
      await writeFile(archivePath, "archive-content");
      const config = createConfig();
      if (encryptionKey === undefined) {
        delete config.encryptionKey;
      } else {
        config.encryptionKey = encryptionKey;
      }

      const adapter = createHttpShipAdapter(config, {
        fetchImpl: async (url, options) => {
          assert.equal(options.body.get("archive").name, expectedArchiveName);
          assert.equal(await options.body.get("archive").text(), "archive-content");
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        },
      });

      await adapter.shipIframe(archivePath);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });
}

test("tar.gz가 아닌 파일은 업로드 전에 거부한다", async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "ship-extension-"));
  const archivePath = path.join(tempDirectory, "iframe-editor.zip");

  try {
    await writeFile(archivePath, "archive");
    const adapter = createHttpShipAdapter(createConfig(), {
      fetchImpl: async () =>
        new Response(JSON.stringify({ success: true }), { status: 200 }),
    });

    await assert.rejects(
      adapter.shipIframe(archivePath),
      /tar\.gz archive가 아닙니다: iframe-editor\.zip/,
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("HTTP 오류 응답은 ship 실패로 처리한다", async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "ship-http-"));
  const archivePath = path.join(tempDirectory, "iframe-editor.tar.gz");

  try {
    await writeFile(archivePath, "archive");
    const adapter = createHttpShipAdapter(createConfig(), {
      fetchImpl: async () => new Response("unavailable", { status: 503 }),
    });

    await assert.rejects(
      adapter.shipIframe(archivePath),
      /배포 요청이 실패했습니다: HTTP 503/,
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("HTTP 200의 application 오류도 ship 실패로 처리한다", async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "ship-response-"));
  const archivePath = path.join(tempDirectory, "iframe-editor.tar.gz");

  try {
    await writeFile(archivePath, "archive");
    const adapter = createHttpShipAdapter(createConfig(), {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ success: false, errorCode: "E_PRIVATE" }),
          { status: 200 },
        ),
    });

    await assert.rejects(
      adapter.shipIframe(archivePath),
      /배포 서버가 요청을 거부했습니다: E_PRIVATE/,
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("JSON이 아닌 서버 응답은 명시적인 오류로 처리한다", async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "ship-json-"));
  const archivePath = path.join(tempDirectory, "iframe-editor.tar.gz");

  try {
    await writeFile(archivePath, "archive");
    const adapter = createHttpShipAdapter(createConfig(), {
      fetchImpl: async () => new Response("not-json", { status: 200 }),
    });

    await assert.rejects(
      adapter.shipIframe(archivePath),
      /배포 서버가 올바른 JSON 응답을 반환하지 않았습니다/,
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("네트워크 오류의 내부 정보는 노출하지 않는다", async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "ship-network-"));
  const archivePath = path.join(tempDirectory, "iframe-editor.tar.gz");

  try {
    await writeFile(archivePath, "archive");
    const adapter = createHttpShipAdapter(createConfig(), {
      fetchImpl: async () => {
        throw new Error("secret network details");
      },
    });

    await assert.rejects(
      adapter.shipIframe(archivePath),
      (error) => {
        assert.equal(error.message, "배포 서버에 연결할 수 없습니다.");
        return true;
      },
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("인증서 검증 오류의 원인을 표시한다", async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "ship-cert-error-"));
  const archivePath = path.join(tempDirectory, "iframe-editor.tar.gz");

  try {
    await writeFile(archivePath, "archive");
    const adapter = createHttpShipAdapter(createConfig(), {
      fetchImpl: async () => {
        const cause = new Error("self-signed certificate in certificate chain");
        cause.code = "SELF_SIGNED_CERT_IN_CHAIN";
        throw new TypeError("fetch failed", { cause });
      },
    });

    await assert.rejects(
      adapter.shipIframe(archivePath),
      /배포 서버에 연결할 수 없습니다: \[SELF_SIGNED_CERT_IN_CHAIN\] self-signed certificate in certificate chain/,
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});

test("연결 초기화 오류의 원인을 표시한다", async () => {
  const tempDirectory = await mkdtemp(path.join(tmpdir(), "ship-reset-error-"));
  const archivePath = path.join(tempDirectory, "iframe-editor.tar.gz");

  try {
    await writeFile(archivePath, "archive");
    const adapter = createHttpShipAdapter(createConfig(), {
      fetchImpl: async () => {
        const cause = new Error("socket hang up");
        cause.code = "ECONNRESET";
        throw new TypeError("fetch failed", { cause });
      },
    });

    await assert.rejects(
      adapter.shipIframe(archivePath),
      /배포 서버에 연결할 수 없습니다: \[ECONNRESET\] socket hang up/,
    );
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
