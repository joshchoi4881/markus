# Setup — DJ Set Clipper

## Prerequisites

### 1. Dropspace Account + API Key
- Sign up at [dropspace.dev](https://www.dropspace.dev)
- Go to Settings → API Keys → Create Key
- Scopes needed: `read`, `write`, `publish`
- Save as `DROPSPACE_API_KEY` environment variable

### 2. Google Workspace CLI (gws)
- Install: `install the Google Workspace CLI (see https://github.com/nicholasgasior/gws)`
- Auth: Export OAuth credentials from Google Cloud Console
- Save credentials JSON to a secure location, set `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE` env var
- Required for: downloading source videos and uploading clips to Google Drive
- **Google Cloud Console setup:**
  1. Go to [console.cloud.google.com](https://console.cloud.google.com)
  2. Create a project (or use existing)
  3. Enable Google Drive API
  4. Create OAuth 2.0 credentials (Desktop application)
  5. Download the credentials JSON
  6. Run `gws auth login` with the credentials file to authorize

### 3. FFmpeg
- Install: `apt install ffmpeg` (Linux) or `brew install ffmpeg` (macOS)
- Required for: cutting video clips, audio analysis, transitions
- Verify: `ffmpeg -version`

### 4. Anthropic API Key
- Sign up at [console.anthropic.com](https://console.anthropic.com)
- Save as `ANTHROPIC_API_KEY` environment variable
- Used for: generating captions with artist credits and track info

### 5. Platform Connections
- Connect TikTok and/or Instagram in the Dropspace dashboard
- Go to Settings → Connections → Connect

## Environment Variables

```bash
export DROPSPACE_API_KEY="ds_live_..."                          # required
export ANTHROPIC_API_KEY="sk-ant-..."                           # required
export GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE="/path/to/creds"  # required
```

## Google Drive Folder Structure

Organize your source footage in Google Drive:

```
your-project/
├── event-name/
│   ├── source-video.mp4          # raw DJ set recording
│   └── clips/                    # auto-created — clips go here
└── another-event/
    ├── set-recording.mov
    └── clips/
```

The clipper will:
1. Download the source video from Drive
2. Analyze audio for transition points (beat detection)
3. Cut 30-second clips around each transition
4. Caption with artist/track credits
5. Upload clips back to a `clips/` subfolder in Drive
6. Create Dropspace launches for scheduling

## Quick Start

```bash
node setup.js --template dropspace-dj-clipper
# Follow prompts, then:
node clipper/scripts/clip-engine.js --app your-app --source DRIVE_FILE_ID --event "Event Name" --artist "DJ Name"
```
