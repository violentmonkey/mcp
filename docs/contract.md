# Contract

The tools an agent needs to *develop* userscripts, as opposed to manage them.

## Why

`scripts_list`, `scripts_get`, `scripts_write`, `scripts_set_enabled` and `scripts_delete`
are an admin API. They change state and never show consequences. An agent writing a
userscript with only those tools is guessing: it cannot tell whether its script matched
the page, ran, threw, or did nothing at all.

The tools below close that loop:

```
scripts_write ──► tab_reload ──► tab_scripts ──► script_logs ──┐
      ▲                                                        │
      └──────────────── patch and repeat ◄─────────────────────┘
```

Three of them read, one acts, and one answers a question about a URL without touching
the browser at all.

## Scope

This document defines the tool schemas and the behavior the MCP server guarantees.
Implementing the tools inside the extension is out of scope here.

## Observation boundary

The agent sees only what a userscript deliberately emits through `GM_log`. The extension
does not capture `console`, page content, network traffic or DOM state.

This is a deliberate limit rather than an implementation gap. Capturing `console` would
give the agent read access to arbitrary pages the user visits, which is a different
permission from "may edit my scripts" and deserves its own consent. Agents that need to
inspect or drive a page should use an extension built for that purpose, with permissions
the user grants knowingly.

Two consequences follow:

- `GM_log` is the only feedback channel, so `tab_scripts` carries injection and execution
  errors. Without it a script that throws at `document-start` produces nothing at all.
- `GM_log` requires `@grant GM_log`. Scripts that omit it get a `ReferenceError`, so tool
  descriptions should say so.

## Grants

A grant is permission to act on one tab. The user creates it explicitly from the
Violentmonkey dashboard. Nothing is granted by default, so `tabs_list` returns an empty
array until the user grants a tab.

- Grants live in extension memory only. They are never persisted.
- A grant is revoked when its tab closes.
- Because grants are never persisted and die with their tab, a bare tab id is a safe key:
  a recycled id cannot inherit a stale grant.
- A call against a tab that is not granted fails with `403`.

Three tools require a grant: `tab_scripts`, `tab_reload` and `script_logs`. `tabs_list`
enumerates grants, and `scripts_test_match` touches no page, so both work with none.

`tab_reload` carries no `destructiveHint`. Consent is the grant, not a per-call prompt:
confirming every reload would make the write/reload/inspect loop unusable.

## Tool visibility

The server registers every tool but exposes only what the extension reports.

- Before `hello`, only `vm_status` is enabled. It is handled by the server, and it is how
  the agent discovers the connect URL.
- On `hello`, the exposed set is the intersection of the server registry and the names in
  `hello.tools`, minus anything filtered by `--readonly`.
- On any status change (connect, disconnect, replace) the set is recomputed and
  `notifications/tools/list_changed` is sent.
- On disconnect the set collapses back to `vm_status` alone.

An extension that does not implement a tool omits it from `hello.tools`, so the tool is
never listed. Compatibility with older extensions needs no special handling.

## Tools

| Tool | Grant | Annotation |
| --- | --- | --- |
| `tabs_list` | — | read-only |
| `tab_scripts` | tab | read-only |
| `tab_reload` | tab | idempotent |
| `script_logs` | tab | read-only |
| `scripts_test_match` | — | read-only |

### `tabs_list`

List the tabs the user has granted to the agent.

```ts
input:  {}
output: {
  tabs: Array<{
    tabId: number;
    url: string;
    title: string;
  }>;
}
```

Empty until the user grants a tab. When empty, the agent should call `vm_status` and hand
the user its `connectUrl`.

### `tab_scripts`

Report what the extension attempted to run on a tab's current document.

```ts
input:  { tabId: number }
output: {
  url: string;
  loadId: string;
  scripts: Array<{
    id: number;
    name: string;
    version?: string;
    runAt: string;          // @run-at, e.g. "document-start"
    frameId: number;
    status: 'injected' | 'failed' | 'pending';
    error?: string;         // present when status is "failed"
    codeHash?: string;      // identifies the injected source
  }>;
}
```

