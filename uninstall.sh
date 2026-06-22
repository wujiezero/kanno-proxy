#!/bin/sh
# KannoProxy - Uninstaller for ImmortalWrt / OpenWrt
# Usage: curl -fsSL https://raw.githubusercontent.com/wujiezero/kanno-proxy/main/uninstall.sh | sh
#        sh uninstall.sh           # local run (interactive)
#        PURGE=1 sh uninstall.sh   # also delete saved nodes, kernels, geodata, logs
#        KEEP=1  sh uninstall.sh   # force-keep all user data (no prompt)
#
# Always removed: program files, LuCI UI, rpcd ACL, init.d service, and every
# runtime change (nftables table, policy routing, dnsmasq DNS redirect).
# User data (config/nodes, kernels, geodata, logs) is KEPT unless you purge.

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { printf "${GREEN}[✓]${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}[!]${NC} %s\n" "$*"; }
error() { printf "${RED}[✗]${NC} %s\n" "$*" >&2; exit 1; }
step()  { printf "\n${CYAN}[→]${NC} %s\n" "$*"; }

# When piped from curl, stdin is the script itself — prompt on /dev/tty.
ask_yn() {
    local question="$1" default="${2:-N}" ans
    if [ -t 0 ]; then
        printf "${YELLOW}[?]${NC} %s [y/%s]: " "$question" "$default" >&2
        read -r ans </dev/tty 2>/dev/null || ans="$default"
    else
        ans="$default"
    fi
    ans="${ans:-$default}"
    [ "$ans" = "y" ] || [ "$ans" = "Y" ]
}

# ── Pre-flight ─────────────────────────────────────────────────────────────────
[ "$(id -u)" != "0" ] && error "Please run as root"
[ -f /etc/openwrt_release ] || error "This script only runs on OpenWrt/ImmortalWrt"

step "KannoProxy uninstaller"

# Decide whether to purge user data
PURGE_DATA=0
if [ "${PURGE:-0}" = "1" ]; then
    PURGE_DATA=1
elif [ "${KEEP:-0}" = "1" ]; then
    PURGE_DATA=0
elif ask_yn "Also delete saved nodes, kernels, geodata and logs? (config is kept otherwise)" "N"; then
    PURGE_DATA=1
fi

# ── Step 1: Stop the service (reverts nftables, routing, DNS, kills kernel) ────
step "Stopping KannoProxy..."
if [ -x /usr/bin/kanno ]; then
    /usr/bin/kanno stop 2>/dev/null && info "Service stopped (firewall/routing/DNS reverted)" \
        || warn "kanno stop reported an error — continuing cleanup"
else
    warn "/usr/bin/kanno missing — cleaning up runtime state manually"
fi

# Kill any kernel left running and drop the nftables table / policy routing,
# in case `kanno stop` was unavailable or incomplete.
killall mihomo sing-box 2>/dev/null
sleep 1
killall -9 mihomo sing-box 2>/dev/null
nft delete table inet kanno 2>/dev/null && info "nftables table removed"
# TUN data-plane leftovers (auto-redirect tables + virtual interfaces)
nft delete table inet mihomo 2>/dev/null
nft delete table inet sing-box 2>/dev/null
ip link del Meta 2>/dev/null
ip link del Kanno 2>/dev/null
ip rule del fwmark 0x200 table 100 2>/dev/null
ip route del local default dev lo table 100 2>/dev/null

# ── Step 2: Revert dnsmasq DNS redirect (CRITICAL) ────────────────────────────
# setup_dns() points dnsmasq at mihomo (127.0.0.1#1053) with noresolv. If we
# remove kanno without reverting this, the router loses all DNS resolution.
step "Restoring dnsmasq DNS..."
rm -f /tmp/dnsmasq.d/kanno.conf 2>/dev/null
if uci -q get dhcp.@dnsmasq[0] >/dev/null 2>&1; then
    uci -q del_list dhcp.@dnsmasq[0].server='127.0.0.1#1053' 2>/dev/null
    uci -q delete dhcp.@dnsmasq[0].noresolv 2>/dev/null
    uci commit dhcp 2>/dev/null
    /etc/init.d/dnsmasq restart >/dev/null 2>&1 && info "dnsmasq restored to defaults" \
        || warn "dnsmasq restart failed — check DNS manually"
fi

# ── Step 3: Disable + remove the init.d service ───────────────────────────────
step "Removing service..."
if [ -x /etc/init.d/kanno ]; then
    /etc/init.d/kanno disable 2>/dev/null
fi
rm -f /etc/init.d/kanno /etc/rc.d/S99kanno /etc/rc.d/K10kanno 2>/dev/null
info "Service removed"

# ── Step 4: Remove program files + Web UI (always) ────────────────────────────
step "Removing program files and Web UI..."
rm -f  /usr/bin/kanno
rm -rf /usr/lib/kanno
rm -rf /www/luci-static/resources/kanno
rm -rf /www/luci-static/resources/view/kanno
rm -f  /usr/share/luci/menu.d/luci-app-kanno.json
rm -f  /usr/share/rpcd/acl.d/luci-app-kanno.json
# Legacy artifacts from older layouts
rm -rf /www/luci-static/kanno 2>/dev/null
rm -f  /www/cgi-bin/kanno /usr/lib/lua/luci/rpc/kanno.lua 2>/dev/null
info "Program files removed"

# ── Step 5: Runtime / temp state ──────────────────────────────────────────────
rm -rf /var/run/kanno /var/run/kanno-mihomo.pid /var/run/kanno-singbox.pid 2>/dev/null
rm -f  /tmp/kanno.lock /tmp/kanno-*.log /tmp/kanno-*.yaml /tmp/kanno-*.json 2>/dev/null
rm -f  /tmp/kanno_usable.tmp /tmp/kanno_proxy_names.tmp 2>/dev/null

# Drop LuCI's cached menu/module index so the tab disappears immediately
rm -f  /tmp/luci-indexcache /tmp/luci-indexcache.* 2>/dev/null
rm -rf /tmp/luci-modulecache 2>/dev/null

# ── Step 6: User data (optional) ──────────────────────────────────────────────
if [ "$PURGE_DATA" = "1" ]; then
    step "Purging user data..."
    rm -f  /etc/config/kanno
    rm -rf /etc/kanno
    rm -f  /usr/bin/mihomo /usr/bin/sing-box
    rm -f  /var/log/kanno.log
    info "Removed config, nodes, kernels, geodata and logs"
else
    step "Keeping user data"
    info "Kept: /etc/config/kanno (nodes), /etc/kanno (geodata/rules), kernels, logs"
    info "Reinstalling later will reuse them. To wipe now: PURGE=1 sh uninstall.sh"
fi

# ── Step 7: Reload web services ───────────────────────────────────────────────
step "Reloading services..."
/etc/init.d/rpcd   reload 2>/dev/null && info "rpcd reloaded"   || warn "rpcd reload skipped"
/etc/init.d/uhttpd reload 2>/dev/null && info "uhttpd reloaded" || warn "uhttpd reload skipped"

# ── Done ──────────────────────────────────────────────────────────────────────
printf "\n${GREEN}╔══════════════════════════════════════╗${NC}\n"
printf "${GREEN}║  KannoProxy uninstalled ✓            ║${NC}\n"
printf "${GREEN}╚══════════════════════════════════════╝${NC}\n\n"
printf "  System packages (curl, nftables, ip-full…) were left installed.\n"
printf "  If the LuCI tab still shows, hard-refresh your browser (Ctrl+Shift+R).\n\n"
