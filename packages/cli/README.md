# @willet/cli

A scriptable command-line interface for [Willet](https://github.com/SeriousBug/willet), the ticket tracker for AI agents. Drive tickets, projects, and organizations from the shell or unattended scripts — the same operations as the MCP tools, batched however you like.

```bash
npm install -g @willet/cli
```

## Target

By default the CLI talks to Willet Cloud. Point it at a self-deployed server with `--api-url`, the `WILLET_API_URL` environment variable, or `apiUrl` in `~/.willet/config.json`.

## Authenticate

```bash
willet login     # OAuth device flow, stores a short-lived token
willet whoami     # show the active identity
willet logout     # clear local credentials
```

For unattended scripts, set an API secret (minted in the web dashboard) via `WILLET_API_TOKEN` instead of running `login`.

## Use

```bash
willet ticket list --project <id>
willet ticket create --project <id> --title "..."
willet project list
willet --json ticket list --project <id>   # raw JSON for piping
```

Run `willet --help` for the full command surface.

See the [Willet repository](https://github.com/SeriousBug/willet) for documentation.
