#!/usr/bin/env bash
# Универсальный запуск baresip по Agent ID
# Использование:
#   ./run_baresip.sh <AGENT_ID>

set -e

AGENT_ID="$1"
if [ -z "$AGENT_ID" ]; then
  echo "❗ Использование: $0 <AGENT_ID>"
  exit 1
fi

BASE_DIR="$HOME/.baresip_agents"
CONF_DIR="$BASE_DIR/baresip_${AGENT_ID}"
mkdir -p "$BASE_DIR"

RECORDS_SAVE_PATH="${BARESIP_RECORDS_PATH:-$HOME/aibot/call2telegram/records/audio}"

# Проверка и создание виртуальных устройств
create_virtual_device() {
  local name="$1"
  if ! pactl list short sinks | grep -q "^.*\s${name}\s"; then
    echo "🎧 Создаю виртуальный sink: ${name}"
    pactl load-module module-null-sink sink_name="${name}" sink_properties=device.description="${name}"
  else
    echo "✅ Sink ${name} уже существует"
  fi
}

# Проверяем и создаём виртуальные аудиоканалы для агента
create_virtual_device "${AGENT_ID}_VAC1"
create_virtual_device "${AGENT_ID}_VAC2"

# Проверяем, есть ли уже конфигурация SIP для этого агента
if [ -d "$CONF_DIR" ]; then
  echo "✅ Найдена существующая SIP-конфигурация для агента ${AGENT_ID}"
  echo "▶ Запуск baresip..."
  baresip -f "$CONF_DIR"
  exit 0
else
  echo "⚠️  SIP настройки несуществуют для данного агента - '${AGENT_ID}'."
  read -rp "Введите SIP User (например 828406): " SIP_USER
  read -rp "Введите SIP Password: " SIP_PASS
  read -rp "Введите SIP Host (например sip.zadarma.com): " SIP_HOST

  mkdir -p "$CONF_DIR"
fi

# ---------- config ----------
cat > "$CONF_DIR/config" <<EOF
#
# baresip configuration (auto-generated for agent ${AGENT_ID})
#

poll_method             epoll

call_local_timeout      120
call_max_calls          4

audio_player            pulse,${AGENT_ID}_VAC1
audio_source            pulse,${AGENT_ID}_VAC2.monitor
audio_alert             pulse
audio_level             no
ausrc_format            s16
auplay_format           s16
auenc_format            s16
audec_format            s16
audio_buffer            20-160

video_size              352x288
video_bitrate           500000
video_fps               25.00
video_fullscreen        no
videnc_format           yuv420p

rtp_tos                 184
rtcp_mux                no
jitter_buffer_delay     5-10

module_path             /usr/lib/baresip/modules

# Core UI
module                  stdio.so
module                  sndfile.so

# Audio codecs
module                  g711.so

# Audio drivers
module                  pulse.so
module                  alsa.so
module                  aubridge.so

# Media NAT
module                  stun.so
module                  turn.so
module                  ice.so

module			srtp.so

# Temporary modules (MUST for SIP registration)
module_tmp              uuid.so
module_tmp              account.so

# Application modules
module_app              menu.so
module_app              contact.so
module_app              debug_cmd.so
module_app              vidloop.so


vumeter_stderr          yes
snd_path                ${RECORDS_SAVE_PATH}
EOF

# ---------- accounts ----------
cat > "$CONF_DIR/accounts" <<EOF
<sip:${SIP_USER}@${SIP_HOST}>;auth_pass=${SIP_PASS};transport=udp;mediaenc=srtp-mand
EOF

# ---------- contacts ----------
touch "$CONF_DIR/contacts"

echo "✅ SIP конфигурация создана для агента ${AGENT_ID}"
echo "📂 Путь: $CONF_DIR"
echo "▶ Запуск baresip..."

baresip -f "$CONF_DIR"
