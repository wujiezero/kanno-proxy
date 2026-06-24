#!/bin/sh
# TomFly - generate sing-box config.json from UCI

. /usr/lib/tomfly/common.sh
. /usr/lib/tomfly/capabilities.sh

_u() { uci -q get "tomfly.$1" 2>/dev/null; }
_ud() {
    local v
    v=$(_u "$1")
    [ -n "$v" ] && echo "$v" || echo "$2"
}

json_str() { printf '"%s"' "$(echo "$1" | sed 's/"/\\"/g')"; }

_sb_first_list() {
    local val
    val=$(_u "$1")
    [ -n "$val" ] || val="$2"
    echo "$val" | awk '{print $1}'
}

emit_singbox_proxy() {
    local sec="$1"
    local type=$(_u "${sec}.type")
    local name=$(_u "${sec}.name")
    local server=$(_u "${sec}.server")
    local port=$(_u "${sec}.port")

    [ -z "$type" ] || [ -z "$server" ] && return

    printf '    {\n'
    printf '      "tag": %s,\n' "$(json_str "$name")"
    printf '      "server": %s,\n' "$(json_str "$server")"
    printf '      "server_port": %s' "$port"

    case "$type" in
    vless)
        printf ',\n      "type": "vless"'
        printf ',\n      "uuid": %s' "$(json_str "$(_u "${sec}.uuid")")"
        local flow=$(_u "${sec}.flow")
        [ -n "$flow" ] && printf ',\n      "flow": %s' "$(json_str "$flow")"
        local security=$(_u "${sec}.security")
        if [ "$security" = "reality" ]; then
            printf ',\n      "tls": {'
            printf '\n        "enabled": true,'
            printf '\n        "server_name": %s,' "$(json_str "$(_u "${sec}.sni")")"
            printf '\n        "utls": {"enabled": true, "fingerprint": %s},' "$(json_str "$(_u "${sec}.fp")")"
            printf '\n        "reality": {"enabled": true, "public_key": %s, "short_id": %s}' \
                "$(json_str "$(_u "${sec}.pbk")")" "$(json_str "$(_u "${sec}.sid")")"
            printf '\n      }'
        elif [ "$security" = "tls" ]; then
            printf ',\n      "tls": {"enabled": true, "server_name": %s}' \
                "$(json_str "$(_u "${sec}.sni")")"
        fi
        ;;
    vmess)
        printf ',\n      "type": "vmess"'
        printf ',\n      "uuid": %s' "$(json_str "$(_u "${sec}.uuid")")"
        printf ',\n      "alter_id": %s' "$(_ud "${sec}.alter_id" "0")"
        printf ',\n      "security": %s' "$(json_str "$(_ud "${sec}.cipher" "auto")")"
        local tls=$(_u "${sec}.security")
        [ "$tls" = "tls" ] && \
            printf ',\n      "tls": {"enabled": true, "server_name": %s}' \
                "$(json_str "$(_u "${sec}.sni")")"
        ;;
    trojan)
        printf ',\n      "type": "trojan"'
        printf ',\n      "password": %s' "$(json_str "$(_u "${sec}.password")")"
        printf ',\n      "tls": {"enabled": true, "server_name": %s}' \
            "$(json_str "$(_u "${sec}.sni")")"
        local ins=$(_u "${sec}.insecure")
        [ "$ins" = "1" ] && printf ',\n      "tls": {"insecure": true}'
        ;;
    ss)
        printf ',\n      "type": "shadowsocks"'
        printf ',\n      "method": %s' "$(json_str "$(_u "${sec}.method")")"
        printf ',\n      "password": %s' "$(json_str "$(_u "${sec}.password")")"
        ;;
    hy2|hysteria2)
        printf ',\n      "type": "hysteria2"'
        printf ',\n      "password": %s' "$(json_str "$(_u "${sec}.password")")"
        local sni=$(_u "${sec}.sni")
        printf ',\n      "tls": {"enabled": true, "server_name": %s}' "$(json_str "$sni")"
        local ins=$(_u "${sec}.insecure")
        [ "$ins" = "1" ] && printf ',\n      "tls": {"insecure": true}'
        local obfs=$(_u "${sec}.obfs")
        [ -n "$obfs" ] && \
            printf ',\n      "obfs": {"type": %s, "password": %s}' \
                "$(json_str "$obfs")" "$(json_str "$(_u "${sec}.obfs_password")")"
        ;;
    tuic)
        printf ',\n      "type": "tuic"'
        printf ',\n      "uuid": %s' "$(json_str "$(_u "${sec}.uuid")")"
        printf ',\n      "password": %s' "$(json_str "$(_u "${sec}.password")")"
        printf ',\n      "tls": {"enabled": true, "server_name": %s, "alpn": [%s]}' \
            "$(json_str "$(_u "${sec}.sni")")" "$(json_str "$(_ud "${sec}.alpn" "h3")")"
        printf ',\n      "congestion_control": %s' "$(json_str "$(_ud "${sec}.cc" "bbr")")"
        ;;
    naive)
        printf ',\n      "type": "naive"'
        printf ',\n      "username": %s' "$(json_str "$(_u "${sec}.username")")"
        printf ',\n      "password": %s' "$(json_str "$(_u "${sec}.password")")"
        ;;
    anytls)
        printf ',\n      "type": "anytls"'
        printf ',\n      "password": %s' "$(json_str "$(_u "${sec}.password")")"
        local security=$(_u "${sec}.security")
        if [ "$security" = "reality" ]; then
            printf ',\n      "tls": {'
            printf '\n        "enabled": true,'
            printf '\n        "server_name": %s,' "$(json_str "$(_u "${sec}.sni")")"
            printf '\n        "utls": {"enabled": true, "fingerprint": %s},' "$(json_str "$(_ud "${sec}.fp" "chrome")")"
            printf '\n        "reality": {"enabled": true, "public_key": %s, "short_id": %s}' \
                "$(json_str "$(_u "${sec}.pbk")")" "$(json_str "$(_u "${sec}.sid")")"
            printf '\n      }'
        else
            printf ',\n      "tls": {"enabled": true, "server_name": %s' "$(json_str "$(_u "${sec}.sni")")"
            local fp=$(_u "${sec}.fp")
            [ -n "$fp" ] && printf ', "utls": {"enabled": true, "fingerprint": %s}' "$(json_str "$fp")"
            printf '}'
        fi
        ;;
    esac
    printf '\n    }'
}

