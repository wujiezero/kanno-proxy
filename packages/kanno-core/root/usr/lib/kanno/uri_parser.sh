#!/bin/sh
# KannoProxy - URI parser for proxy node URIs
# Supports: vless, vmess, trojan, ss, hy2/hysteria2, tuic, naive+https

. /usr/lib/kanno/common.sh

urldecode() {
    local v="$1"
    v=$(printf '%b' "$(echo "$v" | sed 's/%/\\x/g; s/+/ /g')")
    echo "$v"
}

_qget() {
    echo "$1" | tr '&' '\n' | grep "^${2}=" | head -1 | cut -d'=' -f2- | \
        { read v; urldecode "$v"; }
}

parse_vless() {
    local uri="$1"
    local frag body userhost params uuid host port

    frag=$(echo "$uri" | sed 's/.*#//')
    frag=$(urldecode "$frag")
    body=$(echo "$uri" | sed 's/#.*//' | sed 's|^vless://||')

    uuid=$(echo "$body" | cut -d'@' -f1)
    userhost=$(echo "$body" | cut -d'@' -f2-)
    host=$(echo "$userhost" | cut -d'?' -f1 | rev | cut -d':' -f2- | rev)
    port=$(echo "$userhost" | cut -d'?' -f1 | rev | cut -d':' -f1 | rev)
    params=$(echo "$userhost" | grep -o '?.*' | cut -c2-)

    echo "type=vless"
    echo "name=$(urldecode "$frag")"
    echo "server=$host"
    echo "port=$port"
    echo "uuid=$uuid"
    echo "encryption=$(_qget "$params" encryption)"
    echo "flow=$(_qget "$params" flow)"
    echo "security=$(_qget "$params" security)"
    echo "sni=$(_qget "$params" sni)"
    echo "fp=$(_qget "$params" fp)"
    echo "pbk=$(_qget "$params" pbk)"
    echo "sid=$(_qget "$params" sid)"
    echo "transport=$(_qget "$params" type)"
    echo "transport_host=$(_qget "$params" host)"
    echo "transport_path=$(_qget "$params" path)"
    echo "transport_svcname=$(_qget "$params" serviceName)"
}

