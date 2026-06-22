#!/bin/sh
# KannoProxy - One-click installer for ImmortalWrt / OpenWrt
# Usage: curl -fsSL https://raw.githubusercontent.com/wujiezero/kanno-proxy/main/install.sh | sh
#        sh install.sh           # local run (interactive)
#        SKIP_KERNEL=1 sh ...   # skip kernel download
#        SKIP_GEO=1   sh ...    # skip geodata download
#
# Supports: ImmortalWrt 25.12.0+ (apk) and OpenWrt 22.03+ (opkg)

REPO="https://cdn.jsdelivr.net/gh/wujiezero/kanno-proxy@main"
KANNO_VER="0.1.0"
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
install_pkg ip-full             "ip-full"              "ip-full"
install_pkg ca-bundle           "ca-certificates"      "ca-bundle"

# ── Step 2: Create directory structure ────────────────────────────────────────
step "Creating directories..."
# BusyBox ash does NOT support brace expansion — use one mkdir per path
mkdir -p /usr/lib/kanno
mkdir -p /etc/kanno/geodata
mkdir -p /etc/kanno/rules
mkdir -p /etc/kanno/mihomo
mkdir -p /etc/kanno/singbox
mkdir -p /var/log
mkdir -p /var/run/kanno
mkdir -p /www/luci-static/kanno
mkdir -p /www/luci-static/resources/view/kanno
mkdir -p /www/cgi-bin
mkdir -p /usr/lib/lua/luci/rpc
mkdir -p /usr/share/luci/menu.d
mkdir -p /usr/share/rpcd/acl.d
mkdir -p /etc/init.d
info "Directories ready"

# ── Step 3: Download helper ────────────────────────────────────────────────────
# Primary CDN: jsDelivr (clears cache on push)
# Fallback CDN: raw.githubusercontent.com (may have up to 5min cache lag)
REPO_FALLBACK="https://raw.githubusercontent.com/wujiezero/kanno-proxy/main"

