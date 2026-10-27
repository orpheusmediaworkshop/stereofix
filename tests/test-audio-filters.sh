#!/bin/sh
# Local FFmpeg desktop check of exactly the filters used by StereoFix-Web.
set -eu
TEST_DIR="$(mktemp -d)"
trap 'rm -rf "$TEST_DIR"' EXIT
ffmpeg -hide_banner -loglevel error -f lavfi -i 'color=c=black:s=320x180:r=24:d=1' -f lavfi -i 'sine=frequency=440:duration=1:sample_rate=48000' -f lavfi -i 'sine=frequency=880:duration=1:sample_rate=48000' -filter_complex '[1:a][2:a]amerge=inputs=2[a]' -map '0:v:0' -map '[a]' -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$TEST_DIR/source.mp4"
for MODE in mix left right; do
  case "$MODE" in
    mix) FILTER='pan=mono|c0=0.5*c0+0.5*c1';;
    left) FILTER='pan=mono|c0=c0';;
    right) FILTER='pan=mono|c0=c1';;
  esac
  ffmpeg -hide_banner -loglevel error -i "$TEST_DIR/source.mp4" -map 0:v:0 -map 0:a:0 -c:v copy -sn -dn -af "$FILTER" -c:a aac -b:a 160k -ac 1 -movflags +faststart "$TEST_DIR/processed_$MODE.mp4"
  PROBE="$(ffprobe -v error -select_streams a:0 -show_entries stream=channels -of csv=p=0 "$TEST_DIR/processed_$MODE.mp4")"
  if [ "$PROBE" != "1" ]; then echo "FAILED $MODE: channels=$PROBE"; exit 1; fi
  echo "PASS: $MODE mono, video stream copied"
done
for CHANNEL in left right; do
  if [ "$CHANNEL" = left ]; then FILTER='pan=mono|c0=c0'; else FILTER='pan=mono|c0=c1'; fi
  ffmpeg -hide_banner -loglevel error -i "$TEST_DIR/source.mp4" -map 0:a:0 -vn -sn -dn -af "$FILTER" -c:a aac -b:a 160k -ac 1 "$TEST_DIR/channel_$CHANNEL.m4a"
  PROBE="$(ffprobe -v error -select_streams a:0 -show_entries stream=channels -of csv=p=0 "$TEST_DIR/channel_$CHANNEL.m4a")"
  if [ "$PROBE" != "1" ]; then echo "FAILED split $CHANNEL"; exit 1; fi
  echo "PASS: split $CHANNEL mono AAC"
done
