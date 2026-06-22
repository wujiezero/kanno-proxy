#!/bin/sh
# KannoProxy - generate sing-box config.json from UCI

. /usr/lib/kanno/common.sh
. /usr/lib/kanno/capabilities.sh

_u() { uci -q get "kanno.$1" 2>/dev/null; }

json_str() { printf '"%s"' "$(echo "$1" | sed 's/"/\\"/g')"; }

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
        printf ',\n      "alter_id": %s' "${_u "${sec}.alter_id":-0}"
        printf ',\n      "security": %s' "$(json_str "${_u "${sec}.cipher":-auto}")"
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
            "$(json_str "$(_u "${sec}.sni")")" "$(json_str "${_u "${sec}.alpn":-h3}")"
        printf ',\n      "congestion_control": %s' "$(json_str "${_u "${sec}.cc":-bbr}")"
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
            printf '\n        "utls": {"enabled": true, "fingerprint": %s},' "$(json_str "${_u "${sec}.fp":-chrome}")"
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

generate_singbox_config() {
    local loglevel=$(_u "global.log_level"); loglevel="${loglevel:-info}"
    local ipv6=$(_u "global.ipv6"); ipv6="${ipv6:-false}"

    printf '{\n'
    printf '  "log": {"level": %s, "timestamp": true},\n' "$(json_str "$loglevel")"
    printf '  "dns": {\n'
    printf '    "servers": [\n'
    printf '      {"tag": "cn-dns", "address": "223.5.5.5", "detour": "DIRECT"},\n'
    printf '      {"tag": "remote-dns", "address": "tls://8.8.8.8", "detour": "PROXY"}\n'
    printf '    ],\n'
    printf '    "rules": [\n'
    printf '      {"rule_set": "geosite-cn", "server": "cn-dns"},\n'
    printf '      {"outbound": "any", "server": "cn-dns"}\n'
    printf '    ],\n'
    printf '    "final": "remote-dns",\n'
    printf '    "independent_cache": true\n'
    printf '  },\n'
    printf '  "inbounds": [\n'
    printf '    {"type": "tun", "tag": "tun-in", "interface_name": "Kanno", "inet4_address": "172.19.0.1/30", "auto_route": true, "strict_route": false, "stack": "system"}\n'
    printf '  ],\n'
    printf '  "outbounds": [\n'

    local first=1
    uci show kanno 2>/dev/null | grep "^kanno\.proxy_.*\.type=" | while read -r line; do
        local sec=$(echo "$line" | cut -d'.' -f2)
        [ "$(_u "${sec}.enabled")" = "0" ] && continue
        case " ${KANNO_EXCLUDE:-} " in
            *" $sec "*) log_warn "excluding node $(_u "${sec}.name"): failed config validation"; continue ;;
        esac
        local reason
        reason=$(kanno_node_incompat singbox "$sec") || { log_warn "skipping node $(_u "${sec}.name"): $reason"; continue; }
        [ "$first" = "0" ] && printf ','
        printf '\n'
        emit_singbox_proxy "$sec"
        first=0
    done

    printf ',\n    {"type": "direct", "tag": "DIRECT"},\n'
    printf '    {"type": "block", "tag": "BLOCK"},\n'
    printf '    {"type": "dns", "tag": "dns-out"}\n'
    printf '  ],\n'
    printf '  "route": {\n'
    printf '    "rules": [\n'
    printf '      {"protocol": "dns", "outbound": "dns-out"},\n'
    printf '      {"ip_is_private": true, "outbound": "DIRECT"},\n'
    printf '      {"rule_set": "geoip-cn", "outbound": "DIRECT"},\n'
    printf '      {"rule_set": "geosite-cn", "outbound": "DIRECT"}\n'
    printf '    ],\n'
    printf '    "final": "PROXY",\n'
    printf '    "auto_detect_interface": true\n'
    printf '  }\n'
    printf '}\n'
}

write_config() {
    local outfile="${1:-$SINGBOX_CFG}"
    mkdir -p "$(dirname "$outfile")"
    generate_singbox_config > "$outfile"
    log_info "sing-box config written to $outfile"
}