- `injected`: the script ran.
- `failed`: injection or execution threw; `error` carries the message.
- `pending`: scheduled by `@run-at` but not yet run at the time of the call.

Absence means the script did not run on this document. The agent resolves *why* by
combining `scripts_list` (is it disabled?), `scripts_test_match` (would it match?) and
this tool (did it run?). Reporting predictions here would mix observation with
prediction; keep them separate.

`codeHash` lets the agent confirm the tab is running the source it just wrote rather than
a stale injection.

### `tab_reload`

Reload a tab so the extension re-injects.

```ts
input:  { tabId: number }
output: { tabId: number; url: string; loadId: string }
```

Pure reload: no navigation, no URL parameter. A granted tab belongs to the user, and
letting the agent navigate it elsewhere would escape the grant.

The returned `loadId` identifies the new document. Pass it to `script_logs` as
`sinceLoadId` so the agent reads the logs of the load it just triggered instead of racing
the page.

### `script_logs`

Read `GM_log` output captured for a tab.

```ts
input: {
  tabId: number;
  scriptId?: number;
  afterSeq?: number;
  sinceLoadId?: string;
  limit?: number;           // default 200, max 500
}
output: {
  entries: Array<{
    seq: number;            // monotonic per tab
    time: number;           // ms since epoch
    scriptId: number;
    text: string;           // serialized, truncated
    truncated?: boolean;
    count?: number;         // identical consecutive lines collapsed
  }>;
  nextSeq: number;          // pass as afterSeq to poll
  dropped: number;          // entries evicted from the buffer since the last call
}
```

A cursor rather than a timestamp: page and server clocks disagree, equal timestamps are
ambiguous, and a cursor is resumable. `afterSeq` reads incrementally, `sinceLoadId` scopes
to one document.

Caps, so a runaway script cannot exhaust the agent's context:

- 1000 entries and 2 MB per tab, oldest dropped first.
- 8 KB per entry, serialized with a depth limit.
- 200 entries per response by default, 500 at most.
- Identical consecutive lines are collapsed with `count`.
- `dropped` tells the agent its view is incomplete rather than letting it conclude "no
  errors".

Capture runs only while the extension is connected, so history starts at connect time or
the last load, whichever is later.

### `scripts_test_match`

Ask whether a userscript would be injected at a URL. Reuses the extension's matcher, so
the answer is the one the browser would give.

```ts
input: {
  code: string;             // full source, including the ==UserScript== block
  url: string;
}
output: {
  matched: boolean;
  rule?: string;            // the pattern that decided the result
  tried: string[];          // every URL rule evaluated, in order
}
```

Takes `code` rather than a script id so it works before the script exists, and so the
agent tests exactly what it is about to write with `scripts_write`.

Stateless: no tab, no grant, no stored script. When the metadata block cannot be parsed,
the call fails with `400` and the extension's message, the same as `scripts_write`.

## Errors

Existing codes apply unchanged. Two are worth restating:

| Code | Meaning here |
| --- | --- |
| `403` | Tab not granted, or the user revoked the grant |
| `400` | `scripts_test_match` received a `code` whose metadata block cannot be parsed |

`503` still means the extension is not connected, which is also why the tool list is
empty apart from `vm_status`.

## Non-goals

- Capturing `console`, DOM state or network traffic. See "Observation boundary".
- `tab_eval` or `tab_query`. Userscripts do not work by being driven from outside; an
  agent that needs to operate a page should use an extension built for it.
- `scripts_for_url` / `getMatchedScripts(url)`. It only works on installed scripts, so
  using it requires installing the thing you are unsure about, and `tab_scripts` already
  answers the same question for the page the user is on.
- Navigating a granted tab.
- Persisting grants across restarts.

## Open questions

- Is `pending` worth the bookkeeping, or should absence cover scheduled-but-not-run?
- Are the log caps above the right shape, or should they be configurable?
