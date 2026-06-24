#!/bin/sh
# TomFly - One-click installer for ImmortalWrt / OpenWrt
# Usage: curl -fsSL https://raw.githubusercontent.com/wujiezero/TomFly/main/install.sh | sh
#        sh install.sh           # local run (interactive)
#        SKIP_KERNEL=1 sh ...   # skip kernel download
#        SKIP_GEO=1   sh ...    # skip geodata download
#
# Supports: ImmortalWrt 25.12.0+ (apk) and OpenWrt 22.03+ (opkg)

REPO="https://cdn.jsdelivr.net/gh/wujiezero/TomFly@main"
TOMFLY_VER="0.1.0"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { printf "${GREEN}[✓]${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}[!]${NC} %s\n" "$*"; }
error() { printf "${RED}[✗]${NC} %s\n" "$*" >&2; exit 1; }
step()  { printf "\n${CYAN}[→]${NC} %s\n" "$*"; }

# When piped from curl, stdin is the script itself — use /dev/tty for prompts
ask_yn() {
    local question="$1" default="${2:-Y}"
    # If stdin is not a tty (running in pipe), use /dev/tty; fall back to default
    if [ -t 0 ]; then
        printf "${YELLOW}[?]${NC} %s [%s/n]: " "$question" "$default" >&2
        read -r ans </dev/stdin
    else
        printf "${YELLOW}[?]${NC} %s → defaulting to %s (non-interactive mode)\n" "$question" "$default" >&2
        ans="$default"
    fi
    [ "${ans:-$default}" != "n" ] && [ "${ans:-$default}" != "N" ]
}

# ── Pre-flight checks ──────────────────────────────────────────────────────────
[ "$(id -u)" != "0" ] && error "Please run as root"
[ -f /etc/openwrt_release ] || error "This script only runs on OpenWrt/ImmortalWrt"
command -v uci  >/dev/null 2>&1 || error "uci not found — is this really OpenWrt?"
command -v curl >/dev/null 2>&1 || error "curl not found. Install it first: apk add curl"

. /etc/openwrt_release
step "Detected: ${DISTRIB_DESCRIPTION:-OpenWrt}"

ARCH=$(uname -m)
step "Architecture: $ARCH"

# ── Package manager detection ──────────────────────────────────────────────────
if   command -v apk  >/dev/null 2>&1; then
    PKG_MGR="apk"
    pkg_update()          { apk update -q 2>/dev/null; }
    pkg_installed()       { apk info -e "$1" >/dev/null 2>&1; }
    pkg_install()         { apk add -q "$@" 2>/dev/null; }
elif command -v opkg >/dev/null 2>&1; then
    PKG_MGR="opkg"
    pkg_update()          { opkg update -q 2>/dev/null; }
    pkg_installed()       { opkg list-installed 2>/dev/null | grep -q "^${1} "; }
    pkg_install()         { opkg install -q "$@" 2>/dev/null; }
else
    error "No supported package manager found (apk or opkg required)"
fi
info "Package manager: $PKG_MGR"

# ── Step 1: Install system dependencies ───────────────────────────────────────
step "Installing system dependencies..."
pkg_update || warn "Package index update failed, using cached lists"

# Package name map: some names differ between apk and opkg
install_pkg() {
    local pkg_generic="$1"
    local pkg_apk="${2:-$1}"    # apk name (if different)
    local pkg_opkg="${3:-$1}"   # opkg name (if different)

    local pkg
    [ "$PKG_MGR" = "apk" ] && pkg="$pkg_apk" || pkg="$pkg_opkg"

    if pkg_installed "$pkg"; then
        info "Already installed: $pkg"
    else
        if pkg_install "$pkg"; then
            info "Installed: $pkg"
        else
            warn "Could not install: $pkg (continuing — may already be built-in)"
        fi
    fi
}

#                  generic          apk-name            opkg-name
install_pkg curl
install_pkg jsonfilter
install_pkg nftables
install_pkg kmod-nft-tproxy
install_pkg kmod-tun            # TUN data-plane (optional TUN mode)
install_pkg ip-full             "ip-full"              "ip-full"
install_pkg ca-bundle           "ca-certificates"      "ca-bundle"
# rpcd-mod-file provides the `file` ubus object that the LuCI JS views use
# for fs.exec()/fs.read(); without it the native UI cannot reach the backend.
install_pkg rpcd-mod-file

# ── Step 2: Create directory structure ────────────────────────────────────────
step "Creating directories..."
# BusyBox ash does NOT support brace expansion — use one mkdir per path
mkdir -p /usr/lib/tomfly
mkdir -p /etc/tomfly/geodata
mkdir -p /etc/tomfly/rules
mkdir -p /etc/tomfly/mihomo
mkdir -p /etc/tomfly/singbox
mkdir -p /var/log
mkdir -p /var/run/tomfly
mkdir -p /www/luci-static/resources/tomfly
mkdir -p /www/luci-static/resources/view/tomfly
mkdir -p /usr/share/luci/menu.d
mkdir -p /usr/share/rpcd/acl.d
mkdir -p /etc/init.d
info "Directories ready"

