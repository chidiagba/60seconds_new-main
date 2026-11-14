#!/usr/bin/env bash
set -euo pipefail
# Run only against a NEW mirror clone after rotating exposed credentials.
repo_path=${1:?Usage: bash scripts/purge-exposed-history.sh /absolute/path/to/fresh-mirror.git}
if [ "$(git -C "$repo_path" rev-parse --is-bare-repository)" != true ]; then
  echo 'Refusing: use a fresh bare mirror clone, never the working checkout.' >&2
  exit 1
fi
command -v git-filter-repo >/dev/null || { echo 'Install git-filter-repo before proceeding.' >&2; exit 1; }
paths_file=$(mktemp)
replacements_file=$(mktemp)
trap 'rm -f "$paths_file" "$replacements_file"' EXIT
cat > "$paths_file" <<'PATHS'
.env
.env.local
.env.production
yes
yes.pub
eval _$(ssh-agent -s)_
keystore.jks
my-release-key.keystore
android/app/keystore.jks
android/applepay.key
backup-repo.git/
.expo-export-check/
.expo-export-android-check/
logs/
PATHS
cat > "$replacements_file" <<'REPLACEMENTS'
regex:sk_(?:live|test)_[A-Za-z0-9]{16,}==>REMOVED_ROTATE_KEY
regex:AIza[\w-]{30,}==>REMOVED_RESTRICTED_MAPS_KEY
regex:eyJhbGci[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+\.[A-Za-z0-9_=-]+==>REMOVED_PUBLIC_JWT
regex:cloudinary://[^\s'"<>]+:[^\s'"<>]+@==>REMOVED_CLOUDINARY_CREDENTIALS@
regex:[A-F0-9]{128}==>REMOVED_ROTATE_KEY
REPLACEMENTS
git -C "$repo_path" filter-repo --invert-paths --paths-from-file "$paths_file" --replace-text "$replacements_file"
echo 'Local mirror rewritten. Scan every ref with gitleaks before coordinating a remote history replacement.'
echo 'This script does not push to a remote.'
