# Media Toolkit Pro (v0.1.0)

Electron + React + Vite + Tailwind desktop app (all media processing is local) with an Express + MongoDB backend in `server/`.

## Run it
    # 1. backend (details, SSLCommerz and MFS setup: server/README.md)
    cd server && npm install && cp .env.example .env     # fill secrets, then:
    npm run keys                                         # paste both keys into server/.env
    SEED_ADMIN_EMAIL=you@x.com SEED_ADMIN_PASSWORD='long-password-12+' npm run seed && npm run dev

    # 2. desktop app
    cd .. && npm install        # postinstall rebuilds better-sqlite3 for Electron
    # save the server's ENTITLEMENT_PUBLIC_KEY (PEM) as electron/config/entitlement-public.pem  (enables offline use)
    MTP_API_URL=http://localhost:4000 npm run dev

## How the pieces fit
    Renderer (React) -> window.mediaAPI (frozen bridge) -> IPC (sender + schema validated) -> Main process
    Main: FFmpeg / Sharp / pdf-lib / SQLite (history, settings) + apiClient (cookies in a private session) + licence (plan gate)
    Every job is gated: main asks the server "may this user run <feature> on this file?" before any work starts.
    Offline: the server's ES256-signed 72h snapshot is verified with the embedded PUBLIC key; usage is queued and synced later.
    Outdated app (server minimum version): online features pause, local tools keep working.

## Tests (what each one really proves)
    npm test                  50 tests: queue, IPC validation, FFmpeg/PDF/thumbnails, SQLite vault, entitlement + offline rules,
                              logger, updater, hardware-encoder args, headless React UI flows, undefined-component lint
    cd server && npm test     40 logic + HTTP tests; 27 more DB integration tests run when MONGODB_TEST_URI points at a THROWAWAY database
    npm run smoke:electron    launches the REAL Electron app (needs xvfb on Linux) and runs 19 end-to-end checks: renderer isolation, real
                              encodes/PDFs/cancel, Vault, thumbnails, logs (SQLite must be built for Electron: done by postinstall)
    npm run pack && npm run smoke:packaged
                              builds the Linux package and runs 7 checks against the PACKAGED app: production CSP, unpacked FFmpeg/Sharp/SQLite
    Note: after `npm install`, SQLite is built for Electron, so the 3 SQLite unit tests skip under plain Node (the smoke test covers them).

## Packaging
    npm run dist              builds installers for the CURRENT OS into release/ (icons in build/, config in package.json "build")
    Windows (NSIS), macOS (DMG x64+arm64), Linux (AppImage + deb) are configured; only Linux has been built and run (unpacked).
    Signing: Windows needs a code-signing certificate, macOS needs a Developer ID + notarization (set CSC_LINK / CSC_KEY_PASSWORD, APPLE_* vars).
    Auto-update: uses electron-updater against the feed in package.json build.publish (placeholder URL: change it). Updates are checked,
    downloaded and installed only when the user presses a button, and only work in installed, signed builds.

## What is NOT verified / still open
- SSLCommerz (payment AND refund) is implemented from public documentation; run a full sandbox payment and refund before going live.
- The 27 backend DB integration tests have never been run (no MongoDB in the build environment). Run them first.
- Windows and macOS: build config exists, but those installers were never built or run. NVENC / AMF / QSV / VideoToolbox encoders are
  detected by a real test encode and fall back to CPU, but have never run on actual hardware. Your AMD VAAPI path is covered by
  argument tests that match your original script; it has never run on a real GPU.
- Refunds are full refunds only. Refunding an earlier purchase inside a same-plan renewal chain ends that purchase but does not shorten later periods.
- One person can still make many accounts with different real email providers. Only Gmail-style aliases and an admin-set blocklist are stopped.
- Queue and Settings screens are not plan-gated (by design). Bug reports can attach a screenshot and an opt-in log, not arbitrary files.