parse_vmess() {
    local uri="$1"
    local encoded json

    encoded=$(echo "$uri" | sed 's|^vmess://||')
    # pad base64
    local pad=$(( 4 - ${#encoded} % 4 ))
    [ "$pad" -ne 4 ] && encoded="${encoded}$(printf '=%.0s' $(seq 1 $pad))"
    json=$(echo "$encoded" | base64 -d 2>/dev/null)

    _jf() { echo "$json" | jsonfilter -e "@.$1" 2>/dev/null; }

    local tls=$(_jf tls)
    echo "type=vmess"
    echo "name=$(_jf ps)"
    echo "server=$(_jf add)"
    echo "port=$(_jf port)"
    echo "uuid=$(_jf id)"
    echo "alter_id=$(_jf aid)"
    echo "cipher=${_jf:-auto}"
    echo "transport=$(_jf net)"
    echo "transport_host=$(_jf host)"
    echo "transport_path=$(_jf path)"
    echo "transport_headers=$(_jf headers)"
    echo "security=$( [ "$tls" = "tls" ] && echo tls || echo none)"
    echo "sni=$(_jf sni)"
    echo "fp=$(_jf fp)"
}

parse_trojan() {
    local uri="$1"
    local frag body userhost params password host port

    frag=$(urldecode "$(echo "$uri" | sed 's/.*#//')")
    body=$(echo "$uri" | sed 's/#.*//' | sed 's|^trojan://||')
    password=$(echo "$body" | cut -d'@' -f1)
    userhost=$(echo "$body" | cut -d'@' -f2-)
    host=$(echo "$userhost" | cut -d'?' -f1 | rev | cut -d':' -f2- | rev)
    port=$(echo "$userhost" | cut -d'?' -f1 | rev | cut -d':' -f1 | rev)
    params=$(echo "$userhost" | grep -o '?.*' | cut -c2-)

    echo "type=trojan"
    echo "name=$frag"
    echo "server=$host"
    echo "port=$port"
    echo "password=$password"
    echo "sni=$(_qget "$params" sni)"
    echo "security=tls"
    echo "transport=$(_qget "$params" type)"
    echo "transport_path=$(_qget "$params" path)"
    echo "insecure=$(_qget "$params" allowInsecure)"
    echo "fp=$(_qget "$params" fp)"
}

parse_ss() {
    local uri="$1"
    local frag body userinfo hostport method password host port

    frag=$(urldecode "$(echo "$uri" | sed 's/.*#//')")
    body=$(echo "$uri" | sed 's/#.*//' | sed 's|^ss://||' | cut -d'?' -f1)

    if echo "$body" | grep -q '@'; then
        userinfo=$(echo "$body" | cut -d'@' -f1)
        hostport=$(echo "$body" | cut -d'@' -f2-)
        local dec=$(echo "$userinfo" | base64 -d 2>/dev/null)
        if echo "$dec" | grep -q ':'; then
            method=$(echo "$dec" | cut -d':' -f1)
            password=$(echo "$dec" | cut -d':' -f2-)
        else
            method=$(echo "$userinfo" | cut -d':' -f1)
            password=$(echo "$userinfo" | cut -d':' -f2-)
        fi
    else
        local dec=$(echo "$body" | base64 -d 2>/dev/null)
        method=$(echo "$dec" | cut -d':' -f1)
        local rest=$(echo "$dec" | cut -d':' -f2-)
        password=$(echo "$rest" | cut -d'@' -f1)
        hostport=$(echo "$rest" | cut -d'@' -f2-)
    fi

    host=$(echo "$hostport" | rev | cut -d':' -f2- | rev)
    port=$(echo "$hostport" | rev | cut -d':' -f1 | rev)

    echo "type=ss"
    echo "name=$frag"
    echo "server=$host"
    echo "port=$port"
    echo "method=$method"
    echo "password=$password"
}

parse_hy2() {
    local uri="$1"
    local frag body password hostport params host port

    frag=$(urldecode "$(echo "$uri" | sed 's/.*#//')")
    body=$(echo "$uri" | sed 's/#.*//' | sed 's|^hy[a-z0-9]*://||')
    password=$(echo "$body" | cut -d'@' -f1)
    hostport=$(echo "$body" | cut -d'@' -f2- | cut -d'?' -f1)
    params=$(echo "$body" | grep -o '?.*' | cut -c2-)
    host=$(echo "$hostport" | rev | cut -d':' -f2- | rev)
    port=$(echo "$hostport" | rev | cut -d':' -f1 | rev)

    echo "type=hy2"
    echo "name=$frag"
    echo "server=$host"
    echo "port=$port"
    echo "password=$password"
    echo "sni=$(_qget "$params" sni)"
    echo "insecure=$(_qget "$params" insecure)"
    echo "obfs=$(_qget "$params" obfs)"
    echo "obfs_password=$(_qget "$params" obfs-password)"
}

parse_tuic() {
    local uri="$1"
    local frag body userinfo hostport params uuid password host port

    frag=$(urldecode "$(echo "$uri" | sed 's/.*#//')")
    body=$(echo "$uri" | sed 's/#.*//' | sed 's|^tuic://||')
    userinfo=$(echo "$body" | cut -d'@' -f1)
    hostport=$(echo "$body" | cut -d'@' -f2- | cut -d'?' -f1)
    params=$(echo "$body" | grep -o '?.*' | cut -c2-)
    uuid=$(echo "$userinfo" | cut -d':' -f1)
    password=$(echo "$userinfo" | cut -d':' -f2-)
    host=$(echo "$hostport" | rev | cut -d':' -f2- | rev)
    port=$(echo "$hostport" | rev | cut -d':' -f1 | rev)

    echo "type=tuic"
    echo "name=$frag"
    echo "server=$host"
    echo "port=$port"
    echo "uuid=$uuid"
    echo "password=$password"
    echo "sni=$(_qget "$params" sni)"
    echo "alpn=$(_qget "$params" alpn)"
    echo "cc=$(_qget "$params" congestion_control)"
    echo "insecure=$(_qget "$params" allow_insecure)"
}

parse_naive() {
    local uri="$1"
    local frag body userinfo hostport user password host port

    frag=$(urldecode "$(echo "$uri" | sed 's/.*#//')")
    body=$(echo "$uri" | sed 's/#.*//' | sed 's|^naive+https://||')
    userinfo=$(echo "$body" | cut -d'@' -f1)
    hostport=$(echo "$body" | cut -d'@' -f2-)
    user=$(echo "$userinfo" | cut -d':' -f1)
    password=$(echo "$userinfo" | cut -d':' -f2-)
    host=$(echo "$hostport" | rev | cut -d':' -f2- | rev)
    port=$(echo "$hostport" | rev | cut -d':' -f1 | rev)

    echo "type=naive"
    echo "name=$frag"
    echo "server=$host"
    echo "port=$port"
    echo "username=$user"
    echo "password=$password"
}

# Detect scheme and dispatch
parse_uri() {
    local uri="$1"
    case "$uri" in
        vless://*)         parse_vless "$uri" ;;
        vmess://*)         parse_vmess "$uri" ;;
        trojan://*)        parse_trojan "$uri" ;;
        ss://*)            parse_ss "$uri" ;;
        hy2://*)           parse_hy2 "$uri" ;;
        hysteria2://*)     parse_hy2 "$uri" ;;
        tuic://*)          parse_tuic "$uri" ;;
        naive+https://*)   parse_naive "$uri" ;;
        *) log_error "unsupported URI scheme: ${uri%%://*}"; return 1 ;;
    esac
}

# Parse URI and store to UCI; echo the node section id
uri_to_uci() {
    local uri="$1"
    local id section parsed

    parsed=$(parse_uri "$uri") || return 1
    id=$(kanno_gen_id)
    section="proxy_${id}"

    uci batch <<-EOF
		set kanno.${section}=proxy
		set kanno.${section}.enabled=1
	EOF

    echo "$parsed" | while IFS='=' read -r k v; do
        [ -z "$k" ] && continue
        uci -q set "kanno.${section}.${k}=${v}"
    done
    uci commit kanno
    echo "$id"
}