# ── Step 3: Download helper ────────────────────────────────────────────────────
# Primary CDN: jsDelivr (clears cache on push)
# Fallback CDN: raw.githubusercontent.com (may have up to 5min cache lag)
REPO_FALLBACK="https://raw.githubusercontent.com/wujiezero/TomFly/main"

download() {
    local src="$1" dst="$2" mode="${3:-644}"
    local tmpfile="${dst}.tomfly_tmp"
    # Try primary CDN
    if curl -fsSL --max-time 60 -o "$tmpfile" "${REPO}/${src}" 2>/dev/null; then
        mv "$tmpfile" "$dst"
        chmod "$mode" "$dst"
        return 0
    fi
    # Retry with fallback CDN
    warn "Primary CDN failed for $src, trying fallback..."
    if curl -fsSL --max-time 60 -o "$tmpfile" "${REPO_FALLBACK}/${src}" 2>/dev/null; then
        mv "$tmpfile" "$dst"
        chmod "$mode" "$dst"
        return 0
    fi
    rm -f "$tmpfile"
    warn "Download failed: $src"
    return 1
}

# download_critical: same as download but aborts install on failure
download_critical() {
    download "$@" || error "Critical file download failed: $1 — check network and retry"
}

# ── Step 4: Download core scripts ─────────────────────────────────────────────
step "Downloading core scripts..."
CORE="packages/tomfly-core/root"

download_critical "$CORE/usr/lib/tomfly/common.sh"       /usr/lib/tomfly/common.sh       755
download_critical "$CORE/usr/lib/tomfly/capabilities.sh" /usr/lib/tomfly/capabilities.sh 755
download_critical "$CORE/usr/lib/tomfly/uri_parser.sh"   /usr/lib/tomfly/uri_parser.sh   755
download_critical "$CORE/usr/lib/tomfly/gen_mihomo.sh"  /usr/lib/tomfly/gen_mihomo.sh  755
download_critical "$CORE/usr/lib/tomfly/gen_singbox.sh" /usr/lib/tomfly/gen_singbox.sh 755
download_critical "$CORE/usr/lib/tomfly/nftables.sh"    /usr/lib/tomfly/nftables.sh    755
download_critical "$CORE/usr/lib/tomfly/dns.sh"         /usr/lib/tomfly/dns.sh         755
download_critical "$CORE/usr/lib/tomfly/traffic.sh"     /usr/lib/tomfly/traffic.sh     755
download_critical "$CORE/usr/lib/tomfly/updater.sh"     /usr/lib/tomfly/updater.sh     755
download_critical "$CORE/usr/bin/tomfly"                /usr/bin/tomfly                755
download_critical "$CORE/etc/init.d/tomfly"             /etc/init.d/tomfly             755

# Verify the main binary is actually executable
[ -x /usr/bin/tomfly ] || error "/usr/bin/tomfly was downloaded but is not executable"

# Rule files (skip if already customized)
[ -f /etc/tomfly/rules/force_proxy.txt ] || \
    download "packages/tomfly-geodata/root/etc/tomfly/rules/force_proxy.txt" \
             /etc/tomfly/rules/force_proxy.txt
[ -f /etc/tomfly/rules/force_direct.txt ] || \
    download "packages/tomfly-geodata/root/etc/tomfly/rules/force_direct.txt" \
             /etc/tomfly/rules/force_direct.txt

info "Core scripts installed"

# ── Step 5: Download Web UI (native LuCI JS views) ────────────────────────────
step "Downloading Web UI..."
RES="packages/luci-app-tomfly/htdocs/luci-static/resources"

# Shared backend client + stylesheet
download "$RES/tomfly/api.js"         /www/luci-static/resources/tomfly/api.js
download "$RES/tomfly/kernel-profile.js" /www/luci-static/resources/tomfly/kernel-profile.js
download "$RES/view/tomfly/style.css" /www/luci-static/resources/view/tomfly/style.css
download "$RES/view/tomfly/logo.png"  /www/luci-static/resources/view/tomfly/logo.png

# Tab views (rendered as native LuCI top tabs under Services → TomFly)
for v in overview nodes groups rules dns kernel log; do
    download "$RES/view/tomfly/$v.js" "/www/luci-static/resources/view/tomfly/$v.js"
done
info "Web UI installed"

# ── Step 6: LuCI menu integration ────────────────────────────────────────────
step "Installing LuCI integration..."
# LuCI menu entry (registers the TomFly tabs under Services)
download "packages/luci-app-tomfly/root/usr/share/luci/menu.d/luci-app-tomfly.json" \
    /usr/share/luci/menu.d/luci-app-tomfly.json