_emit_json_name_array() {
    local file="$1" prefix_comma="${2:-0}" pn first=1
    [ -f "$file" ] || return 0
    while read -r pn; do
        [ -n "$pn" ] || continue
        if [ "$prefix_comma" = "1" ]; then
            printf ',\n        %s' "$(json_str "$pn")"
        else
            [ "$first" = "0" ] && printf ','
            printf '\n        %s' "$(json_str "$pn")"
            first=0
        fi
    done < "$file"
}

_emit_force_rules() {
    local policy="$1" file="$2" r
    [ -f "$file" ] || return 0
    while read -r r; do
        r=$(echo "$r" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        [ -z "$r" ] || [ "${r#\#}" != "$r" ] && continue
        case "$r" in
        *.*.*.*/*)
            printf '      {"ip_cidr": [%s], "outbound": %s},\n' "$(json_str "$r")" "$(json_str "$policy")"
            ;;
        *.*)
            printf '      {"domain_suffix": [%s], "outbound": %s},\n' "$(json_str "$r")" "$(json_str "$policy")"
            ;;
        *)
            printf '      {"domain": [%s], "outbound": %s},\n' "$(json_str "$r")" "$(json_str "$policy")"
            ;;
        esac
    done < "$file"
}

_emit_node_bypass_rules() {
    local ip
    list_node_server_ips | while read -r ip; do
        [ -z "$ip" ] && continue
        printf '      {"ip_cidr": [%s], "outbound": "DIRECT"},\n' "$(json_str "${ip}/32")"
    done
}

_emit_tun_inbound() {
    local first=1 ip pn
    printf '    {"type": "tun", "tag": "tun-in", "interface_name": "TomFly", "address": ["172.19.0.1/30"], "auto_route": true, "auto_redirect": true, "strict_route": false, "stack": "system"'
    # Always exclude private/reserved ranges from the TUN so traffic to the LAN
    # and the router itself NEVER enters the tunnel (prevents locking out the
    # router's own management access), then append the node server IPs so the
    # kernel reaches its upstream directly.
    printf ', "route_exclude_address": ['
    first=1
    for pn in 192.168.0.0/16 10.0.0.0/8 172.16.0.0/12 169.254.0.0/16 100.64.0.0/10; do
        [ "$first" = "0" ] && printf ','
        printf '%s' "$(json_str "$pn")"
        first=0
    done
    if [ "$(_u "global.ipv6")" = "1" ]; then
        for pn in fc00::/7 fe80::/10; do
            [ "$first" = "0" ] && printf ','
            printf '%s' "$(json_str "$pn")"
            first=0
        done
    fi
    for ip in $(list_node_server_ips); do
        [ -z "$ip" ] && continue
        [ "$first" = "0" ] && printf ','
        printf '%s' "$(json_str "${ip}/32")"
        first=0
    done
    printf ']'
    printf '}\n'
}

# sing-box TPROXY inbound — used when TUN is unavailable (fallback from
# tomfly_start).  Emits a tproxy listener that works like the mihomo one.
_emit_tproxy_inbound() {
    printf '    {"type": "tproxy", "tag": "tproxy-in", "listen": "::", "listen_port": 7893, "tcp_fast_open": true, "udp_fragment": true, "sniff": true},\n'
}

# Prefer local .srs under GEODATA_DIR; fall back to remote CDN (router must reach it).
_emit_singbox_rule_set() {
    local tag="$1" url="$2"
    local path="${GEODATA_DIR}/${tag}.srs"
    if [ -f "$path" ]; then
        printf '      {\n'
        printf '        "tag": %s,\n' "$(json_str "$tag")"
        printf '        "type": "local",\n'
        printf '        "format": "binary",\n'
        printf '        "path": %s\n' "$(json_str "$path")"
        printf '      }'
    else
        printf '      {\n'
        printf '        "tag": %s,\n' "$(json_str "$tag")"
        printf '        "type": "remote",\n'
        printf '        "format": "binary",\n'
        printf '        "url": %s,\n' "$(json_str "$url")"
        printf '        "update_interval": "24h"\n'
        printf '      }'
    fi
}

generate_singbox_config() {
    local loglevel=$(_u "global.log_level"); loglevel="${loglevel:-info}"
    local dns_mode=$(_u "dns.mode"); dns_mode="${dns_mode:-fake-ip}"
    local geosite_cn=$(_u "rules.geosite_cn"); geosite_cn="${geosite_cn:-DIRECT}"
    local geoip_cn=$(_u "rules.geoip_cn"); geoip_cn="${geoip_cn:-DIRECT}"
    local default_policy=$(_u "rules.default_policy"); default_policy="${default_policy:-PROXY}"
    local sb_mode=$(_u "global.mode"); sb_mode="${sb_mode:-rule}"
    local domestic=$(_sb_first_list "dns.domestic_dns" "223.5.5.5")
    local foreign=$(_sb_first_list "dns.foreign_dns" "8.8.8.8")
    local dns_port=$(_u "dns.listen_port"); dns_port="${dns_port:-1053}"
    local usable="/tmp/tomfly_sb_usable.tmp"
    local names="/tmp/tomfly_sb_names.tmp"
    local sec reason

    : > "$usable"
    : > "$names"
    for sec in $(uci show tomfly 2>/dev/null | sed -n "s/^tomfly\.\(proxy_[0-9a-f]*\)\.type=.*/\1/p"); do
        [ "$(_u "${sec}.enabled")" = "0" ] && continue
        case " ${TOMFLY_EXCLUDE:-} " in
            *" $sec "*) log_warn "excluding node $(_u "${sec}.name"): failed config validation"; continue ;;
        esac
        if reason=$(tomfly_node_incompat singbox "$sec"); then
            echo "$sec" >> "$usable"
        else
            log_warn "skipping node $(_u "${sec}.name"): $reason"
        fi
    done
    # Sort by order to produce names in the right sequence
    {
        while read -r sec; do
            [ -n "$sec" ] || continue
            local ord; ord=$(_u "${sec}.order"); ord="${ord:-0}"
            printf '%08d %s\n' "$ord" "$(_u "${sec}.name")"
        done < "$usable" | sort -n | while read -r _ n; do
            echo "$n"
        done
    } > "$names"

    printf '{\n'
    printf '  "log": {"level": %s, "timestamp": true, "output": %s},\n' \
        "$(json_str "$loglevel")" "$(json_str "$TOMFLY_LOG")"
    printf '  "dns": {\n'
    printf '    "servers": [\n'
    printf '      {"tag": "cn-dns", "type": "udp", "server": %s},\n' "$(json_str "$domestic")"
    printf '      {"tag": "remote-dns", "type": "tls", "server": %s, "detour": "PROXY"}' "$(json_str "$foreign")"
    if [ "$dns_mode" = "fake-ip" ]; then
        printf ',\n      {"tag": "fakeip", "type": "fakeip", "inet4_range": "198.18.0.1/16"}'
    fi
    printf '\n    ],\n'
    printf '    "rules": [\n'
    printf '      {"rule_set": "geosite-cn", "server": "cn-dns"}'
    if [ "$dns_mode" = "fake-ip" ]; then
        printf ',\n      {"query_type": ["A", "AAAA"], "server": "fakeip"}'
    fi
    printf '\n    ],\n'
    printf '    "final": "remote-dns"\n'
    printf '  },\n'
    printf '  "inbounds": [\n'
    printf '    {"type": "direct", "tag": "dns-in", "listen": "127.0.0.1", "listen_port": %s, "network": "udp"},\n' "$dns_port"
    if [ -n "${_singbox_tproxy_fallback:-}${TOMFLY_FORCE_TPROXY:-}" ]; then
        _emit_tproxy_inbound
        log_info "sing-box TPROXY fallback inbound written"
    else
        _emit_tun_inbound
    fi
    printf '  ],\n'
    printf '  "outbounds": [\n'

    local first=1
    while read -r sec; do
        [ -n "$sec" ] || continue
        [ "$first" = "0" ] && printf ',\n'
        emit_singbox_proxy "$sec"
        first=0
    done < "$usable"

    if [ -s "$names" ]; then
        [ "$first" = "0" ] && printf ',\n'
        printf '    {\n'
        printf '      "type": "urltest",\n'
        printf '      "tag": "AUTO",\n'
        printf '      "outbounds": ['
        _emit_json_name_array "$names"
        printf '\n      ],\n'
        printf '      "url": "http://www.gstatic.com/generate_204",\n'
        printf '      "interval": "5m",\n'
        printf '      "tolerance": 50\n'
        printf '    },\n'
        printf '    {\n'
        printf '      "type": "selector",\n'
        printf '      "tag": "PROXY",\n'
        printf '      "outbounds": [\n        "AUTO"'
        _emit_json_name_array "$names" 1
        printf ',\n        "DIRECT"\n'
        printf '      ],\n'
        printf '      "default": "AUTO"\n'
        printf '    }'
        first=0
    else
        default_policy="DIRECT"
        [ "$first" = "0" ] && printf ',\n'
        printf '    {"type": "direct", "tag": "PROXY"}'
        first=0
    fi

    printf ',\n    {"type": "direct", "tag": "DIRECT"}\n'
    printf '  ],\n'
    printf '  "route": {\n'
    # Stamp sing-box's own outbound sockets with fwmark 768 (matches mihomo's
    # routing-mark) so the nftables "meta mark 768 return" self-bypass also
    # covers sing-box. NOTE: the exact field name varies by sing-box version —
    # verify against the installed build (route.default_mark on current ones).
    printf '    "default_mark": 768,\n'
    printf '    "default_domain_resolver": "cn-dns",\n'
    printf '    "rules": [\n'
    printf '      {"action": "sniff"},\n'
    printf '      {"protocol": "dns", "action": "hijack-dns"},\n'
    printf '      {"ip_is_private": true, "outbound": "DIRECT"},\n'
    _emit_node_bypass_rules
    _emit_force_rules "PROXY" "${RULES_DIR}/force_proxy.txt"
    _emit_force_rules "DIRECT" "${RULES_DIR}/force_direct.txt"
    printf '      {"rule_set": "geoip-cn", "outbound": %s},\n' "$(json_str "$geoip_cn")"
    printf '      {"rule_set": "geosite-cn", "outbound": %s}\n' "$(json_str "$geosite_cn")"
    printf '    ],\n'
    printf '    "rule_set": [\n'
    _emit_singbox_rule_set "geoip-cn" \
        "https://cdn.jsdelivr.net/gh/SagerNet/sing-geoip@rule-set/geoip-cn.srs"
    printf ',\n'
    _emit_singbox_rule_set "geosite-cn" \
        "https://cdn.jsdelivr.net/gh/SagerNet/sing-geosite@rule-set/geosite-cn.srs"
    printf '\n'
    printf '    ],\n'
    printf '    "final": %s,\n' "$(json_str "$default_policy")"
    printf '    "auto_detect_interface": true\n'
    printf '  },\n'
    printf '  "experimental": {\n'
    printf '    "cache_file": {\n'
    printf '      "enabled": true,\n'
    printf '      "path": "%s/singbox-cache.db",\n' "$TOMFLY_RUN"
    printf '      "store_fakeip": true\n'
    printf '    },\n'
    printf '    "clash_api": {\n'
    printf '      "external_controller": "127.0.0.1:9090",\n'
    printf '      "default_mode": %s\n' "$(json_str "$sb_mode")"
    printf '    }\n'
    printf '  }\n'
    printf '}\n'

    rm -f "$usable" "$names"
}

write_config() {
    local outfile="${1:-$SINGBOX_CFG}"
    mkdir -p "$(dirname "$outfile")"
    generate_singbox_config > "$outfile"
    log_info "sing-box config written to $outfile"
}
