/**
 * iframe 프로젝트 탐색과 배포 orchestration의 공개 동작을 검증한다.
 */

import assert from "node:assert/strict";
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createBuildEnvironment,
  discoverProjects,
  selectProjectNames,
  shipProjects,
} from "../src/shipping.mjs";

/** bash가 backslash를 escape로 해석하지 않도록 slash 경로로 바꾼다. */
function toShellPath(filePath) {
  return filePath.split(path.sep).join("/");
}

/** 테스트마다 격리된 iframe 프로젝트 루트를 만든다. */
async function createFixture() {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), "iframe-portal-"));
  const iframesDirectory = path.join(rootDirectory, "iframes");
  await mkdir(iframesDirectory);

  return {
    iframesDirectory,
    async dispose() {
      await rm(rootDirectory, { recursive: true, force: true });
    },
  };
}

test("빌드 스크립트가 있는 프로젝트만 이름순으로 탐색한다", async () => {
  const fixture = await createFixture();

  try {
    for (const name of ["iframe-zeta", "iframe-alpha", "not-shippable"]) {
      await mkdir(path.join(fixture.iframesDirectory, name));
    }
    for (const name of ["iframe-zeta", "iframe-alpha"]) {
      const buildScript = path.join(
        fixture.iframesDirectory,
        name,
        "iframe-build-html.sh",
      );
      await writeFile(buildScript, "");
      await chmod(buildScript, 0o755);
    }

    const projects = await discoverProjects(fixture.iframesDirectory);

    assert.deepEqual(projects, ["iframe-alpha", "iframe-zeta"]);
  } finally {
    await fixture.dispose();
  }
});

test(
  "POSIX에서는 실행 권한이 없는 빌드 스크립트를 배포 대상에서 제외한다",
  // Windows는 실행 권한 bit가 없어 이 필터를 적용하지 않는다.
  { skip: process.platform === "win32" },
  async () => {
    const fixture = await createFixture();

    try {
      await mkdir(path.join(fixture.iframesDirectory, "not-shippable"));
      await writeFile(
        path.join(
          fixture.iframesDirectory,
          "not-shippable",
          "iframe-build-html.sh",
        ),
        "",
      );

      assert.deepEqual(await discoverProjects(fixture.iframesDirectory), []);
    } finally {
      await fixture.dispose();
    }
  },
);

test("iframes 디렉터리가 없으면 배포 가능한 프로젝트가 없는 것으로 처리한다", async () => {
  const fixture = await createFixture();
  const missingDirectory = path.join(
    path.dirname(fixture.iframesDirectory),
    "missing-iframes",
  );

  try {
    assert.deepEqual(await discoverProjects(missingDirectory), []);
  } finally {
    await fixture.dispose();
  }
});

test("명령행에서 지정한 프로젝트만 입력 순서대로 선택한다", async () => {
  const selected = await selectProjectNames({
    availableProjects: ["iframe-alpha", "iframe-beta"],
    requestedProjects: ["iframe-beta", "iframe-alpha"],
    shipAll: false,
    interactive: false,
  });

  assert.deepEqual(selected, ["iframe-beta", "iframe-alpha"]);
});

test("존재하지 않는 프로젝트명은 배포 전에 거부한다", async () => {
  await assert.rejects(
    selectProjectNames({
      availableProjects: ["iframe-alpha"],
      requestedProjects: ["../private"],
      shipAll: false,
      interactive: false,
    }),
    /배포 가능한 프로젝트가 아닙니다: \.\.\/private/,
  );
});

test("--all은 탐색된 모든 프로젝트를 선택한다", async () => {
  const selected = await selectProjectNames({
    availableProjects: ["iframe-alpha", "iframe-beta"],
    requestedProjects: [],
    shipAll: true,
    interactive: false,
  });

  assert.deepEqual(selected, ["iframe-alpha", "iframe-beta"]);
});

