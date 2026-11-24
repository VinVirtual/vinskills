# Agent rules and why they exist

| Rule | Why |
|---|---|
| Work only in your own folder; scratch in `<folder>/.scratch/` | Several agents share one machine. A stray write breaks someone else's build. |
| Local commits only; no push, no repo creation, no package publish | Publishing is the owner's decision and cannot be undone cleanly. |
| No-reply commit identity, no attribution or co-author lines | Public history must not leak a personal or work address. |
| Random port in 41000-49999 | Fixed ports (3000, 5173, 8000) collide between agents. |
| Record the PID you start and kill only that PID | `pkill -f node` or `killall python` kills other agents' work. |
| Never wait on a dev server as background work | The agent blocks forever or reports on a server that already died. Start it, check it, stop it in one step. |
| No installs into system Python or other projects' environments | Breaks other projects silently. Use `.venv` or local `node_modules`. |
| Never delete outside your folder | Obvious, and still the one that causes the worst incidents. |
| `python -I` for helper scripts that read untrusted files | Stops a planted `json.py` in the working folder from being imported. |
| Commands run with argument arrays, never shell strings from input | No shell injection through file names. |
| No invented facts, numbers or quotes | Anything measured comes from a run on this machine. |
| Third-party assets only with a redistribution licence, recorded | A public repo is distribution. |
| Report what could not be verified | Silence reads as "verified". |

## Commit identity

```bash
git -c user.name="Your Name" -c user.email="12345678+you@users.noreply.github.com" commit -m "feat: ..."
```

Find your no-reply address on GitHub under Settings, Emails. Set it per command (as above) or
per repository (`git config user.email ...`), not globally, so other projects keep theirs.

## Stopping what you started

```bash
node server.mjs --port 4$(shuf -i 1000-9999 -n 1) & pid=$!
# ... check it ...
kill "$pid"
```
