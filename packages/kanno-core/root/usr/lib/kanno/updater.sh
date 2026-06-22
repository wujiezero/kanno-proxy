#!/bin/sh
# KannoProxy - kernel & geodata updater

. /usr/lib/kanno/common.sh

GITHUB_API="https://api.github.com"
MIHOMO_REPO="MetaCubeX/mihomo"
SINGBOX_REPO="SagerNet/sing-box"
GEODATA_REPO="Loyalsoldier/v2ray-rules-dat"

detect_arch() {
    local arch
    arch=$(uname -m)
    case "$arch" in
    aarch64)      echo "linux-arm64" ;;
    armv7l|armv6l) echo "linux-armv7" ;;
    x86_64)       echo "linux-amd64" ;;
    mips)         echo "linux-mips-softfloat" ;;
    mipsle)       echo "linux-mipsle-softfloat" ;;
    *)            echo "linux-amd64" ;;
    esac
}

get_latest_release() {
    local repo="$1"
    curl -fsSL --max-time 15 \
        "${GITHUB_API}/repos/${repo}/releases/latest" 2>/dev/null | \
        jsonfilter -e '@.tag_name' 2>/dev/null
}

get_download_url() {
    local repo="$1"
    local tag="$2"
    local pattern="$3"
    curl -fsSL --max-time 15 \
        "${GITHUB_API}/repos/${repo}/releases/tags/${tag}" 2>/dev/null | \
        jsonfilter -e '@.assets[*].browser_download_url' 2>/dev/null | \
        grep -m1 "$pattern"
}

download_and_verify() {
    local url="$1"
    local dest="$2"
    local tmpfile="${dest}.tmp"

    log_info "downloading: $url"
    if ! curl -fsSL --max-time 120 -o "$tmpfile" "$url"; then
        log_error "download failed: $url"
        rm -f "$tmpfile"
        return 1
    fi

    # Decompress if needed
    case "$url" in
    *.gz)
        if ! gunzip -c "$tmpfile" > "${tmpfile%.gz}" 2>/dev/null; then
            log_error "decompression failed"
            rm -f "$tmpfile" "${tmpfile%.gz}"
            return 1
        fi
        mv "${tmpfile%.gz}" "$dest"
        rm -f "$tmpfile"
        ;;
    *.zip)
        local tmpdir="${dest}.dir"
        mkdir -p "$tmpdir"
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
    log_info "installed: $dest"
    return 0
}

update_mihomo() {
    local arch=$(detect_arch)
    local tag=$(get_latest_release "$MIHOMO_REPO")
    [ -z "$tag" ] && { log_error "cannot fetch mihomo version"; return 1; }

    local url=$(get_download_url "$MIHOMO_REPO" "$tag" "mihomo-${arch}-" | grep -v 'alpha\|beta' | head -1)
    # fallback to alpha if no stable
    [ -z "$url" ] && url=$(get_download_url "$MIHOMO_REPO" "$tag" "mihomo-${arch}-" | head -1)
    [ -z "$url" ] && { log_error "cannot find mihomo binary for $arch"; return 1; }

    download_and_verify "$url" "$MIHOMO_BIN" || return 1
    log_info "mihomo updated to $tag"
    echo "$tag" > "${KANNO_DIR}/mihomo.version"
}

update_singbox() {
    local arch=$(detect_arch)
    # sing-box uses different naming
    local sb_arch
    case "$arch" in
    linux-arm64)   sb_arch="linux-arm64" ;;
    linux-armv7)   sb_arch="linux-armv7" ;;
    linux-amd64)   sb_arch="linux-amd64" ;;
    *)             sb_arch="linux-amd64" ;;
    esac

    local tag=$(get_latest_release "$SINGBOX_REPO")
    [ -z "$tag" ] && { log_error "cannot fetch sing-box version"; return 1; }

    local url=$(get_download_url "$SINGBOX_REPO" "$tag" "sing-box-.*-${sb_arch}\.tar\.gz" | head -1)
    [ -z "$url" ] && { log_error "cannot find sing-box binary for $sb_arch"; return 1; }

    local tmpdir="/tmp/kanno-sb-update"
    mkdir -p "$tmpdir"
    if curl -fsSL --max-time 120 -o "${tmpdir}/sb.tar.gz" "$url"; then
        tar -xzf "${tmpdir}/sb.tar.gz" -C "$tmpdir" 2>/dev/null
        local extracted=$(find "$tmpdir" -name 'sing-box' -type f | head -1)
        if [ -n "$extracted" ]; then
            mv "$extracted" "$SINGBOX_BIN"
            chmod +x "$SINGBOX_BIN"
            log_info "sing-box updated to $tag"
            echo "$tag" > "${KANNO_DIR}/singbox.version"
        else
            log_error "sing-box binary not found in archive"
        fi
    else
        log_error "sing-box download failed"
    fi
    rm -rf "$tmpdir"
}

update_geodata() {
    local tag=$(get_latest_release "$GEODATA_REPO")
    [ -z "$tag" ] && tag="latest"

    local base="https://github.com/${GEODATA_REPO}/releases/latest/download"

    for f in geoip.dat geosite.dat; do
        download_and_verify "${base}/${f}" "${GEODATA_DIR}/${f}"
    done
    log_info "geodata updated"
    echo "$tag" > "${GEODATA_DIR}/version"
}

check_kernel_version() {
    local kernel="$1"
    case "$kernel" in
    mihomo)
        local installed
        installed=$("$MIHOMO_BIN" -v 2>&1 | grep -o 'v[0-9.]*' | head -1)
        local latest=$(get_latest_release "$MIHOMO_REPO")
        echo "{\"installed\":\"${installed}\",\"latest\":\"${latest}\"}"
        ;;
    singbox)
        local installed
        installed=$("$SINGBOX_BIN" version 2>&1 | grep -o 'v[0-9.]*' | head -1)
        local latest=$(get_latest_release "$SINGBOX_REPO")
        echo "{\"installed\":\"${installed}\",\"latest\":\"${latest}\"}"
        ;;
    esac
}
