#!/bin/sh
# KannoProxy - shared utilities

KANNO_DIR="/etc/kanno"
KANNO_RUN="/var/run/kanno"
KANNO_LOG="/var/log/kanno.log"
MIHOMO_BIN="/usr/bin/mihomo"
SINGBOX_BIN="/usr/bin/sing-box"
MIHOMO_CFG="/etc/kanno/mihomo/config.yaml"
SINGBOX_CFG="/etc/kanno/singbox/config.json"
GEODATA_DIR="/etc/kanno/geodata"
RULES_DIR="/etc/kanno/rules"
MIHOMO_PID="/var/run/kanno-mihomo.pid"
SINGBOX_PID="/var/run/kanno-singbox.pid"
MIHOMO_API="http://127.0.0.1:9090"

log_info()  {
    echo "[INFO]  $*" >> "$KANNO_LOG"
    logger -t kanno -p daemon.info  "$*" 2>/dev/null
    printf '\033[0;32m[✓]\033[0m %s\n' "$*"
}
log_warn()  {
    echo "[WARN]  $*" >> "$KANNO_LOG"
    logger -t kanno -p daemon.warn  "$*" 2>/dev/null
    printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2
}
log_error() {
    echo "[ERROR] $*" >> "$KANNO_LOG"
    logger -t kanno -p daemon.err   "$*" 2>/dev/null
    printf '\033[0;31m[✗]\033[0m %s\n' "$*" >&2
}

kanno_gen_id() {
    head -c 4 /dev/urandom | hexdump -e '1/4 "%08x"'
}

uci_get() { uci -q get "kanno.$1" 2>/dev/null; }
uci_get_list() { uci -q get "kanno.$1" 2>/dev/null; }

mkdir -p "$KANNO_RUN" "$KANNO_DIR/mihomo" "$KANNO_DIR/singbox" \
         "$GEODATA_DIR" "$RULES_DIR"
