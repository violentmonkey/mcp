# @violentmonkey/mcp

MCP server that lets AI agents manage your [Violentmonkey](https://violentmonkey.github.io/) userscripts.

```sh
claude mcp add violentmonkey -- npx -y @violentmonkey/mcp -p 5678
```

Then ask the agent to call `vm_status`, and open the connect URL it returns in your browser.

Options: `-p/--port`, `--host`, `--token` (or `VM_MCP_TOKEN`), `--transport stdio|http`, `--readonly`.

See the [full documentation](https://github.com/violentmonkey/mcp#readme).
