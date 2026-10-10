#!/usr/bin/env bash
# One 3h03m slot of the live stream. Slots alternate primary/backup ingest so two VMs can overlap.
set -uo pipefail

SLOT="${SLOT:-1}"
TOTAL="${TOTAL:-4}"
FPS="${FPS:-30}"
RUN_MIN=183          # each slot streams 3h03m
HANDOFF_MIN=170      # start the next VM this many minutes after this one starts

cd "$(dirname "$0")/.."

# flags live in the repo (flags/*.png); only fetch if some are missing
if [ "$(ls flags/*.png 2>/dev/null | wc -l)" -lt "$(wc -w < codes.txt)" ]; then python3 scripts/download_flags.py; fi

if [ "$SLOT" = "1" ]; then python3 scripts/yt.py create; else python3 scripts/yt.py find; fi
source ./live.env

printf '%s' "${STATE_IN:-{\}}" > state.json

python3 scripts/server.py > server.log 2>&1 &
sleep 2

Xvfb :99 -screen 0 720x1280x24 -nolisten tcp > xvfb.log 2>&1 &
export DISPLAY=:99
sleep 2

CHROME="$(command -v google-chrome || command -v chromium || command -v chromium-browser)"
"$CHROME" --no-sandbox --kiosk --window-size=720,1280 --window-position=0,0 \
  --user-data-dir=/tmp/chrome-profile --disable-infobars --noerrdialogs --disable-translate \
  --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist \
  --autoplay-policy=no-user-gesture-required --disable-background-timer-throttling \
  --disable-renderer-backgrounding --disable-backgrounding-occluded-windows \
  "http://localhost:8080/index.html?speed=2" > chrome.log 2>&1 &
sleep 8

if [ $(( SLOT % 2 )) -eq 1 ]; then OUT="$PRIMARY/$STREAM_KEY"; else OUT="$BACKUP/$STREAM_KEY"; fi
echo "slot $SLOT -> $([ $(( SLOT % 2 )) -eq 1 ] && echo primary || echo backup) ingest"

# wake the next VM
if [ "$SLOT" -lt "$TOTAL" ]; then
  (
    sleep $(( HANDOFF_MIN * 60 ))
    gh workflow run live.yml --repo "$GITHUB_REPOSITORY" --ref "${GITHUB_REF_NAME:-main}" \
      -f slot=$(( SLOT + 1 )) -f total_slots="$TOTAL" -f state="$(cat state.json)"
  ) &
fi

END=$(( $(date +%s) + RUN_MIN * 60 - 12 ))
while [ "$(date +%s)" -lt "$END" ]; do
  timeout $(( END - $(date +%s) )) ffmpeg -hide_banner -loglevel warning \
    -f x11grab -framerate "$FPS" -video_size 720x1280 -i :99 \
    -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 \
    -c:v libx264 -preset veryfast -pix_fmt yuv420p -profile:v high \
    -b:v 3500k -maxrate 3500k -bufsize 7000k -g $(( FPS * 2 )) -keyint_min $(( FPS * 2 )) -sc_threshold 0 \
    -c:a aac -b:a 128k -ar 44100 -f flv "$OUT" || true
  sleep 2   # ffmpeg dropped? reconnect immediately
done

if [ "$SLOT" -ge "$TOTAL" ]; then python3 scripts/yt.py complete || true; fi
