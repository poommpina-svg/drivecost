#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v git >/dev/null 2>&1; then
  echo "Git is required: https://git-scm.com/downloads"
  exit 1
fi

read -r -p "GitHub repository URL: " REPO_URL
if [[ -z "${REPO_URL}" ]]; then
  echo "Repository URL is required."
  exit 1
fi

git remote remove origin >/dev/null 2>&1 || true
git remote add origin "${REPO_URL}"
git branch -M main
git push -u origin main

echo "Push completed: ${REPO_URL}"
