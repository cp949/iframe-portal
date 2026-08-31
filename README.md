# iframe-portal ship CLI

`iframes/` 아래의 iframe 프로젝트를 선택해 빌드하고, 설정 기반 HTTP uploader로 archive를 전달하는 CLI입니다. 서버 주소, 인증 방식, 배포 경로는 공개 코드에 포함하지 않습니다.

## 요구 환경

- Node.js `^20.19.0 || >=22.13.0`
- pnpm 10
- bash로 실행 가능한 각 프로젝트의 `iframe-build-html.sh`
- Windows에서는 Git for Windows(Git Bash)

## 설치

```bash
pnpm install
mkdir -p ~/.config/iframe-portal
cp ship-config.example.json ~/.config/iframe-portal/ship.json
chmod 600 ~/.config/iframe-portal/ship.json
```

`~/.config/iframe-portal/ship.json`에 실제 iframe 경로와 업로드 설정을 작성합니다. 이 파일은 저장소 밖에 있으므로 Git에 포함되지 않습니다.

## 로컬 설정

```json
{
  "iframePrefix": "...",
  "endpoint": "...",
  "headers": {
    "...": "..."
  },
  "encryptionKey": "...",
  "fileField": "...",
  "fields": {
    "...": "..."
  }
}
```

- `iframePrefix`: 프로젝트 이름 앞에 붙는 비공개 iframe 경로
- `endpoint`: 프로젝트 이름 앞에 붙는 업로드 endpoint
- `headers`: 업로드 요청에 추가할 비공개 header와 값
- `encryptionKey`: `.tar.gz`를 outer ZIP으로 암호화할 비공개 키
- `fileField`: multipart archive 필드명
- `fields`: multipart에 추가할 문자열 필드

다른 위치를 사용하려면 `IFRAME_PORTAL_SHIP_CONFIG_PATH`에 설정 파일 경로를 지정합니다. `XDG_CONFIG_HOME`이 설정되어 있으면 기본 경로도 이를 따릅니다.

## 실행

```bash
# 대화형 메뉴
pnpm ship

# 특정 프로젝트
pnpm ship iframe-image-editor

# 여러 프로젝트
pnpm ship iframe-image-editor iframe-other

# 모든 프로젝트
pnpm ship --all
```

인자가 없는 비대화형 실행은 실패합니다. 전체 배포는 `--all`을 명시해야 합니다.

### Windows (Git Bash)

Windows에서는 CLI가 `iframe-build-html.sh`를 Git Bash의 `bash.exe`로 실행합니다. bash는 다음 순서로 찾습니다.

1. `IFRAME_PORTAL_BASH` 환경변수에 지정한 경로
2. Git Bash가 설정한 `EXEPATH`
3. Git for Windows 기본 설치 경로
4. `PATH`의 `bash.exe` (WSL launcher인 `%SystemRoot%\System32\bash.exe`는 제외)

표준 위치가 아닌 곳에 설치했다면 경로를 직접 지정합니다.

```bash
IFRAME_PORTAL_BASH="D:/tools/git/bin/bash.exe" pnpm ship iframe-image-editor
```

MSYS는 `/aimk/iframe` 같은 값을 Windows 경로로 바꾸기 때문에 CLI가 `IFRAME_PATH`를 변환 제외 목록(`MSYS2_ENV_CONV_EXCL`, `MSYS2_ARG_CONV_EXCL`)에 넣어 전달합니다. 빌드 스크립트에서 `IFRAME_PATH`를 다른 이름으로 다시 내보내면 이 보호가 적용되지 않습니다.

Git Bash의 mintty 터미널은 Node에서 TTY로 보이지 않아 대화형 메뉴가 열리지 않습니다. 메뉴가 필요하면 `winpty pnpm ship`으로 실행하고, 그렇지 않으면 프로젝트명이나 `--all`을 지정합니다.

설정 파일 기본 경로는 `%USERPROFILE%\.config\iframe-portal\ship.json`으로, Git Bash의 `~/.config/iframe-portal/ship.json`과 같은 위치입니다.

## 프로젝트 계약

배포 가능한 프로젝트는 다음 파일을 제공해야 합니다.

```text
iframes/<project>/iframe-build-html.sh
```

CLI는 아래 환경변수로 빌드 스크립트를 실행합니다.

```text
IFRAME_PATH=<iframePrefix>/<project>
```

빌드 스크립트는 다음 archive를 생성해야 합니다.

```text
iframes/<project>/<project>.tar.gz
```
