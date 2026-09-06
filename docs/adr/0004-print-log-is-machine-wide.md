---
status: accepted
---

# The print log lives in a machine-wide directory, not per user

Clinic Windows machines use individual staff logins. A per-user app data directory would split print history by whoever was logged in. The log is one SQLite file per machine, under ProgramData on Windows and /Users/Shared on macOS, so the history screen shows every print run from that printer regardless of the login.
