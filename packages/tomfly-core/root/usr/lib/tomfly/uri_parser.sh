#!/bin/sh
# TomFly - URI parser for proxy node URIs
# Supports: vless, vmess, trojan, ss, hy2/hysteria2, tuic, naive+https

. /usr/lib/tomfly/common.sh

urldecode() {
    # Safe percent-decode: replaces %XX with the corresponding byte using awk.
    # Unlike printf '%b', this does not misinterpret literal backslash sequences
    # in the decoded output.  + → space is applied first.
    echo "$1" | sed 's/+/ /g' | awk '
    function hex2dec(h) {
        return index("0123456789ABCDEF", toupper(h)) - 1
    }
    {
        line = $0; result = ""
        while (match(line, /%[0-9a-fA-F][0-9a-fA-F]/)) {
            result = result substr(line, 1, RSTART - 1)
            result = result sprintf("%c", hex2dec(substr(line, RSTART+1, 1)) * 16 + hex2dec(substr(line, RSTART+2, 1)))
            line = substr(line, RSTART + 3)
        }
        print result line
    }'
}

_qget() {
    echo "$1" | tr '&' '\n' | grep "^${2}=" | head -1 | cut -d'=' -f2- | \
        { read v; urldecode "$v"; }
}

_b64_decode() {
    local b64="$1" pad

    b64=$(echo "$b64" | tr '_-' '/+')
    pad=$(( 4 - ${#b64} % 4 ))
    [ "$pad" -ne 4 ] && b64="${b64}$(printf '=%.0s' $(seq 1 $pad))"
    echo "$b64" | base64 -d 2>/dev/null
}

# Split host:port on LAST colon (POSIX, no 'rev')
_hostport() {
    _HP_HOST=${1%:*}
    _HP_PORT=${1##*:}
}

parse_vless() {
    local uri="$1"
    local frag body authority decoded userhost params uuid host port
    local encryption flow security sni fp pbk sid tls xtls

    case "$uri" in
        *#*) frag=$(echo "$uri" | sed 's/.*#//'); frag=$(urldecode "$frag") ;;
        *)   frag="" ;;
    esac
    body=$(echo "$uri" | sed 's/#.*//' | sed 's|^vless://||')
    case "$body" in
        *\?*) authority=${body%%\?*}; params=${body#*\?} ;;
        *)    authority=$body; params="" ;;
    esac

    case "$authority" in
        *@*) ;;
        *)
            decoded=$(_b64_decode "$authority")
            case "$decoded" in *@*) authority=$decoded ;; esac
            ;;
    esac

    uuid=${authority%%@*}
    userhost=${authority#*@}
    encryption=$(_qget "$params" encryption)
    case "$uuid" in
        *:*)
            [ -z "$encryption" ] && encryption=${uuid%%:*}
            uuid=${uuid#*:}
            ;;
    esac

    _hostport "$userhost"
    host=$_HP_HOST; port=$_HP_PORT

    [ -n "$frag" ] || frag=$(_qget "$params" remarks)
    [ -n "$frag" ] || frag=$(_qget "$params" name)
    flow=$(_qget "$params" flow)
    xtls=$(_qget "$params" xtls)
    [ -z "$flow" ] && [ "$xtls" = "2" ] && flow="xtls-rprx-vision"
    pbk=$(_qget "$params" pbk)
    sid=$(_qget "$params" sid)
    security=$(_qget "$params" security)
    tls=$(_qget "$params" tls)
    if [ -z "$security" ]; then
        if [ -n "$pbk" ] || [ "$xtls" = "2" ]; then
            security="reality"
        elif [ "$tls" = "1" ] || [ "$tls" = "true" ] || [ "$tls" = "tls" ]; then
            security="tls"
        fi
    fi
    sni=$(_qget "$params" sni)
    [ -n "$sni" ] || sni=$(_qget "$params" peer)
    fp=$(_qget "$params" fp)
    [ -n "$fp" ] || fp=$(_qget "$params" fingerprint)

    echo "type=vless"
    echo "name=$frag"
    echo "server=$host"
    echo "port=$port"
    echo "uuid=$uuid"
    echo "encryption=$encryption"
    echo "flow=$flow"
    echo "security=$security"
    echo "sni=$sni"
    echo "fp=$fp"
    echo "pbk=$pbk"
    echo "sid=$sid"
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
    local cipher; cipher=$(_jf cipher)
    echo "cipher=${cipher:-auto}"
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
    _hostport "$(echo "$userhost" | cut -d'?' -f1)"
    host=$_HP_HOST; port=$_HP_PORT
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
        case "$userinfo" in
        *%*)
            # percent-encoded "method:password" (some SIP002 providers)
            local ui=$(urldecode "$userinfo")
            method=${ui%%:*}; password=${ui#*:}
            ;;
        *:*)
            # plaintext "method:password"
            method=${userinfo%%:*}; password=${userinfo#*:}
            ;;
        *)
            # base64("method:password"), pad to a multiple of 4
            local b64="$userinfo"
            local pad=$(( 4 - ${#b64} % 4 )); [ "$pad" -ne 4 ] && b64="${b64}$(printf '=%.0s' $(seq 1 $pad))"
            local dec=$(echo "$b64" | base64 -d 2>/dev/null)
            method=${dec%%:*}; password=${dec#*:}
            ;;
        esac
    else
        local dec=$(echo "$body" | base64 -d 2>/dev/null)
        method=$(echo "$dec" | cut -d':' -f1)
        local rest=$(echo "$dec" | cut -d':' -f2-)
        password=$(echo "$rest" | cut -d'@' -f1)
        hostport=$(echo "$rest" | cut -d'@' -f2-)
    fi

    _hostport "$hostport"
    host=$_HP_HOST; port=$_HP_PORT

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
    _hostport "$hostport"
    host=$_HP_HOST; port=$_HP_PORT

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
    _hostport "$hostport"
    host=$_HP_HOST; port=$_HP_PORT

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
    _hostport "$hostport"
    host=$_HP_HOST; port=$_HP_PORT

    echo "type=naive"
    echo "name=$frag"
    echo "server=$host"
    echo "port=$port"
    echo "username=$user"
    echo "password=$password"
}

parse_anytls() {
    local uri="$1"
    local frag body password hostport params host port

    frag=$(urldecode "$(echo "$uri" | sed 's/.*#//')")
    body=$(echo "$uri" | sed 's/#.*//' | sed 's|^anytls://||')
    password=$(urldecode "$(echo "$body" | cut -d'@' -f1)")
    hostport=$(echo "$body" | cut -d'@' -f2- | cut -d'?' -f1 | sed 's|/$||')
    params=$(echo "$body" | grep -o '?.*' | cut -c2-)
    _hostport "$hostport"
    host=$_HP_HOST; port=$_HP_PORT

    echo "type=anytls"
    echo "name=$frag"
    echo "server=$host"
    echo "port=$port"
    echo "password=$password"
    echo "security=$(_qget "$params" security)"
    echo "sni=$(_qget "$params" sni)"
    echo "fp=$(_qget "$params" fp)"
    echo "pbk=$(_qget "$params" pbk)"
    echo "sid=$(_qget "$params" sid)"
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
        anytls://*)        parse_anytls "$uri" ;;
        *) log_error "unsupported URI scheme: ${uri%%://*}"; return 1 ;;
    esac
}

# Parse URI and store to UCI; echo the node section id
uri_to_uci() {
    local uri="$1"
    local id section parsed max_order

    parsed=$(parse_uri "$uri") || return 1
    id=$(tomfly_gen_id)
    section="proxy_${id}"

    # Assign next available order value
    max_order=$(uci show tomfly 2>/dev/null | sed -n "s/^tomfly\.proxy_[0-9a-f]*\.order='*//p" | sed "s/'*$//" | sort -n | tail -1)
    max_order="${max_order:-0}"
    max_order=$(( max_order + 1 ))

    uci batch <<-EOF
		set tomfly.${section}=proxy
		set tomfly.${section}.enabled=1
		set tomfly.${section}.order=${max_order}
	EOF

    echo "$parsed" | while IFS='=' read -r k v; do
        [ -z "$k" ] && continue
        uci -q set "tomfly.${section}.${k}=${v}"
    done
    uci commit tomfly
    echo "$id"
}
