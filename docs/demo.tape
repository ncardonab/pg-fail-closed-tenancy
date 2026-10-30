# Renders docs/demo.gif, the 60-second demo in the README.
#
#   brew install vhs
#   docker compose up -d --wait
#   vhs docs/demo.tape          (run from the repo root)
#
# It records a copy of the committed repo in /tmp, so the GIF shows a neutral
# path and exactly what is on main.

Output docs/demo.gif

Require docker
Require git
Require npm

Set Shell "bash"
Set Theme "GitHub Dark"
Set FontSize 15
Set Width 1200
Set Height 900
Set Padding 24
Set WindowBar Colorful
Set BorderRadius 8
Set TypingSpeed 30ms
Set Framerate 24

# Off camera: copy the committed repo to /tmp, reuse node_modules, silence
# npm's own banner lines, and make sure the database container is up.
Hide
Type `export REPO="$PWD" npm_config_loglevel=silent && rm -rf /tmp/pg-fail-closed-tenancy && mkdir /tmp/pg-fail-closed-tenancy && git archive HEAD | tar -x -C /tmp/pg-fail-closed-tenancy && ln -s "$REPO/node_modules" /tmp/pg-fail-closed-tenancy/node_modules && cd /tmp/pg-fail-closed-tenancy && docker compose up -d --wait >/dev/null 2>&1 && clear`
Enter
Wait@60s
Show

# 1. The role the app and the tests connect as.
Type "# The role the app and every test connect as:"
Enter
Type "npm run whoami"
Enter
Wait+Screen@30s /owns=0/
Sleep 3s

# 2. The suite, against real Postgres, as that role.
Type "# 19 integration tests against real Postgres, as that role:"
Enter
Type "npm test"
Enter
Wait+Screen@60s /Tests\s+19 passed/
Sleep 4s
Ctrl+L

# 3. The same suite as a superuser refuses to start.
Type "# The same suite as a superuser refuses to start:"
Enter
Type "npm run test:as-superuser"
Enter
Wait+Screen@60s /Refusing to run/
Sleep 4s
Ctrl+L

# 4. Inside the database, as the application role.
Type "# Inside the database, as app_user:"
Enter
Type "docker compose exec db psql -U app_user -d tenancy -q"
Enter
Wait /tenancy=>/
Type "SELECT count(*) FROM contacts;  -- no organization set"
Enter
Sleep 2s
Type "BEGIN;"
Enter
Type "SELECT set_config('app.org_id', '00000000-0000-4000-8000-00000000000a', true);"
Enter
Sleep 1s
Type "SELECT full_name, consent FROM contacts;  -- Org A only"
Enter
Sleep 2.5s
Type "ROLLBACK;"
Enter
Type "DELETE FROM audit_log;"
Enter
Sleep 3s
Type "\q"
Enter
Sleep 1s
