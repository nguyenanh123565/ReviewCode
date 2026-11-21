#!/usr/bin/env bash

# Copy only the expected, non-secret audit artifacts out of a disposable run.
# Returns success when no source audit directory exists (for example, Docker
# could not start); an existing but unsafe artifact fails closed.
archive_reviewbench_audit() {
  local source_dir="$1" destination_dir="$2" name
  local copied=0

  if [ ! -e "$source_dir" ] && [ ! -L "$source_dir" ]; then
    return 0
  fi
  if [ ! -d "$source_dir" ] || [ -L "$source_dir" ]; then
    echo "audit source is not a directory" >&2
    return 1
  fi
  if [ ! -d "$destination_dir" ] || [ -L "$destination_dir" ]; then
    echo "audit destination is not a directory" >&2
    return 1
  fi
  if [ -n "$(find "$destination_dir" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    echo "audit destination is not empty; refusing to overwrite prior evidence" >&2
    return 1
  fi

  for name in metadata.json codex-response.json findings.json; do
    if [ -e "$source_dir/$name" ] || [ -L "$source_dir/$name" ]; then
      if [ ! -f "$source_dir/$name" ] || [ -L "$source_dir/$name" ]; then
        echo "audit artifact $name is not a regular file" >&2
        return 1
      fi
      cp -p -- "$source_dir/$name" "$destination_dir/$name" || return 1
      copied=$((copied + 1))
    fi
  done
  return 0
}
