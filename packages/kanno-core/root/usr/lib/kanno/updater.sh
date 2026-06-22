#!/bin/sh
# KannoProxy - kernel & geodata updater

. /usr/lib/kanno/common.sh

GITHUB_API="https://api.github.com"
MIHOMO_REPO="MetaCubeX/mihomo"
SINGBOX_REPO="SagerNet/sing-box"
GEODATA_REPO="Loyalsoldier/v2ray-rules-dat"

# Print progress to both terminal and log
progress() { printf '\033[0;36m[→]\033[0m %s\n' "$*"; echo "[STEP]  $*" >> "$KANNO_LOG"; }

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

download_and_verify() {
    local url="$1" dest="$2"
    local fname
    fname=$(basename "$url")
    local tmpfile="/tmp/kanno-dl-${fname}"
    local size

    progress "Downloading: $fname"
    if ! curl -fL --max-time 180 --progress-bar -o "$tmpfile" "$url" 2>&1; then
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
        local tmpdir="/tmp/kanno-extract-$$"
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
        local ungz="/tmp/kanno-ungz-$$"
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
        local tmpdir="/tmp/kanno-extract-$$"
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

    chmod +x "$dest"
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

    download_and_verify "$url" "$MIHOMO_BIN" || return 1
    echo "$tag" > "${KANNO_DIR}/mihomo.version"
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

    local url
    # sing-box assets are sing-box-<ver>-<arch>.tar.gz (statically linked Go
    # binary, so there is no glibc/musl variant to choose).
    url=$(get_download_url "$SINGBOX_REPO" "$tag" "${arch}\.tar\.gz" | head -1)
    [ -z "$url" ] && url=$(get_download_url "$SINGBOX_REPO" "$tag" "sing-box-.*-${arch}\.tar\.gz" | head -1)
    if [ -z "$url" ]; then
        log_error "No sing-box binary found for arch: $arch (tag: $tag)"
        return 1
    fi
    progress "Selected: $(basename "$url")"

    local tmpfile="/tmp/kanno-singbox-${tag}.tar.gz"
    progress "Downloading: $(basename "$url")"
    if ! curl -fL --max-time 180 --progress-bar -o "$tmpfile" "$url" 2>&1; then
        log_error "sing-box download failed"
        rm -f "$tmpfile"
        return 1
    fi

    local tmpdir="/tmp/kanno-singbox-extract"
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
    echo "$tag" > "${KANNO_DIR}/singbox.version"
    log_info "sing-box updated to $tag"
    rm -rf "$tmpfile" "$tmpdir"
}

update_geodata() {
    progress "Downloading GeoData (geoip.dat + geosite.dat)..."
    local base="https://github.com/${GEODATA_REPO}/releases/latest/download"
    local ok=0

    for f in geoip.dat geosite.dat; do
        if download_and_verify "${base}/${f}" "${GEODATA_DIR}/${f}"; then
            ok=$((ok + 1))
        else
            log_warn "Failed to download $f, trying mirror..."
            local mirror="https://cdn.jsdelivr.net/gh/${GEODATA_REPO}@release/${f}"
            download_and_verify "$mirror" "${GEODATA_DIR}/${f}" && ok=$((ok + 1))
        fi
    done

    if [ "$ok" -eq 2 ]; then
        local ver
        ver=$(date '+%Y-%m-%d')
        echo "$ver" > "${GEODATA_DIR}/version"
        log_info "geodata updated ($ver)"
    else
        log_error "geodata update incomplete (${ok}/2 files)"
        return 1
    fi
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
