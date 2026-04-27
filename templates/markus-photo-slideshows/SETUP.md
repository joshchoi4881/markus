# Setup — Event Photo Slideshows

## Prerequisites

### 1. Dropspace Account + API Key
- Sign up at [dropspace.dev](https://www.dropspace.dev)
- Go to Settings → API Keys → Create Key
- Scopes needed: `read`, `write`, `publish`
- Save as `DROPSPACE_API_KEY` environment variable

### 2. Google Workspace CLI (gws)
- Install: `install the Google Workspace CLI (see https://github.com/nicholasgasior/gws)`
- Auth: Export OAuth credentials from Google Cloud Console
- Save credentials JSON, set `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE` env var
- Required for: accessing event photos from Google Drive
- **Google Cloud Console setup:**
  1. Go to [console.cloud.google.com](https://console.cloud.google.com)
  2. Create a project (or use existing)
  3. Enable Google Drive API
  4. Create OAuth 2.0 credentials (Desktop application)
  5. Download the credentials JSON
  6. Run `gws auth login` with the credentials file

### 3. Anthropic API Key
- Sign up at [console.anthropic.com](https://console.anthropic.com)
- Save as `ANTHROPIC_API_KEY` environment variable
- Used for: generating slideshow text overlays and captions

### 4. Image Generation API Key (optional)
- **Fal.ai:** Sign up at [fal.ai](https://fal.ai), save as `FAL_KEY`
- Only needed if you want AI-generated background images
- Not needed if using your own event photos (the default)

### 5. Platform Connections
- Connect TikTok and/or Instagram in the Dropspace dashboard
- Go to Settings → Connections → Connect

## Environment Variables

```bash
export DROPSPACE_API_KEY="ds_live_..."                          # required
export ANTHROPIC_API_KEY="sk-ant-..."                           # required
export GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE="/path/to/creds"  # required
export FAL_KEY="..."                                            # optional
```

## Google Drive Folder Structure

Upload event photos to Google Drive in folders per event:

```
your-community/
├── march-open-mic/
│   ├── photo1.jpg
│   ├── photo2.jpg
│   └── ...
├── april-showcase/
│   ├── photo1.jpg
│   └── ...
```

The slideshow generator will:
1. Download photos from the specified Drive folder
2. Resize and format for TikTok/Instagram dimensions
3. Add text overlays with face-aware positioning (text avoids covering people)
4. Create a slideshow with 5-6 slides per post
5. Upload to Dropspace and schedule

## Quick Start

```bash
node setup.js --template markus-photo-slideshows
# Follow prompts, then:
node clipper/scripts/create-slideshows.js --app your-app --folder DRIVE_FOLDER_ID --event "Event Name"
```
