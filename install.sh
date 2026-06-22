#!/bin/sh
# KannoProxy - One-click installer for ImmortalWrt / OpenWrt
# Usage: curl -fsSL https://raw.githubusercontent.com/wujiezero/kanno-proxy/main/install.sh | sh
#
# Requires: curl, opkg, OpenWrt 22.03+ / ImmortalWrt 23.05+

set -e

REPO="https://raw.githubusercontent.com/wujiezero/kanno-proxy/main"
KANNO_VER="0.1.0"
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { printf "${GREEN}[✓]${NC} %s\n" "$*"; }
warn()  { printf "${YELLOW}[!]${NC} %s\n" "$*"; }
error() { printf "${RED}[✗]${NC} %s\n" "$*"; exit 1; }
step()  { printf "${CYAN}[→]${NC} %s\n" "$*"; }

# Check root
[ "$(id -u)" != "0" ] && error "Please run as root"

# Check OpenWrt
[ -f /etc/openwrt_release ] || error "This script only runs on OpenWrt/ImmortalWrt"

. /etc/openwrt_release
step "Detected: ${DISTRIB_DESCRIPTION:-OpenWrt}"

ARCH=$(uname -m)
step "Architecture: $ARCH"

# Check minimum requirements
for cmd in curl opkg uci; do
  command -v "$cmd" >/dev/null 2>&1 || error "Required command not found: $cmd"
done

# ── Step 1: Install system dependencies ──
step "Installing system dependencies..."
opkg update -q 2>/dev/null || warn "opkg update failed, continuing with cached lists"

PKGS="curl jsonfilter nftables kmod-nft-tproxy ip-full ca-bundle"
for pkg in $PKGS; do
    if ! opkg list-installed | grep -q "^${pkg} "; then
        opkg install "$pkg" -q 2>/dev/null && info "Installed: $pkg" || warn "Failed to install: $pkg (may already be available)"
    else
        info "Already installed: $pkg"
    fi
done

# ── Step 2: Create directory structure ──
step "Creating directories..."
mkdir -p /usr/lib/kanno /etc/kanno/geodata /etc/kanno/rules \
         /etc/kanno/mihomo /etc/kanno/singbox /var/log /var/run/kanno \
         /www/luci-static/kanno /usr/lib/lua/luci/rpc \
         /usr/share/luci/menu.d /usr/share/rpcd/acl.d

# ── Step 3: Download core scripts ──
step "Downloading KannoProxy core scripts..."

BASE="${REPO}/packages/kanno-core/root"

download() {
    local src="$1" dst="$2" mode="${3:-644}"
    if curl -fsSL --max-time 30 -o "$dst" "${REPO}/${src}"; then
        chmod "$mode" "$dst"
        info "Downloaded: $dst"
    else
        error "Failed to download: $src"
    fi
}

# Core lib scripts
download "packages/kanno-core/root/usr/lib/kanno/common.sh"     /usr/lib/kanno/common.sh     755
download "packages/kanno-core/root/usr/lib/kanno/uri_parser.sh"  /usr/lib/kanno/uri_parser.sh  755
download "packages/kanno-core/root/usr/lib/kanno/gen_mihomo.sh"  /usr/lib/kanno/gen_mihomo.sh  755
download "packages/kanno-core/root/usr/lib/kanno/gen_singbox.sh" /usr/lib/kanno/gen_singbox.sh 755
download "packages/kanno-core/root/usr/lib/kanno/nftables.sh"    /usr/lib/kanno/nftables.sh    755
download "packages/kanno-core/root/usr/lib/kanno/dns.sh"         /usr/lib/kanno/dns.sh         755
download "packages/kanno-core/root/usr/lib/kanno/updater.sh"     /usr/lib/kanno/updater.sh     755

# Main binary
download "packages/kanno-core/root/usr/bin/kanno" /usr/bin/kanno 755

# Init script
download "packages/kanno-core/root/etc/init.d/kanno" /etc/init.d/kanno 755

# Default rule files (only if not already present)
[ -f /etc/kanno/rules/force_proxy.txt ] || \
    download "packages/kanno-geodata/root/etc/kanno/rules/force_proxy.txt"  /etc/kanno/rules/force_proxy.txt
[ -f /etc/kanno/rules/force_direct.txt ] || \
    download "packages/kanno-geodata/root/etc/kanno/rules/force_direct.txt" /etc/kanno/rules/force_direct.txt

# ── Step 4: Download Web UI ──
step "Downloading Web UI..."

