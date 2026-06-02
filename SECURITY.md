# Security policy

## Supported versions

Shiage is v0.1 — only the latest `0.x` release receives security fixes. Once `1.0`
lands, the last two minor lines will be supported.

## Threat model in one paragraph

Shiage runs at **dev time only**. The browser runtime injects via the framework's dev
server and only opens a WebSocket connection to `localhost`. It writes to the same JSX
files your editor writes to and has no production output (the Vite plugin is
`apply: 'serve'`; the Next plugin guards on `dev` and emits null elsewhere). The most
realistic attack surface is therefore:

- A malicious page open in the same browser context discovering the local WS port.
- A bug in the AST editor writing the wrong file or the wrong region of a file.
- A bug in the path resolution leaking source contents into a diff visible to other
  origins.

## How to report a vulnerability

Please **do not** open a public GitHub issue for security reports.

- Preferred: GitHub's [private vulnerability reporting](https://github.com/horacechoi/shiage/security/advisories/new).
- Alternative: email <horacechoi.contact@gmail.com> with `[shiage security]` in the subject.

What to include if you can:

1. A reproducer or a description of the vulnerable path (file + function).
2. The Shiage version (`@shiage/vite` / `@shiage/next` etc.) and your framework version.
3. Your assessment of impact.

We'll acknowledge within a few days, work on a fix, and credit you in the release notes
unless you'd rather stay anonymous.

## Out of scope

- Anything in production builds — Shiage is dev-only and emits no production code.
- Misconfiguration that exposes a dev server on the public internet (don't do that).
- Findings from running Shiage against codebases you don't own — get authorization
  first.
