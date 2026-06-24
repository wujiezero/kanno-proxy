#!/bin/sh
# TomFly - kernel & geodata updater

. /usr/lib/tomfly/common.sh

GITHUB_API="https://api.github.com"
MIHOMO_REPO="MetaCubeX/mihomo"
SINGBOX_REPO="SagerNet/sing-box"
GEODATA_REPO="Loyalsoldier/v2ray-rules-dat"

# Print progress to both terminal and log
progress() { printf '\033[0;36m[→]\033[0m %s\n' "$*"; echo "[STEP]  $*" >> "$TOMFLY_LOG"; }

# Map the running target to the release asset arch token shared by BOTH
# mihomo (mihomo-<arch>-vX.gz) and sing-box (sing-box-X-<arch>.tar.gz).
# Prefer OpenWrt's precise DISTRIB_ARCH (e.g. arm_cortex-a7_neon-vfpv4,
# mipsel_24kc); fall back to uname -m for non-OpenWrt hosts.
detect_arch() {
    local da
    da=$(. /etc/openwrt_release 2>/dev/null; echo "$DISTRIB_ARCH")
    case "$da" in
        x86_64)                  echo "linux-amd64";            return ;;
        i386*|i486*|i586*|i686*) echo "linux-386";              return ;;
        aarch64*)                echo "linux-arm64";            return ;;
        # ARM with a hardware FPU (neon/vfp, all Cortex-A) → armv7; older → armv5
        arm_*neon*|arm_*vfp*|arm_cortex-a*) echo "linux-armv7"; return ;;
        arm_*)                   echo "linux-armv5";            return ;;
        mipsel_*)                echo "linux-mipsle-softfloat"; return ;;
        mips_*)                  echo "linux-mips-softfloat";   return ;;
        mips64el_*)              echo "linux-mips64le";         return ;;
        mips64_*)                echo "linux-mips64";           return ;;
    esac
    case "$(uname -m)" in
        aarch64|arm64)  echo "linux-arm64" ;;
        armv7*)         echo "linux-armv7" ;;
        armv6*)         echo "linux-armv6" ;;
        armv5*)         echo "linux-armv5" ;;
        x86_64|amd64)   echo "linux-amd64" ;;
        i?86)           echo "linux-386" ;;
        mips64el)       echo "linux-mips64le" ;;
        mips64)         echo "linux-mips64" ;;
        mipsel|mipsle)  echo "linux-mipsle-softfloat" ;;
        mips)           echo "linux-mips-softfloat" ;;
        *)              echo "linux-amd64" ;;
    esac
}

detect_libc() {
    if ls /lib/ld-musl-* >/dev/null 2>&1; then
        echo "musl"
    else
        echo "glibc"
    fi
}

detect_openwrt_arch() {
    local arch
    arch=$(. /etc/os-release 2>/dev/null; echo "$OPENWRT_ARCH")
    [ -n "$arch" ] && { echo "$arch"; return; }
    arch=$(. /etc/openwrt_release 2>/dev/null; echo "$DISTRIB_ARCH")
    [ -n "$arch" ] && echo "$arch"
}

get_latest_release() {
    local repo="$1"
    local tag
    tag=$(curl -fsSL --max-time 15 \
        "${GITHUB_API}/repos/${repo}/releases/latest" 2>/dev/null | \
        jsonfilter -e '@.tag_name' 2>/dev/null)
    if [ -z "$tag" ]; then
        log_warn "GitHub API rate-limited or unreachable for $repo, retrying without auth..."
        tag=$(curl -fsSL --max-time 15 \
            "https://api.github.com/repos/${repo}/releases/latest" \
            -H "Accept: application/vnd.github.v3+json" 2>/dev/null | \
            jsonfilter -e '@.tag_name' 2>/dev/null)
    fi
    echo "$tag"
}