download "packages/luci-app-kanno/htdocs/luci-static/kanno/index.html"   /www/luci-static/kanno/index.html
download "packages/luci-app-kanno/htdocs/luci-static/kanno/style.css"    /www/luci-static/kanno/style.css
download "packages/luci-app-kanno/htdocs/luci-static/kanno/app.js"       /www/luci-static/kanno/app.js
download "packages/luci-app-kanno/htdocs/luci-static/kanno/alpine.min.js" /www/luci-static/kanno/alpine.min.js

# ── Step 5: Download LuCI backend ──
step "Installing LuCI rpcd backend..."
download "packages/luci-app-kanno/luasrc/rpc/kanno.lua"                        /usr/lib/lua/luci/rpc/kanno.lua
download "packages/luci-app-kanno/root/usr/share/luci/menu.d/luci-app-kanno.json" /usr/share/luci/menu.d/luci-app-kanno.json
download "packages/luci-app-kanno/root/usr/share/rpcd/acl.d/luci-app-kanno.json"  /usr/share/rpcd/acl.d/luci-app-kanno.json

# ── Step 6: UCI default config ──
step "Setting up UCI configuration..."
if ! uci -q get kanno.global >/dev/null 2>&1; then
    download "packages/kanno-core/root/etc/config/kanno" /etc/config/kanno
    info "Default config installed"
else
    info "UCI config already exists, skipping"
fi

# ── Step 7: Add LuCI route for Kanno UI ──
step "Configuring uhttpd to serve Kanno UI..."

# Add alias so /cgi-bin/luci/admin/services/kanno → our SPA
if ! grep -q "kanno" /etc/config/uhttpd 2>/dev/null; then
    uci set uhttpd.main.lua_handler='/usr/share/kanno-luci.lua' 2>/dev/null || true
fi

# Create a simple redirect shim so LuCI menu → our SPA
mkdir -p /www/cgi-bin
cat > /www/cgi-bin/kanno-redirect.sh <<'EOF'
#!/bin/sh
echo "Location: /luci-static/kanno/index.html"
echo "Content-Type: text/html"
echo ""
EOF
chmod +x /www/cgi-bin/kanno-redirect.sh

# Add uhttpd alias if supported
uci -q set uhttpd.main.alias="/admin/services/kanno=/luci-static/kanno/index.html" 2>/dev/null || true

# ── Step 8: Enable and start service ──
step "Enabling KannoProxy service..."
/etc/init.d/kanno enable
info "Service enabled (will start on boot)"

# ── Step 9: Download kernel (mihomo) ──
printf "${YELLOW}"
read -r -p "[?] Download mihomo kernel now? (recommended, ~15MB) [Y/n]: " yn
printf "${NC}"
yn="${yn:-Y}"
if [ "$yn" = "Y" ] || [ "$yn" = "y" ]; then
    step "Downloading mihomo kernel (this may take a few minutes)..."
    if kanno update mihomo; then
        info "mihomo kernel installed"
    else
        warn "mihomo download failed. Run manually later: kanno update mihomo"
    fi
fi

# ── Step 10: Download GeoData ──
printf "${YELLOW}"
read -r -p "[?] Download GeoIP/GeoSite data? (~5MB) [Y/n]: " yn2
printf "${NC}"
yn2="${yn2:-Y}"
if [ "$yn2" = "Y" ] || [ "$yn2" = "y" ]; then
    step "Downloading geodata..."
    if kanno update geodata; then
        info "GeoData installed"
    else
        warn "GeoData download failed. Run manually: kanno update geodata"
    fi
fi

# ── Step 11: Reload services ──
step "Reloading uhttpd and rpcd..."
/etc/init.d/rpcd reload 2>/dev/null || true
/etc/init.d/uhttpd reload 2>/dev/null || true

# ── Done ──
ROUTER_IP=$(uci -q get network.lan.ipaddr 2>/dev/null || echo "192.168.1.1")

printf "\n${GREEN}╔══════════════════════════════════════════════╗${NC}\n"
printf "${GREEN}║     KannoProxy v${KANNO_VER} installed successfully!   ║${NC}\n"
printf "${GREEN}╚══════════════════════════════════════════════╝${NC}\n\n"
printf "  Web UI:   ${CYAN}http://${ROUTER_IP}/luci-static/kanno/${NC}\n"
printf "  Command:  ${CYAN}kanno --help${NC}\n\n"
printf "  Next steps:\n"
printf "    1. Open the Web UI and add a proxy node\n"
printf "    2. Configure routing rules if needed\n"
printf "    3. Click 'Start' in the UI or run: ${CYAN}kanno start${NC}\n\n"
printf "  Useful commands:\n"
printf "    kanno add 'vless://...'   # Add a node\n"
printf "    kanno list                # List nodes\n"
printf "    kanno status              # Check status\n"
printf "    kanno update all          # Update kernel + geodata\n\n"
