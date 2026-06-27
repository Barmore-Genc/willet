#!/bin/sh
set -e

case "$1" in
  serve|"")
    exec node dist/index.js
    ;;
  export)
    shift
    exec node dist/export.js "$@"
    ;;
  import)
    shift
    exec node dist/import.js "$@"
    ;;
  *)
    echo "Unknown command: $1"
    echo "Usage: docker run <image> [serve|export|import] [options]"
    exit 1
    ;;
esac
