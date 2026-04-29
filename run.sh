#!/bin/bash
# Runner script for cron jobs. Sources env and executes the given command.
# Usage: bash ~/markus/run.sh node ~/markus/scripts/schedule-day.js --app dropspace
set -euo pipefail
source "$(dirname "$(readlink -f "$0")")/load-env.sh"
exec "$@"
