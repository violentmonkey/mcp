---
'@violentmonkey/mcp': patch
'@violentmonkey/mcp-client': patch
'@violentmonkey/mcp-protocol': patch
---

Add tools that let an agent develop a userscript instead of only managing it: `tabs_list`, `tab_scripts`, `tab_reload`, `script_logs` and `scripts_test_match`. See [docs/contract.md](../docs/contract.md).

Tab tools operate only on tabs the user has granted explicitly, and `script_logs` returns only what a script emitted through `GM_log`.

`tools/list` now contains `vm_status` alone until the extension connects, instead of listing every tool and failing calls with `503`. A call that races a disconnect still returns `503`.
