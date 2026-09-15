# Workstation screenshot agent

Takes **one screenshot per rep per day**, and only **while that rep is actually
screen-sharing in Discord** — so the image shows what they were streaming.

The rep's machine never decides on its own. It asks the server
(`/api/capture/should`), and the server answers "yes" only when that member's
Discord state says `isStreaming` and no screenshot has been stored for them yet
that day (Miami time). Screenshots appear under **06. Screenshots** in the
dashboard and are deleted automatically after 90 days.

## Before you install

This is monitoring software running on someone else's working machine. Tell the
team it is installed and what it does. In most places written notice is also a
legal requirement, and several of these scripts' behaviours (a visible log file,
no hiding) exist so a rep can verify what was captured. Do not deploy it to
machines that are not company-managed, and do not use it outside working hours.

## Server setup (once)

```bash
railway variables --set "CAPTURE_TOKEN=<a long random string>"
```

Optional tuning (all have sane defaults):

| Variable | Default | Meaning |
|---|---|---|
| `CAPTURES_PER_DAY` | `1` | Screenshots stored per rep per day |
| `CAPTURE_RETENTION_DAYS` | `90` | Days before images are deleted |
| `CAPTURE_POLL_SECONDS` | `300` | How often the agent checks in |
| `CAPTURE_DIR` | `/data/captures` | Storage path on the Railway volume |

## Per-machine setup

You need the rep's **Discord user ID**: in Discord turn on
Settings → Advanced → Developer Mode, then right-click their name → Copy User ID.

### Windows

1. Copy `capture-windows.ps1` to the machine.
2. Open it and fill in `$CaptureToken` and `$DiscordUserId`.
3. Test while the rep is screen-sharing:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\capture-windows.ps1 -Once
   ```
4. Install so it runs at every logon:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\capture-windows.ps1 -Install
   ```

Remove later with `-Uninstall`.

### macOS

1. Copy `capture-mac.sh` to the machine.
2. Open it and fill in `CAPTURE_TOKEN` and `DISCORD_USER_ID`.
3. Test while the rep is screen-sharing:
   ```bash
   chmod +x capture-mac.sh
   ./capture-mac.sh --once
   ```
   macOS will prompt for **Screen Recording** permission the first time. Allow
   it (System Settings → Privacy & Security → Screen Recording), then run again.
4. Install so it runs at every login:
   ```bash
   ./capture-mac.sh --install
   ```

Remove later with `--uninstall`.

## Checking it works

Both scripts write `capture-agent.log` next to themselves. A healthy log looks
like:

```
2026-09-15 09:04:11  Planet Rep capture agent started (user 123456789).
2026-09-15 09:04:12  No capture needed (not_streaming).
2026-09-15 09:34:15  Screenshot taken and uploaded while streaming in 'Sales Voice Chat'.
2026-09-15 10:04:18  No capture needed (already_captured_today).
```

Common reasons nothing is captured:

- `not_streaming` — the rep has not started Go Live yet. Expected.
- `Invalid capture token` — `CAPTURE_TOKEN` on the server and in the script differ.
- `screencapture failed` (macOS) — Screen Recording permission was not granted.
- Nothing in the log at all — the scheduled task / launch agent is not running.