# rpcd ACL (grants the LuCI session the uci + fs.exec access the views need)
download "packages/luci-app-tomfly/root/usr/share/rpcd/acl.d/luci-app-tomfly.json" \
    /usr/share/rpcd/acl.d/luci-app-tomfly.json

# Remove leftovers from the old iframe/Alpine SPA and the dead Lua/CGI backend.
# ImmortalWrt 25.12 ships JS-only LuCI (no Lua), so the views now talk to the
# system directly via uci + fs.exec — no CGI required.
rm -rf /www/luci-static/tomfly 2>/dev/null
rm -f  /www/luci-static/resources/view/tomfly/main.js 2>/dev/null
rm -f  /www/cgi-bin/tomfly /usr/lib/lua/luci/rpc/tomfly.lua 2>/dev/null

# Drop LuCI's cached menu/module index so the new tabs appear immediately
rm -f /tmp/luci-indexcache /tmp/luci-indexcache.* 2>/dev/null
rm -rf /tmp/luci-modulecache 2>/dev/null

info "LuCI integration installed"

# ── Step 7: UCI default config ───────────────────────────────────────────────
step "Setting up UCI configuration..."
if ! uci -q get tomfly.global >/dev/null 2>&1; then
    download "packages/tomfly-core/root/etc/config/tomfly" /etc/config/tomfly
    info "Default config installed"
else
    info "Existing config preserved"
fi

# ── Step 8: Web UI access configuration ──────────────────────────────────────
step "Configuring web access..."

# Create a direct URL entry for uhttpd to serve our static SPA
# (Works even without LuCI installed)
if [ -f /etc/config/uhttpd ]; then
    # Check if there's an http_nterface 80 listening
    ROUTER_IP=$(uci -q get network.lan.ipaddr 2>/dev/null || echo "192.168.1.1")
    info "uhttpd is configured — UI is at http://${ROUTER_IP}/cgi-bin/luci/admin/services/tomfly"
else
    warn "uhttpd config not found, UI may need manual setup"
fi

# ── Step 9: Enable service ────────────────────────────────────────────────────
step "Enabling TomFly service..."
if [ -f /etc/rc.d/S99tomfly ] || /etc/init.d/tomfly enable 2>/dev/null; then
    info "Service enabled (auto-start on boot)"
else
    warn "Could not enable service via init.d — may need manual setup"
fi

# ── Step 10: Download mihomo kernel ──────────────────────────────────────────
if [ "${SKIP_KERNEL:-0}" = "1" ]; then
    warn "SKIP_KERNEL=1 — skipping kernel download"
elif ask_yn "Download mihomo kernel now? (~15MB, recommended)" "Y"; then
    step "Downloading mihomo kernel..."
    if /usr/bin/tomfly update mihomo; then
        info "mihomo kernel ready"
    else
        warn "Download failed — run later: tomfly update mihomo"
    fi
else
    warn "Skipped. Run later: tomfly update mihomo"
fi

# ── Step 11: Download GeoData ─────────────────────────────────────────────────
if [ "${SKIP_GEO:-0}" = "1" ]; then
    warn "SKIP_GEO=1 — skipping GeoData download"
elif ask_yn "Download GeoIP/GeoSite data? (~5MB)" "Y"; then
    step "Downloading GeoData..."
    if /usr/bin/tomfly update geodata; then
        info "GeoData ready"
    else
        warn "Download failed — run later: tomfly update geodata"
    fi
else
    warn "Skipped. Run later: tomfly update geodata"
fi

# ── Step 12: Reload web services ─────────────────────────────────────────────
step "Reloading services..."
/etc/init.d/rpcd   reload 2>/dev/null && info "rpcd reloaded"   || warn "rpcd reload skipped"
/etc/init.d/uhttpd reload 2>/dev/null && info "uhttpd reloaded" || warn "uhttpd reload skipped"

# ── Done ──────────────────────────────────────────────────────────────────────
ROUTER_IP=$(uci -q get network.lan.ipaddr 2>/dev/null || echo "192.168.1.1")

printf "\n${GREEN}╔══════════════════════════════════════╗${NC}\n"
printf "${GREEN}║  TomFly v%-6s  installed! ✓    ║${NC}\n" "$TOMFLY_VER"
printf "${GREEN}╚══════════════════════════════════════╝${NC}\n\n"
printf "  Web UI   → ${CYAN}http://${ROUTER_IP}/cgi-bin/luci/admin/services/tomfly${NC}\n"
printf "  CLI help → ${CYAN}tomfly${NC}\n\n"
printf "  Quick start:\n"
printf "    tomfly add 'vless://...'   # add a node\n"
printf "    tomfly start               # start proxy\n"
printf "    tomfly status              # check status\n"
printf "    tomfly update all          # update kernel + geodata\n\n"
printf "  If kernel/geodata were skipped, run:\n"
printf "    ${CYAN}tomfly update all${NC}\n\n"
