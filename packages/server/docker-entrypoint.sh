#!/bin/sh
set -e

case "$1" in
  serve|"")
    exec node packages/server/dist/index.js
    ;;
  export)
    shift
    exec node packages/server/dist/export.js "$@"
    ;;
  import)
    shift
    exec node packages/server/dist/import.js "$@"
    ;;
  *)
    echo "Unknown command: $1"
    echo "Usage: docker run <image> [serve|export|import] [options]"
    exit 1
    ;;
esac
