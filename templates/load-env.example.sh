#!/bin/bash
# Load env vars for automation scripts.
# Customize for your secret management (1Password, Doppler, Vault, .env file, etc.)
#
# REQUIRED:
#   DROPSPACE_API_KEY_<APP>  — one per app (get from Dropspace dashboard → Settings → API Keys)
#   ANTHROPIC_API_KEY        — for LLM text generation (post content, captions)
#   FAL_KEY                  — for image generation (visual formats: story-slideshow) and video (ugc-reaction, ugc-talking)
#
# OPTIONAL (gracefully degrades if missing):
#   STRIPE_SECRET_KEY        — revenue attribution in reports
#   SUPABASE_ACCESS_TOKEN    — user signup attribution
#   POSTHOG_PERSONAL_API_KEY — client-side pageview tracking
#   SENTRY_ACCESS_TOKEN      — error monitoring in reports
#   GH_TOKEN                 — GitHub activity in reports
#   BIRD_AUTH_TOKEN + BIRD_CT0 — X/Twitter research via Bird CLI
#   X_BEARER_TOKEN           — X API fallback for research
#   X_<APP>_CLIENT_ID etc.   — X engagement (per-app OAuth credentials)
#   GWS_VAULT_PATH             — 1Password vault path for Google Workspace credentials (for clipper/slideshow templates)
#   GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE — alternative: direct path to GWS credentials JSON (no 1Password needed)

# === CREDENTIALS ===
# Choose ONE approach for managing secrets:
#
# Option A: Plain environment variables (simplest)
#   export DROPSPACE_API_KEY="ds_live_..."
#   export ANTHROPIC_API_KEY="sk-ant-..."
#   export FAL_KEY="..."
#
# Option B: 1Password Service Account
#   export OP_SERVICE_ACCOUNT_TOKEN="your-service-account-token"
#   export DROPSPACE_API_KEY="$(op read 'op://your-vault/DROPSPACE_API_KEY/password')"
#
# Option C: .env file (load with dotenv or source)
#   source .env
#
# For Google Workspace (clipper/slideshow templates):
#   Option A: export GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE="/path/to/credentials.json"
#   Option B: export GWS_VAULT_PATH="your-vault/GWS_CREDENTIALS/password"  # 1Password
#
# For GA4 analytics (optional):
#   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/adc-credentials.json"
#   export GOOGLE_CLOUD_PROJECT="your-gcp-project-id"

# === REQUIRED ===

# Dropspace API keys (one per app)
export DROPSPACE_API_KEY_MYAPP="your-dropspace-api-key"

# LLM for content generation
export ANTHROPIC_API_KEY="your-anthropic-key"

# Image generation (Fal.ai)
export FAL_KEY="your-fal-key"

# === OPTIONAL ===

# Revenue + user attribution
# export STRIPE_SECRET_KEY="sk_live_..."
# export SUPABASE_ACCESS_TOKEN="sbp_..."

# Traffic analytics
# export POSTHOG_PERSONAL_API_KEY="phx_..."

# Error monitoring
# export SENTRY_ACCESS_TOKEN="sntrys_..."

# GitHub
# export GH_TOKEN="github_pat_..."

# X/Twitter research (Bird CLI cookies — export from browser)
# export BIRD_AUTH_TOKEN="..."
# export BIRD_CT0="..."
# export X_BEARER_TOKEN="..."

# === 1PASSWORD PATTERN (if using op CLI) ===
# Uncomment and adapt if you use 1Password Service Accounts:
#
# export OP_SERVICE_ACCOUNT_TOKEN="your-service-account-token"
# export DROPSPACE_API_KEY_MYAPP="$(op read 'op://vault/DROPSPACE_API_KEY_MYAPP/password')"
# export ANTHROPIC_API_KEY="$(op read 'op://vault/ANTHROPIC_API_KEY/password')"
# export FAL_KEY="$(op read 'op://vault/FAL_KEY/password')"
