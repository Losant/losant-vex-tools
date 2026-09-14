#!/bin/bash
set -e
for dir in */; do
  if [ -f "${dir}action.yml" ]; then
    echo "Building ${dir%/}..."
    ncc build "${dir}index.js" -o "${dir}dist" --license licenses.txt
  fi
done