download() {
    local src="$1" dst="$2" mode="${3:-644}"
    local tmpfile="${dst}.kanno_tmp"
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
CORE="packages/kanno-core/root"

download_critical "$CORE/usr/lib/kanno/common.sh"      /usr/lib/kanno/common.sh     755
download_critical "$CORE/usr/lib/kanno/uri_parser.sh"  /usr/lib/kanno/uri_parser.sh  755
download_critical "$CORE/usr/lib/kanno/gen_mihomo.sh"  /usr/lib/kanno/gen_mihomo.sh  755
download_critical "$CORE/usr/lib/kanno/gen_singbox.sh" /usr/lib/kanno/gen_singbox.sh 755
download_critical "$CORE/usr/lib/kanno/nftables.sh"    /usr/lib/kanno/nftables.sh    755
download_critical "$CORE/usr/lib/kanno/dns.sh"         /usr/lib/kanno/dns.sh         755
download_critical "$CORE/usr/lib/kanno/updater.sh"     /usr/lib/kanno/updater.sh     755
download_critical "$CORE/usr/bin/kanno"                /usr/bin/kanno                755
download_critical "$CORE/etc/init.d/kanno"             /etc/init.d/kanno             755

# Verify the main binary is actually executable
[ -x /usr/bin/kanno ] || error "/usr/bin/kanno was downloaded but is not executable"

# Rule files (skip if already customized)
[ -f /etc/kanno/rules/force_proxy.txt ] || \
    download "packages/kanno-geodata/root/etc/kanno/rules/force_proxy.txt" \
             /etc/kanno/rules/force_proxy.txt
[ -f /etc/kanno/rules/force_direct.txt ] || \
    download "packages/kanno-geodata/root/etc/kanno/rules/force_direct.txt" \
             /etc/kanno/rules/force_direct.txt

info "Core scripts installed"

# ── Step 5: Download Web UI ───────────────────────────────────────────────────
step "Downloading Web UI..."
UI="packages/luci-app-kanno/htdocs/luci-static/kanno"
download "$UI/index.html"    /www/luci-static/kanno/index.html
download "$UI/style.css"     /www/luci-static/kanno/style.css
download "$UI/app.js"        /www/luci-static/kanno/app.js

# Alpine.js is a third-party library (~44 KB); fetch from official CDN
# rather than bloating the repo with a binary blob.
ALPINE_DEST="/www/luci-static/kanno/alpine.min.js"
if [ ! -f "$ALPINE_DEST" ] || [ "$(wc -c < "$ALPINE_DEST")" -lt 10000 ]; then
    if curl -fsSL --max-time 60 \
        -o "$ALPINE_DEST" \
        "https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js" 2>/dev/null; then
        info "Alpine.js 3.14.1 downloaded"
    else
        warn "Alpine.js download failed — Web UI will not function without it"
    fi
else
    info "Alpine.js already present"
fi
info "Web UI installed"

# ── Step 6: LuCI menu integration ────────────────────────────────────────────
step "Installing LuCI integration..."
# Lua RPC handler (required by both CGI and potential rpcd use)
download "packages/luci-app-kanno/luasrc/rpc/kanno.lua" \
    /usr/lib/lua/luci/rpc/kanno.lua
# LuCI JS view — registers "KannoProxy" in Services menu (LuCI 26.x)
download "packages/luci-app-kanno/htdocs/luci-static/resources/view/kanno/main.js" \
    /www/luci-static/resources/view/kanno/main.js
# CGI backend — serves /cgi-bin/kanno for the SPA's JSON-RPC calls
download "packages/luci-app-kanno/root/www/cgi-bin/kanno" \
    /www/cgi-bin/kanno 755
# LuCI menu entry
download "packages/luci-app-kanno/root/usr/share/luci/menu.d/luci-app-kanno.json" \
    /usr/share/luci/menu.d/luci-app-kanno.json
# rpcd ACL (allows LuCI session to call kanno ubus methods if rpcd is used)
download "packages/luci-app-kanno/root/usr/share/rpcd/acl.d/luci-app-kanno.json" \
    /usr/share/rpcd/acl.d/luci-app-kanno.json
info "LuCI integration installed"

# ── Step 7: UCI default config ───────────────────────────────────────────────
step "Setting up UCI configuration..."
if ! uci -q get kanno.global >/dev/null 2>&1; then
    download "packages/kanno-core/root/etc/config/kanno" /etc/config/kanno
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
    info "uhttpd is configured — UI will be at http://${ROUTER_IP}/luci-static/kanno/"
else
    warn "uhttpd config not found, UI may need manual setup"
fi

# ── Step 9: Enable service ────────────────────────────────────────────────────
step "Enabling KannoProxy service..."
if [ -f /etc/rc.d/S99kanno ] || /etc/init.d/kanno enable 2>/dev/null; then
    info "Service enabled (auto-start on boot)"
else
    warn "Could not enable service via init.d — may need manual setup"
fi

# ── Step 10: Download mihomo kernel ──────────────────────────────────────────
if [ "${SKIP_KERNEL:-0}" = "1" ]; then
    warn "SKIP_KERNEL=1 — skipping kernel download"
elif ask_yn "Download mihomo kernel now? (~15MB, recommended)" "Y"; then
    step "Downloading mihomo kernel..."
    if /usr/bin/kanno update mihomo; then
        info "mihomo kernel ready"
    else
        warn "Download failed — run later: kanno update mihomo"
    fi
else
    warn "Skipped. Run later: kanno update mihomo"
fi

# ── Step 11: Download GeoData ─────────────────────────────────────────────────
if [ "${SKIP_GEO:-0}" = "1" ]; then
    warn "SKIP_GEO=1 — skipping GeoData download"
elif ask_yn "Download GeoIP/GeoSite data? (~5MB)" "Y"; then
    step "Downloading GeoData..."
    if /usr/bin/kanno update geodata; then
        info "GeoData ready"
    else
        warn "Download failed — run later: kanno update geodata"
    fi
else
    warn "Skipped. Run later: kanno update geodata"
fi

# ── Step 12: Reload web services ─────────────────────────────────────────────
step "Reloading services..."
/etc/init.d/rpcd   reload 2>/dev/null && info "rpcd reloaded"   || warn "rpcd reload skipped"
/etc/init.d/uhttpd reload 2>/dev/null && info "uhttpd reloaded" || warn "uhttpd reload skipped"

# ── Done ──────────────────────────────────────────────────────────────────────
ROUTER_IP=$(uci -q get network.lan.ipaddr 2>/dev/null || echo "192.168.1.1")

printf "\n${GREEN}╔══════════════════════════════════════╗${NC}\n"
printf "${GREEN}║  KannoProxy v%-6s  installed! ✓    ║${NC}\n" "$KANNO_VER"
printf "${GREEN}╚══════════════════════════════════════╝${NC}\n\n"
printf "  Web UI   → ${CYAN}http://${ROUTER_IP}/luci-static/kanno/${NC}\n"
printf "  CLI help → ${CYAN}kanno${NC}\n\n"
printf "  Quick start:\n"
printf "    kanno add 'vless://...'   # add a node\n"
printf "    kanno start               # start proxy\n"
printf "    kanno status              # check status\n"
printf "    kanno update all          # update kernel + geodata\n\n"
printf "  If kernel/geodata were skipped, run:\n"
printf "    ${CYAN}kanno update all${NC}\n\n"