get_download_url() {
    local repo="$1" tag="$2" pattern="$3"
    curl -fsSL --max-time 15 \
        "${GITHUB_API}/repos/${repo}/releases/tags/${tag}" 2>/dev/null | \
        jsonfilter -e '@.assets[*].browser_download_url' 2>/dev/null | \
        grep -m1 "$pattern"
}

# Fetch a GitHub release asset to a file, trying fast mainland-China mirrors
# before the canonical github.com URL. Release binaries (kernels) have no CDN
# fallback of their own, and github.com is frequently blocked/throttled on CN
# networks, so api.github.com can resolve the asset URL while the download then
# times out. ghfast.top is fastest in testing; gh-proxy.com is a backup; direct
# github.com is last so it still wins where reachable (e.g. abroad).
_curl_github_to() {
    local url="$1" out="$2" m
    for m in \
        "https://ghfast.top/${url}" \
        "${url}" \
        "https://gh-proxy.com/${url}"
    do
        if curl -fL --connect-timeout 10 --speed-limit 5120 --speed-time 20 \
            --max-time 300 --progress-bar -o "$out" "$m" 2>&1; then
            return 0
        fi
    done
    return 1
}

download_and_verify() {
    local url="$1" dest="$2" mirror="${3:-0}"
    local fname
    fname=$(basename "$url")
    local tmpfile="/tmp/tomfly-dl-${fname}"
    local size

    progress "Downloading: $fname"
    if [ "$mirror" = "1" ]; then
        # Kernel binaries: try CN mirrors first (no other fallback exists).
        if ! _curl_github_to "$url" "$tmpfile"; then
            log_error "download failed: $url"
            rm -f "$tmpfile"
            return 1
        fi
    # Other assets (e.g. geodata) keep their own CDN fallback at the caller.
    # --connect-timeout fails fast when github.com is unreachable; --speed-time
    # also bails (~20s) when it connects but then stalls mid-transfer, instead
    # of hanging for the full --max-time before the fallback kicks in.
    elif ! curl -fL --connect-timeout 10 --speed-limit 5120 --speed-time 20 \
        --max-time 180 --progress-bar -o "$tmpfile" "$url" 2>&1; then
        log_error "download failed: $url"
        rm -f "$tmpfile"
        return 1
    fi

    size=$(wc -c < "$tmpfile" 2>/dev/null || echo 0)
    if [ "$size" -lt 1024 ]; then
        log_error "downloaded file too small (${size} bytes), likely an error page"
        rm -f "$tmpfile"
        return 1
    fi

    # NOTE: *.tar.gz must come before *.gz — shell case matches first pattern
    case "$url" in
    *.tar.gz)
        local tmpdir="/tmp/tomfly-extract-$$"
        mkdir -p "$tmpdir"
        progress "Extracting tar.gz..."
        if ! tar -xzf "$tmpfile" -C "$tmpdir" 2>&1; then
            log_error "tar extraction failed"
            rm -rf "$tmpfile" "$tmpdir"
            return 1
        fi
        local extracted
        extracted=$(find "$tmpdir" -type f -not -name '*.sha256' | head -1)
        if [ -n "$extracted" ]; then
            mv "$extracted" "$dest"
        else
            log_error "no binary found in archive"
            rm -rf "$tmpfile" "$tmpdir"
            return 1
        fi
        rm -rf "$tmpfile" "$tmpdir"
        ;;
    *.gz)
        local ungz="/tmp/tomfly-ungz-$$"
        progress "Decompressing ${size} bytes..."
        if ! gzip -d -c "$tmpfile" > "$ungz"; then
            log_error "gzip decompression failed (disk full? run: df -h /tmp)"
            rm -f "$tmpfile" "$ungz"
            return 1
        fi
        mv "$ungz" "$dest"
        rm -f "$tmpfile"
        ;;
    *.zip)
        local tmpdir="/tmp/tomfly-extract-$$"
        mkdir -p "$tmpdir"
        progress "Extracting zip..."
        if ! unzip -o "$tmpfile" -d "$tmpdir" >/dev/null 2>&1; then
            log_error "unzip failed"
            rm -rf "$tmpfile" "$tmpdir"
            return 1
        fi
        find "$tmpdir" -type f -not -name '*.sha256' | head -1 | xargs -I{} mv {} "$dest"
        rm -rf "$tmpfile" "$tmpdir"
        ;;
    *)
        mv "$tmpfile" "$dest"
        ;;
    esac

    case "$dest" in
    /usr/bin/*) chmod +x "$dest" ;;
    esac
    local final_size
    final_size=$(wc -c < "$dest" 2>/dev/null || echo 0)
    log_info "installed: $dest ($(( final_size / 1024 )) KB)"
    return 0
}

update_mihomo() {
    local arch
    arch=$(detect_arch)
    progress "Checking latest mihomo release... (arch: $arch)"

    local tag
    tag=$(get_latest_release "$MIHOMO_REPO")
    if [ -z "$tag" ]; then
        log_error "Cannot fetch mihomo version from GitHub API"
        log_warn "Hint: GitHub API has 60 req/h rate limit for unauthenticated requests"
        return 1
    fi
    progress "Latest mihomo: $tag"

    # Prefer stable release assets; fall back to alpha
    local url
    url=$(get_download_url "$MIHOMO_REPO" "$tag" "mihomo-${arch}-" | grep -v 'alpha\|beta' | head -1)
    [ -z "$url" ] && url=$(get_download_url "$MIHOMO_REPO" "$tag" "mihomo-${arch}-" | head -1)

    if [ -z "$url" ]; then
        log_error "No mihomo binary found for arch: $arch (tag: $tag)"
        log_warn "Available assets:"
        get_download_url "$MIHOMO_REPO" "$tag" "mihomo-" | head -5 >&2
        return 1
    fi

    download_and_verify "$url" "$MIHOMO_BIN" 1 || return 1
    echo "$tag" > "${TOMFLY_DIR}/mihomo.version"
    log_info "mihomo updated to $tag"
}

update_singbox() {
    local arch
    arch=$(detect_arch)
    progress "Checking latest sing-box release... (arch: $arch)"

    local tag
    tag=$(get_latest_release "$SINGBOX_REPO")
    if [ -z "$tag" ]; then
        log_error "Cannot fetch sing-box version from GitHub API"
        return 1
    fi
    progress "Latest sing-box: $tag"

    local ver="${tag#v}" openwrt_arch pkg_suffix pkg_url pkg_file
    openwrt_arch=$(detect_openwrt_arch)
    if [ -n "$openwrt_arch" ]; then
        if command -v apk >/dev/null 2>&1; then
            pkg_suffix="apk"
        elif command -v opkg >/dev/null 2>&1; then
            pkg_suffix="ipk"
        fi
        if [ -n "$pkg_suffix" ]; then
            pkg_url=$(get_download_url "$SINGBOX_REPO" "$tag" "sing-box_${ver}_openwrt_${openwrt_arch}\\.${pkg_suffix}" | head -1)
            if [ -n "$pkg_url" ]; then
                pkg_file="/tmp/$(basename "$pkg_url")"
                progress "Selected OpenWrt package: $(basename "$pkg_url")"
                if _curl_github_to "$pkg_url" "$pkg_file"; then
                    if [ "$pkg_suffix" = "apk" ]; then
                        apk add --allow-untrusted "$pkg_file" || log_warn "apk install failed, falling back to tarball"
                    else
                        opkg install "$pkg_file" || log_warn "opkg install failed, falling back to tarball"
                    fi
                    rm -f "$pkg_file"
                    if "$SINGBOX_BIN" version >/dev/null 2>&1; then
                        echo "$tag" > "${TOMFLY_DIR}/singbox.version"
                        log_info "sing-box updated to $tag"
                        return 0
                    fi
                else
                    log_warn "OpenWrt package download failed, falling back to tarball"
                    rm -f "$pkg_file"
                fi
            fi
        fi
    fi

    local url libc
    libc=$(detect_libc)
    if [ "$libc" = "musl" ]; then
        url=$(get_download_url "$SINGBOX_REPO" "$tag" "${arch}-musl\\.tar\\.gz" | head -1)
    else
        url=$(get_download_url "$SINGBOX_REPO" "$tag" "${arch}-glibc\\.tar\\.gz" | head -1)
    fi
    [ -z "$url" ] && url=$(get_download_url "$SINGBOX_REPO" "$tag" "sing-box-.*-${arch}\\.tar\\.gz" | grep -v -e '-glibc' -e '-musl' | head -1)
    if [ -z "$url" ]; then
        log_error "No sing-box binary found for arch: $arch (tag: $tag)"
        return 1
    fi
    progress "Selected: $(basename "$url")"

    local tmpfile="/tmp/tomfly-singbox-${tag}.tar.gz"
    progress "Downloading: $(basename "$url")"
    if ! _curl_github_to "$url" "$tmpfile"; then
        log_error "sing-box download failed"
        rm -f "$tmpfile"
        return 1
    fi

    local tmpdir="/tmp/tomfly-singbox-extract"
    mkdir -p "$tmpdir"
    progress "Extracting..."
    tar -xzf "$tmpfile" -C "$tmpdir" 2>/dev/null
    local extracted
    extracted=$(find "$tmpdir" -type f -name 'sing-box' | head -1)
    [ -z "$extracted" ] && extracted=$(find "$tmpdir" -type f ! -name '*.sha256' ! -name 'LICENSE' ! -name '*.md' | head -1)
    if [ -z "$extracted" ]; then
        log_error "sing-box binary not found in archive"
        rm -rf "$tmpfile" "$tmpdir"
        return 1
    fi
    if ! mv "$extracted" "$SINGBOX_BIN"; then
        log_error "mv to $SINGBOX_BIN failed (overlay full? run: df -h /)"
        rm -rf "$tmpfile" "$tmpdir"
        return 1
    fi
    chmod +x "$SINGBOX_BIN"
    if ! "$SINGBOX_BIN" version >/dev/null 2>&1; then
        log_error "sing-box binary not executable on this platform"
        rm -f "$SINGBOX_BIN"
        rm -rf "$tmpfile" "$tmpdir"
        return 1
    fi
    echo "$tag" > "${TOMFLY_DIR}/singbox.version"
    log_info "sing-box updated to $tag"
    rm -rf "$tmpfile" "$tmpdir"
}

_geodata_stamp() {
    date '+%Y-%m-%d' > "${GEODATA_DIR}/version"
}

update_geodata_mihomo() {
    local ok=0 f

    progress "Downloading mihomo GeoData (geoip.dat + geosite.dat)..."
    for f in geoip.dat geosite.dat; do
        # jsDelivr first: fastest + reliable on CN networks. The github.com
        # release asset is canonical but often blocked/throttled (it can even
        # connect then stall mid-transfer), so it is the fallback.
        if download_and_verify \
            "https://cdn.jsdelivr.net/gh/${GEODATA_REPO}@release/${f}" \
            "${GEODATA_DIR}/${f}"; then
            ok=$((ok + 1))
        elif download_and_verify \
            "https://github.com/${GEODATA_REPO}/releases/latest/download/${f}" \
            "${GEODATA_DIR}/${f}"; then
            ok=$((ok + 1))
        else
            log_warn "Failed to download ${f}"
        fi
    done

    if [ "$ok" -eq 2 ]; then
        _geodata_stamp
        log_info "mihomo geodata updated ($(cat "${GEODATA_DIR}/version"))"
        return 0
    fi
    log_error "mihomo geodata incomplete (${ok}/2) — upload geoip.dat + geosite.dat manually"
    return 1
}

update_geodata_singbox() {
    local ok=0 item fname urls url got

    progress "Downloading sing-box rule-sets (geoip-cn.srs + geosite-cn.srs)..."
    for item in \
        "geoip-cn.srs|https://cdn.jsdelivr.net/gh/SagerNet/sing-geoip@rule-set/geoip-cn.srs|https://raw.githubusercontent.com/SagerNet/sing-geoip/rule-set/geoip-cn.srs" \
        "geosite-cn.srs|https://cdn.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-cn.srs|https://raw.githubusercontent.com/SagerNet/sing-geosite/rule-set/geosite-cn.srs"
    do
        fname="${item%%|*}"
        urls="${item#*|}"
        got=0
        for url in $(echo "$urls" | tr '|' ' '); do
            if download_and_verify "$url" "${GEODATA_DIR}/${fname}"; then
                got=1
                break
            fi
        done
        [ "$got" = "1" ] && ok=$((ok + 1)) || log_warn "Failed to download ${fname}"
    done

    if [ "$ok" -eq 2 ]; then
        _geodata_stamp
        log_info "sing-box rule-sets updated ($(cat "${GEODATA_DIR}/version"))"
        return 0
    fi
    log_error "sing-box rule-sets incomplete (${ok}/2) — upload geoip-cn.srs + geosite-cn.srs manually"
    return 1
}

update_geodata() {
    local ok_dat=0 ok_srs=0
    update_geodata_mihomo && ok_dat=1
    update_geodata_singbox && ok_srs=1
    if [ "$ok_dat" = "1" ] || [ "$ok_srs" = "1" ]; then
        [ "$ok_dat" = "0" ] && log_warn "mihomo geodata was not updated"
        [ "$ok_srs" = "0" ] && log_warn "sing-box rule-sets were not updated"
        return 0
    fi
    return 1
}

check_kernel_version() {
    local kernel="$1"
    case "$kernel" in
    mihomo)
        local inst
        inst=$("$MIHOMO_BIN" -v 2>&1 | grep -o 'v[0-9.]*' | head -1)
        local latest
        latest=$(get_latest_release "$MIHOMO_REPO")
        printf '{"installed":"%s","latest":"%s"}\n' "$inst" "$latest"
        ;;
    singbox)
        local inst
        inst=$("$SINGBOX_BIN" version 2>&1 | grep -o 'v[0-9.]*' | head -1)
        local latest
        latest=$(get_latest_release "$SINGBOX_REPO")
        printf '{"installed":"%s","latest":"%s"}\n' "$inst" "$latest"
        ;;
    esac
}

# Update TomFly shell scripts from GitHub (jsDelivr may be unreachable on the router).
TOMFLY_REPO="wujiezero/TomFly"
# Default to main for automatic updates so users always get the latest fixes.
# Override to pin a commit: TOMFLY_REF=<hash> tomfly update core
TOMFLY_REF="${TOMFLY_REF:-main}"

_tf_fetch_script() {
    local relpath="$1" dest="$2" mode="${3:-755}" base url
    local tmp="${dest}.tomfly_tmp"
    for base in \
        "https://ghfast.top/https://raw.githubusercontent.com/${TOMFLY_REPO}/${TOMFLY_REF}" \
        "https://raw.githubusercontent.com/${TOMFLY_REPO}/${TOMFLY_REF}" \
        "https://cdn.jsdelivr.net/gh/${TOMFLY_REPO}@${TOMFLY_REF}"
    do
        url="${base}/${relpath}"
        progress "Trying ${url}"
        if curl -fsSL --connect-timeout 15 --max-time 90 -o "$tmp" "$url" 2>/dev/null; then
            mv "$tmp" "$dest"
            chmod "$mode" "$dest"
            log_info "updated ${dest}"
            return 0
        fi
    done
    rm -f "$tmp"
    log_error "download failed: ${relpath}"
    return 1
}

update_core() {
    local ok=0 fail=0 v
    local res="packages/luci-app-tomfly/htdocs/luci-static/resources"

    progress "Updating TomFly core (ref: ${TOMFLY_REF})..."
    _tf_fetch_script "packages/tomfly-core/root/usr/lib/tomfly/updater.sh" "/usr/lib/tomfly/updater.sh" 755 && ok=$((ok + 1)) || fail=$((fail + 1))
    _tf_fetch_script "packages/tomfly-core/root/usr/lib/tomfly/uri_parser.sh" "/usr/lib/tomfly/uri_parser.sh" 755 && ok=$((ok + 1)) || fail=$((fail + 1))
    _tf_fetch_script "packages/tomfly-core/root/usr/lib/tomfly/gen_singbox.sh" "/usr/lib/tomfly/gen_singbox.sh" 755 && ok=$((ok + 1)) || fail=$((fail + 1))
    _tf_fetch_script "packages/tomfly-core/root/usr/lib/tomfly/gen_mihomo.sh" "/usr/lib/tomfly/gen_mihomo.sh" 755 && ok=$((ok + 1)) || fail=$((fail + 1))
    _tf_fetch_script "packages/tomfly-core/root/usr/lib/tomfly/common.sh" "/usr/lib/tomfly/common.sh" 755 && ok=$((ok + 1)) || fail=$((fail + 1))
    _tf_fetch_script "packages/tomfly-core/root/usr/lib/tomfly/capabilities.sh" "/usr/lib/tomfly/capabilities.sh" 755 && ok=$((ok + 1)) || fail=$((fail + 1))
    _tf_fetch_script "packages/tomfly-core/root/usr/lib/tomfly/nftables.sh" "/usr/lib/tomfly/nftables.sh" 755 && ok=$((ok + 1)) || fail=$((fail + 1))
    _tf_fetch_script "packages/tomfly-core/root/usr/lib/tomfly/dns.sh" "/usr/lib/tomfly/dns.sh" 755 && ok=$((ok + 1)) || fail=$((fail + 1))
    _tf_fetch_script "packages/tomfly-core/root/usr/lib/tomfly/traffic.sh" "/usr/lib/tomfly/traffic.sh" 755 && ok=$((ok + 1)) || fail=$((fail + 1))
    _tf_fetch_script "packages/tomfly-core/root/usr/bin/tomfly" "/usr/bin/tomfly" 755 && ok=$((ok + 1)) || fail=$((fail + 1))

    progress "Updating TomFly LuCI UI..."
    mkdir -p /www/luci-static/resources/tomfly /www/luci-static/resources/view/tomfly
    _tf_fetch_script "${res}/tomfly/api.js" "/www/luci-static/resources/tomfly/api.js" 644 && ok=$((ok + 1)) || fail=$((fail + 1))
    _tf_fetch_script "${res}/tomfly/kernel-profile.js" "/www/luci-static/resources/tomfly/kernel-profile.js" 644 && ok=$((ok + 1)) || fail=$((fail + 1))
    _tf_fetch_script "${res}/view/tomfly/style.css" "/www/luci-static/resources/view/tomfly/style.css" 644 && ok=$((ok + 1)) || fail=$((fail + 1))
    _tf_fetch_script "${res}/view/tomfly/logo.png" "/www/luci-static/resources/view/tomfly/logo.png" 644 && ok=$((ok + 1)) || fail=$((fail + 1))
    for v in overview nodes groups rules dns kernel log; do
        _tf_fetch_script "${res}/view/tomfly/${v}.js" "/www/luci-static/resources/view/tomfly/${v}.js" 644 && ok=$((ok + 1)) || fail=$((fail + 1))
    done

    rm -rf /tmp/luci-modulecache /tmp/luci-indexcache* 2>/dev/null
    log_info "LuCI cache cleared"

    if [ "$fail" -gt 0 ]; then
        log_error "core update incomplete (${ok} ok, ${fail} failed)"
        return 1
    fi
    log_info "TomFly core updated (${ok} files)"
    return 0
}