test("--all과 개별 프로젝트는 동시에 지정할 수 없다", async () => {
  await assert.rejects(
    selectProjectNames({
      availableProjects: ["iframe-alpha"],
      requestedProjects: ["iframe-alpha"],
      shipAll: true,
      interactive: false,
    }),
    /--all과 프로젝트 이름을 함께 사용할 수 없습니다/,
  );
});

test("인자 없는 대화형 실행은 메뉴에서 고른 프로젝트 하나를 선택한다", async () => {
  const selected = await selectProjectNames({
    availableProjects: ["iframe-alpha", "iframe-beta"],
    requestedProjects: [],
    shipAll: false,
    interactive: true,
    promptProject: async (projects) => {
      assert.deepEqual(projects, ["iframe-alpha", "iframe-beta"]);
      return "iframe-beta";
    },
  });

  assert.deepEqual(selected, ["iframe-beta"]);
});

test("비대화형 실행에는 프로젝트명 또는 --all이 필요하다", async () => {
  await assert.rejects(
    selectProjectNames({
      availableProjects: ["iframe-alpha"],
      requestedProjects: [],
      shipAll: false,
      interactive: false,
    }),
    /비대화형 실행에는 프로젝트명 또는 --all이 필요합니다/,
  );
});

test("대화형 메뉴에서 취소를 고르면 배포 대상을 반환하지 않는다", async () => {
  const selected = await selectProjectNames({
    availableProjects: ["iframe-alpha"],
    requestedProjects: [],
    shipAll: false,
    interactive: true,
    promptProject: async () => null,
  });

  assert.deepEqual(selected, []);
});

test(
  "Windows에서는 IFRAME_PATH를 MSYS 경로 변환 대상에서 제외한다",
  { skip: process.platform !== "win32" },
  () => {
    const env = createBuildEnvironment("/private/iframe/iframe-alpha", {
      MSYS2_ARG_CONV_EXCL: "/keep",
    });

    assert.equal(env.IFRAME_PATH, "/private/iframe/iframe-alpha");
    assert.equal(env.MSYS2_ENV_CONV_EXCL, "IFRAME_PATH");
    assert.equal(
      env.MSYS2_ARG_CONV_EXCL,
      "/keep;/private/iframe/iframe-alpha",
    );
  },
);

test(
  "POSIX에서는 MSYS 전용 환경변수를 추가하지 않는다",
  { skip: process.platform === "win32" },
  () => {
    const env = createBuildEnvironment("/private/iframe/iframe-alpha", {});

    assert.deepEqual(env, { IFRAME_PATH: "/private/iframe/iframe-alpha" });
  },
);

test("프로젝트별 IFRAME_PATH로 빌드한 archive를 adapter에 전달한다", async () => {
  const fixture = await createFixture();
  const projectName = "iframe-alpha";
  const projectDirectory = path.join(fixture.iframesDirectory, projectName);
  const buildScript = path.join(projectDirectory, "iframe-build-html.sh");
  const receivedPathFile = path.join(projectDirectory, "received-path.txt");
  const shippedArchiveFile = path.join(projectDirectory, "shipped-archive.txt");

  try {
    await mkdir(projectDirectory);
    await writeFile(
      buildScript,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        // Windows에서 MSYS 경로 변환이 일어나는 지점은 native 프로그램 실행이므로 node로 기록한다.
        `node -e "require('node:fs').writeFileSync(process.argv[1], process.env.IFRAME_PATH + '|' + process.argv[2])" ${JSON.stringify(toShellPath(receivedPathFile))} \"$IFRAME_PATH\"`,
        `printf 'archive' > ${JSON.stringify(toShellPath(path.join(projectDirectory, `${projectName}.tar.gz`)))}`,
      ].join("\n"),
    );
    await chmod(buildScript, 0o755);

    await shipProjects({
      iframesDirectory: fixture.iframesDirectory,
      projectNames: [projectName],
      adapter: {
        getIframePath(name) {
          return `/private/iframe/${name}`;
        },
        async shipIframe(archivePath) {
          await writeFile(shippedArchiveFile, archivePath);
        },
      },
    });

    assert.equal(
      await readFile(receivedPathFile, "utf8"),
      "/private/iframe/iframe-alpha|/private/iframe/iframe-alpha",
    );
    assert.equal(
      await readFile(shippedArchiveFile, "utf8"),
      path.join(projectDirectory, "iframe-alpha.tar.gz"),
    );
  } finally {
    await fixture.dispose();
  }
});

