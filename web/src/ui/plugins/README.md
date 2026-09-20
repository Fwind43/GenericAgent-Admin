# Local external UI packages (first slice)

Open Settings > UI plugins to install a `.gaui.zip`, select it, preview fictional data, save its configuration, enable it, or restore the default. Installation and preview do not enable a package. Packages and configuration are stored in browser-local IndexedDB, not server configuration. Restoring the default retains installed packages and configuration.

The manager provides a downloadable `local-workshop.gaui.zip`; its source is `example.json`. `protocol.js` is the authoritative version/field/action/size allowlist. This is a restricted declarative JSON format, not executable JavaScript, arbitrary HTML/CSS, or an npm plugin loader. The sample archive uses ZIP store entries. Do not assume every ZIP tool/compression mode is supported.

## Current coverage

- `admin.shell` and `admin.overview`: declarative replacement views using projected data and allowlisted host callbacks.
- `chat.sidebar`, `chat.messages`, `chat.composer`: allowlisted declarative `before`/`after` trees around a fixed host-owned slot, plus restricted layout attributes. Summary projection contains only title/status/count; message text, drafts, attachment values and controller references are not exposed. Host business content and draft nodes stay mounted. These are not arbitrary replacement chat renderers.
- `chat.navigation` and `chat.followToolbar`: declarative `content` replaces the sidebar header navigation and follow-latest toolbar, respectively. Missing or invalid declarations retain the corresponding host slot; the message list, composer and sidebar business siblings are not replaced.
- Chat actions are limited to opening settings, entering session management, starting a new conversation, collapsing navigation, following the latest message and opening commands; surface and host-state guards apply, with disabled replacement buttons reflecting those guards. Sending, deleting, model changes and arbitrary action parameters are not supported. Invalid chat declarations fall back independently to their host surface.
- Other administrative pages retain their existing host/built-in surfaces. Full external replacement of every page is not implemented.
- Legacy custom-color controls and the persistent chat package bar are removed. Stored legacy colors are retained and suppressed while an external package is active; preset theme/language settings remain.

## Recovery and safety

`/admin/overview?ui=safe` is the independent recovery entry. It does not import candidate UI modules or mount business roots. It resets package selections while retaining package configuration. Shared entry/runtime failures remain outside that recovery boundary. Storage failures are displayed; unavailable IndexedDB is not replaced with an unreported persistence fallback.

## Verification

From `web`: `node node_modules/vitest/vitest.mjs run --config vitest.external-ui.config.mjs`.
The independent config does not load the development config or local credentials. Tests cover the sample archive, schema rejection, persistence, manager workflow, fictional preview, safe mode, projection/action restrictions, real surface wiring, and host draft identity during selection changes.

A passing jsdom suite/build does not establish browser visual acceptance. Light/dark/warm theme and responsive browser acceptance remain separate release gates.
