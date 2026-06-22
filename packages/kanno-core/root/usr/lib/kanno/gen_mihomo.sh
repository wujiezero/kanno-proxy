#!/bin/sh
# KannoProxy - generate mihomo config.yaml from UCI

. /usr/lib/kanno/common.sh
. /usr/lib/kanno/capabilities.sh

_u() { uci -q get "kanno.$1" 2>/dev/null; }
_ul() { uci -q get "kanno.$1" 2>/dev/null; }

# Emit a proxy block for one UCI proxy section
emit_proxy() {
    local sec="$1"
    local type=$(_u "${sec}.type")
    local name=$(_u "${sec}.name")
    local server=$(_u "${sec}.server")
    local port=$(_u "${sec}.port")

    [ -z "$type" ] || [ -z "$server" ] && return

    printf '  - name: "%s"\n' "$name"
    printf '    type: %s\n' "$type"
    printf '    server: %s\n' "$server"
    printf '    port: %s\n' "$port"

    case "$type" in
    vless)
        printf '    uuid: %s\n' "$(_u "${sec}.uuid")"
        local flow=$(_u "${sec}.flow")
        [ -n "$flow" ] && printf '    flow: %s\n' "$flow"
        local security=$(_u "${sec}.security")
        case "$security" in
        reality)
            printf '    tls: true\n'
            printf '    reality-opts:\n'
            printf '      public-key: %s\n' "$(_u "${sec}.pbk")"
            printf '      short-id: %s\n' "$(_u "${sec}.sid")"
            local sni=$(_u "${sec}.sni")
            [ -n "$sni" ] && printf '    servername: %s\n' "$sni"
            local fp=$(_u "${sec}.fp")
            [ -n "$fp" ] && printf '    client-fingerprint: %s\n' "$fp"
            ;;
        tls)
            printf '    tls: true\n'
            local sni=$(_u "${sec}.sni")
            [ -n "$sni" ] && printf '    servername: %s\n' "$sni"
            ;;
        esac
        local transport=$(_u "${sec}.transport")
        case "$transport" in
        ws)
            printf '    network: ws\n'
            printf '    ws-opts:\n'
            local h=$(_u "${sec}.transport_host")
            local p=$(_u "${sec}.transport_path")
            [ -n "$h" ] && printf '      headers:\n        Host: %s\n' "$h"
            [ -n "$p" ] && printf '      path: %s\n' "$p"
            ;;
        grpc)
            printf '    network: grpc\n'
            printf '    grpc-opts:\n'
            local sn=$(_u "${sec}.transport_svcname")
            [ -n "$sn" ] && printf '      grpc-service-name: %s\n' "$sn"
            ;;
        esac
        ;;
    vmess)
        printf '    uuid: %s\n' "$(_u "${sec}.uuid")"
        printf '    alterId: %s\n' "${_u "${sec}.alter_id":-0}"
        printf '    cipher: %s\n' "${_u "${sec}.cipher":-auto}"
        local tls=$(_u "${sec}.security")
        [ "$tls" = "tls" ] && printf '    tls: true\n'
        local sni=$(_u "${sec}.sni")
        [ -n "$sni" ] && printf '    servername: %s\n' "$sni"
        local transport=$(_u "${sec}.transport")
        case "$transport" in
        ws)
            printf '    network: ws\n'
            printf '    ws-opts:\n'
            local h=$(_u "${sec}.transport_host")
            local p=$(_u "${sec}.transport_path")
            [ -n "$h" ] && printf '      headers:\n        Host: %s\n' "$h"
            [ -n "$p" ] && printf '      path: %s\n' "$p"
            ;;
        h2)
            printf '    network: h2\n'
            printf '    h2-opts:\n'
            local h=$(_u "${sec}.transport_host")
            local p=$(_u "${sec}.transport_path")
            [ -n "$h" ] && printf '      host:\n        - %s\n' "$h"
            [ -n "$p" ] && printf '      path: %s\n' "$p"
            ;;
        grpc)
            printf '    network: grpc\n'
            printf '    grpc-opts:\n'
            printf '      grpc-service-name: %s\n' "$(_u "${sec}.transport_svcname")"
            ;;
        esac
        ;;
    trojan)
        printf '    password: %s\n' "$(_u "${sec}.password")"
        printf '    sni: %s\n' "$(_u "${sec}.sni")"
        local ins=$(_u "${sec}.insecure")
        [ "$ins" = "1" ] && printf '    skip-cert-verify: true\n'
        local fp=$(_u "${sec}.fp")
        [ -n "$fp" ] && printf '    client-fingerprint: %s\n' "$fp"
        ;;
    ss)
        printf '    cipher: %s\n' "$(_u "${sec}.method")"
        printf '    password: "%s"\n' "$(_u "${sec}.password")"
        ;;
    hy2|hysteria2)
        printf '    password: %s\n' "$(_u "${sec}.password")"
        local sni=$(_u "${sec}.sni")
        [ -n "$sni" ] && printf '    sni: %s\n' "$sni"
        local ins=$(_u "${sec}.insecure")
        [ "$ins" = "1" ] && printf '    skip-cert-verify: true\n'
        local obfs=$(_u "${sec}.obfs")
        if [ -n "$obfs" ]; then
            printf '    obfs: %s\n' "$obfs"
            printf '    obfs-password: %s\n' "$(_u "${sec}.obfs_password")"
        fi
        ;;
    tuic)
        printf '    uuid: %s\n' "$(_u "${sec}.uuid")"
        printf '    password: %s\n' "$(_u "${sec}.password")"
        local sni=$(_u "${sec}.sni")
        [ -n "$sni" ] && printf '    sni: %s\n' "$sni"
        local alpn=$(_u "${sec}.alpn")
        [ -n "$alpn" ] && printf '    alpn:\n      - %s\n' "$alpn"
        printf '    congestion-controller: %s\n' "${_u "${sec}.cc":-bbr}"
        ;;
    naive)
        printf '    username: %s\n' "$(_u "${sec}.username")"
        printf '    password: %s\n' "$(_u "${sec}.password")"
        ;;
    anytls)
        printf '    password: "%s"\n' "$(_u "${sec}.password")"
        local security=$(_u "${sec}.security")
        case "$security" in
        reality)
            printf '    reality-opts:\n'
            printf '      public-key: %s\n' "$(_u "${sec}.pbk")"
            printf '      short-id: %s\n' "$(_u "${sec}.sid")"
            local sni=$(_u "${sec}.sni")
            [ -n "$sni" ] && printf '    sni: %s\n' "$sni"
            local fp=$(_u "${sec}.fp")
            [ -n "$fp" ] && printf '    client-fingerprint: %s\n' "$fp"
            ;;
        *)
            local sni=$(_u "${sec}.sni")
            [ -n "$sni" ] && printf '    sni: %s\n' "$sni"
            local fp=$(_u "${sec}.fp")
            [ -n "$fp" ] && printf '    client-fingerprint: %s\n' "$fp"
            ;;
        esac
        ;;
    esac
}

