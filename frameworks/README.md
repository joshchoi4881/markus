# Multi-Framework Support

Run the Dropspace content pipeline in your preferred AI agent framework. The scripts are framework-agnostic Node.js — any framework with shell access can run them.

## Framework Comparison

| | OpenClaw | Manus | Claude Code | Cursor |
|---|---------|-------|-------------|--------|
| **Runs scripts** | yes | yes (cloud sandbox) | yes (local) | yes (local + cloud) |
| **Built-in scheduling** | crons | scheduled tasks | no (use system cron) | Automations (cron/webhook) |
| **Background execution** | yes | yes (cloud) | no (interactive) | yes (Background Agents) |
| **State persistence** | local filesystem | sandbox (7-21 day TTL) | local filesystem | local filesystem |
| **Setup** | setup wizard | manual | manual | manual |

## Use Case Support

| Use Case | OpenClaw | Manus | Claude Code | Cursor |
|----------|----------|-------|-------------|--------|
| AI Content Engine | full | full (with caveats) | full (manual scheduling) | full |
| DJ Set Clipper | full | full (with caveats) | full | full |
| Event Photo Slideshows | full | full (with caveats) | full | full |

**Manus caveats:** 30-min sandbox TTL, credit-based pricing, sandbox resets after inactivity.

## Quick Start

### OpenClaw

```bash
# Uses the root SKILL.md + setup wizard
git clone https://github.com/joshchoi4881/dropspace-agents.git
cd dropspace-agents && npm install
node setup.js --template dropspace-content-engine
```

### Manus

Clone the repo in a Manus task, set secrets, schedule daily runs. See `frameworks/manus/` for per-use-case instructions.

### Claude Code

```bash
# 1. Add MCP server (for supplementary one-off operations)
claude mcp add dropspace -- npx -y @jclvsh/dropspace-mcp

# 2. Install a skill
curl -sSL https://raw.githubusercontent.com/joshchoi4881/dropspace-agents/main/frameworks/claude-code/ai-content-engine/SKILL.md \
  -o ~/.claude/skills/dropspace-content-engine/SKILL.md --create-dirs

# 3. Use it — type /dropspace-content-engine in Claude Code
# 4. Set up system cron for nightly automation (see SKILL.md for crontab commands)
```

### Cursor

```bash
# 1. Clone and run the pipeline
git clone https://github.com/joshchoi4881/dropspace-agents.git
cd dropspace-agents && npm install
node scripts/init-app.js --app myapp --platforms tiktok,twitter,linkedin

# 2. Copy the rules file (optional — for agent-requested activation)
curl -sSL https://raw.githubusercontent.com/joshchoi4881/dropspace-agents/main/frameworks/cursor/ai-content-engine/SKILL.md \
  -o .cursor/rules/dropspace-content-engine.mdc --create-dirs

# 3. Enable YOLO mode + allowlist "node scripts/*" for auto-approval
# 4. Schedule via Cursor Automations or Background Agents (see SKILL.md)
```

## All Frameworks Need

1. **Dropspace account + API key** from [dropspace.dev/settings/api](https://www.dropspace.dev/settings/api)
2. **Anthropic API key** for content generation
3. **Image generation API key** (fal.ai, replicate, or openai) for visual/video formats
4. **Node.js 18+**
