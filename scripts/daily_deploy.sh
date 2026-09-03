#!/bin/sh
# Commits and pushes The Daily Savannah.
# The Claude sandbox cannot delete files, so git's leftover lock files are
# moved into .git/_to_delete/ (safe to empty manually at any time).
cd "$(dirname "$0")/.." || exit 1
clean() {
  for f in .git/index.lock .git/HEAD.lock .git/objects/*/tmp_obj_*; do
    [ -e "$f" ] && mv -f "$f" .git/_to_delete/ 2>/dev/null
  done
  :
}
mkdir -p .git/_to_delete
clean
git add -A blog/daily blog/index.html jobs scripts firebase.json sitemap.xml
clean
git -c user.name="The Daily Savannah" -c user.email="daily@thetechhut.co" \
    commit -m "${1:-Daily Savannah edition}"
clean
git push origin chore/redesign
status=$?
clean
exit $status
