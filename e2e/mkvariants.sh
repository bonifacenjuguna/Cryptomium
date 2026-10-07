#!/bin/sh
# Builds two marked versions of the current frontend (A = 9.0.0, B = 9.0.1) into /tmp/feA/dist and /tmp/feB/dist.
set -e
for v in A B; do
  rm -rf /tmp/fe$v; mkdir /tmp/fe$v
  for f in build.js coins.json package.json site.config.json vercel.json; do cp ${SRC:-/home/claude/frontend}/$f /tmp/fe$v/; done
  cp -r ${SRC:-/home/claude/frontend}/src /tmp/fe$v/src
  echo "window.__MARK='$v';" >> /tmp/fe$v/src/js/coin.js
done
sed -i 's/"version": "[^"]*"/"version": "9.0.0"/' /tmp/feA/package.json
sed -i 's/"version": "[^"]*"/"version": "9.0.1"/' /tmp/feB/package.json
for v in A B; do (cd /tmp/fe$v && SITE_URL=http://localhost:4173 API_URL=http://localhost:4173 node build.js | tail -1); done