generate_mihomo_config() {
    local mode=$(_u "global.mode"); mode="${mode:-rule}"
    local loglevel=$(_u "global.log_level"); loglevel="${loglevel:-info}"
    local _ipv6=$(_u "global.ipv6")
    local ipv6; [ "$_ipv6" = "1" ] && ipv6="true" || ipv6="false"
    local tun=$(_u "global.tun"); tun="${tun:-0}"
    local dns_mode=$(_u "dns.mode"); dns_mode="${dns_mode:-fake-ip}"
    local dns_port=$(_u "dns.listen_port"); dns_port="${dns_port:-1053}"

    cat <<YAML
# Generated by KannoProxy $(date '+%Y-%m-%d %H:%M:%S') - DO NOT EDIT
mixed-port: 7890
tproxy-port: 7893
redir-port: 7892
allow-lan: true
bind-address: '*'
mode: ${mode}
log-level: ${loglevel}
ipv6: ${ipv6}
geodata-mode: true
unified-delay: true
tcp-concurrent: true
find-process-mode: 'off'
routing-mark: 768
external-controller: 127.0.0.1:9090

tun:
  enable: $([ "$tun" = "1" ] && echo "true" || echo "false")
  stack: system
  device: Meta
  auto-route: true
  auto-redirect: true
  auto-detect-interface: true
  dns-hijack:
    - any:53
  strict-route: false

dns:
  enable: true
  ipv6: ${ipv6}
  listen: 127.0.0.1:${dns_port}
  enhanced-mode: ${dns_mode}
  fake-ip-range: 198.18.0.1/16
  fake-ip-filter:
    - '*.lan'
    - 'localhost.ptlogin2.qq.com'
    - '+.local'
    - 'time.*.com'
    - 'time.*.gov'
    - 'time.*.edu.cn'
    - 'time.*.apple.com'
    - 'ntp.*.com'
    - '*.time.edu.cn'
    - '*.ntp.org.cn'
    - '+.pool.ntp.org'
    - 'time1.cloud.tencent.com'
    - 'music.163.com'
    - '*.music.163.com'
    - '*.126.net'
    - 'musicapi.taihe.com'
    - 'music.taihe.com'
    - 'songsearch.kugou.com'
    - 'trackercdn.kugou.com'
    - '*.kuwo.cn'
    - 'api-jooxtt.sanook.com'
    - 'api.joox.com'
    - 'joox.com'
  nameserver:
YAML
    uci -q get kanno.dns.domestic_dns 2>/dev/null | tr ' ' '\n' | while read -r ns; do
        [ -n "$ns" ] && printf '    - %s\n' "$ns"
    done
    cat <<YAML
  fallback:
YAML
    uci -q get kanno.dns.foreign_dns 2>/dev/null | tr ' ' '\n' | while read -r ns; do
        [ -n "$ns" ] && printf '    - "tls://%s"\n' "$ns"
    done
    cat <<YAML
  fallback-filter:
    geoip: true
    geoip-code: CN
    ipcidr:
      - 240.0.0.0/4
      - 0.0.0.0/32

proxies:
YAML

    # Determine which enabled nodes this kernel can actually use; skip the rest
    # so a single unsupported node can't make mihomo reject the whole config.
    : > /tmp/kanno_usable.tmp
    uci show kanno 2>/dev/null | grep "^kanno\.proxy_.*\.type=" | while read -r line; do
        local sec=$(echo "$line" | cut -d'.' -f2)
        [ "$(_u "${sec}.enabled")" = "0" ] && continue
        case " ${KANNO_EXCLUDE:-} " in
            *" $sec "*) log_warn "excluding node $(_u "${sec}.name"): failed config validation"; continue ;;
        esac
        local reason
        if reason=$(kanno_node_incompat mihomo "$sec"); then
            echo "$sec" >> /tmp/kanno_usable.tmp
        else
            log_warn "skipping node $(_u "${sec}.name"): $reason"
        fi
    done

    # Emit all usable proxy nodes
    while read -r sec; do
        [ -n "$sec" ] && emit_proxy "$sec"
    done < /tmp/kanno_usable.tmp

    # Collect the same usable nodes' names for the auto-group
    local proxy_names=""
    while read -r sec; do
        [ -n "$sec" ] && _u "${sec}.name"
    done < /tmp/kanno_usable.tmp > /tmp/kanno_proxy_names.tmp
    proxy_names=$(cat /tmp/kanno_proxy_names.tmp 2>/dev/null)
    rm -f /tmp/kanno_proxy_names.tmp /tmp/kanno_usable.tmp

    # Member lines shared by both groups (fall back to DIRECT if no usable node)
    local members
    if [ -n "$proxy_names" ]; then
        members=$(echo "$proxy_names" | while read -r pn; do
            [ -n "$pn" ] && printf '      - "%s"\n' "$pn"
        done)
    else
        members='      - DIRECT'
    fi

    # AUTO  = url-test (picks the fastest automatically)
    # PROXY = select   (what the rules target; user can pin AUTO / a node / DIRECT)
    cat <<YAML

