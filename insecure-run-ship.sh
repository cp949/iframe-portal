#!/usr/bin/env bash
set -euo pipefail

NODE_TLS_REJECT_UNAUTHORIZED=0 pnpm ship "$@"