test("빌드 결과 archive가 없으면 adapter를 호출하지 않는다", async () => {
  const fixture = await createFixture();
  const projectName = "iframe-alpha";
  const projectDirectory = path.join(fixture.iframesDirectory, projectName);
  const buildScript = path.join(projectDirectory, "iframe-build-html.sh");
  const shippingMarker = path.join(projectDirectory, "shipped.txt");

  try {
    await mkdir(projectDirectory);
    await writeFile(buildScript, "#!/usr/bin/env bash\nexit 0\n");
    await chmod(buildScript, 0o755);

    await assert.rejects(
      shipProjects({
        iframesDirectory: fixture.iframesDirectory,
        projectNames: [projectName],
        adapter: {
          getIframePath() {
            return "/private/iframe/iframe-alpha";
          },
          async shipIframe() {
            await writeFile(shippingMarker, "shipped");
          },
        },
      }),
      /빌드 archive를 찾을 수 없습니다/,
    );
    await assert.rejects(access(shippingMarker), { code: "ENOENT" });
  } finally {
    await fixture.dispose();
  }
});

test("빌드 프로세스가 실패하면 adapter를 호출하지 않는다", async () => {
  const fixture = await createFixture();
  const projectName = "iframe-alpha";
  const projectDirectory = path.join(fixture.iframesDirectory, projectName);
  const buildScript = path.join(projectDirectory, "iframe-build-html.sh");
  const shippingMarker = path.join(projectDirectory, "shipped.txt");

  try {
    await mkdir(projectDirectory);
    await writeFile(buildScript, "#!/usr/bin/env bash\nexit 23\n");
    await chmod(buildScript, 0o755);

    await assert.rejects(
      shipProjects({
        iframesDirectory: fixture.iframesDirectory,
        projectNames: [projectName],
        adapter: {
          getIframePath() {
            return "/private/iframe/iframe-alpha";
          },
          async shipIframe() {
            await writeFile(shippingMarker, "shipped");
          },
        },
      }),
      /빌드가 실패했습니다\. 종료 코드: 23/,
    );
    await assert.rejects(access(shippingMarker), { code: "ENOENT" });
  } finally {
    await fixture.dispose();
  }
});

test("adapter가 빈 IFRAME_PATH를 반환하면 빌드를 시작하지 않는다", async () => {
  const fixture = await createFixture();
  const projectName = "iframe-alpha";
  const projectDirectory = path.join(fixture.iframesDirectory, projectName);
  const buildScript = path.join(projectDirectory, "iframe-build-html.sh");
  const buildMarker = path.join(projectDirectory, "built.txt");

  try {
    await mkdir(projectDirectory);
    await writeFile(
      buildScript,
      `#!/usr/bin/env bash\nprintf 'built' > ${JSON.stringify(toShellPath(buildMarker))}\n`,
    );
    await chmod(buildScript, 0o755);

    await assert.rejects(
      shipProjects({
        iframesDirectory: fixture.iframesDirectory,
        projectNames: [projectName],
        adapter: {
          getIframePath() {
            return "";
          },
          async shipIframe() {},
        },
      }),
      /IFRAME_PATH를 반환하지 않았습니다/,
    );
    await assert.rejects(access(buildMarker), { code: "ENOENT" });
  } finally {
    await fixture.dispose();
  }
});