proxy-groups:
  - name: "AUTO"
    type: url-test
    proxies:
${members}
    url: "http://www.gstatic.com/generate_204"
    interval: 300
    tolerance: 50
  - name: "PROXY"
    type: select
    proxies:
      - "AUTO"
${members}
YAML
    [ -n "$proxy_names" ] && printf '      - DIRECT\n'

    cat <<YAML

rules:
YAML

    # Force proxy rules
    [ -f "${RULES_DIR}/force_proxy.txt" ] && \
        grep -v '^#' "${RULES_DIR}/force_proxy.txt" | grep -v '^$' | while read -r r; do
            case "$r" in
            *.*.*.*/*) printf '  - IP-CIDR,%s,PROXY,no-resolve\n' "$r" ;;
            *.*)        printf '  - DOMAIN-SUFFIX,%s,PROXY\n' "$r" ;;
            *)          printf '  - DOMAIN,%s,PROXY\n' "$r" ;;
            esac
        done

    # Force direct rules
    [ -f "${RULES_DIR}/force_direct.txt" ] && \
        grep -v '^#' "${RULES_DIR}/force_direct.txt" | grep -v '^$' | while read -r r; do
            case "$r" in
            *.*.*.*/*) printf '  - IP-CIDR,%s,DIRECT,no-resolve\n' "$r" ;;
            *.*)        printf '  - DOMAIN-SUFFIX,%s,DIRECT\n' "$r" ;;
            *)          printf '  - DOMAIN,%s,DIRECT\n' "$r" ;;
            esac
        done

    local geosite_cn=$(_u "rules.geosite_cn"); geosite_cn="${geosite_cn:-DIRECT}"
    local geoip_cn=$(_u "rules.geoip_cn"); geoip_cn="${geoip_cn:-DIRECT}"

    cat <<YAML
  - GEOSITE,CN,${geosite_cn}
  - GEOSITE,private,DIRECT
  - GEOIP,private,DIRECT,no-resolve
  - GEOIP,CN,${geoip_cn},no-resolve
  - MATCH,PROXY
YAML
}

# Write config to file
write_config() {
    local outfile="${1:-$MIHOMO_CFG}"
    mkdir -p "$(dirname "$outfile")"
    generate_mihomo_config > "$outfile"
    log_info "mihomo config written to $outfile"
}
