#!/bin/sh
# KannoProxy - kernel protocol capability matrix.
#
# Single source of truth for which kernel supports which proxy protocols (and
# which protocol+feature combinations). Config generation consults this so an
# unsupported node is SKIPPED instead of being written into the kernel config —
# where a single unsupported node makes the whole kernel refuse to start.
#
# Sources (verified against upstream docs):
#   - mihomo wiki:  vless/vmess/trojan/ss/hysteria2/tuic/anytls supported.
#                   "Mihomo does not support the AnyTLS+Reality combination."
#   - sing-box docs: vless/vmess/trojan/shadowsocks/hysteria2/tuic/anytls
#                    supported; anytls TLS block may carry reality.
#   - naive: neither kernel ships a naive OUTBOUND (needs the standalone
#            naiveproxy client), so it is unsupported by both here.

# Space-delimited list of proxy `type` values each kernel can use as an outbound.
KANNO_CAP_MIHOMO="vless vmess trojan ss hysteria2 hy2 tuic anytls"
KANNO_CAP_SINGBOX="vless vmess trojan ss hysteria2 hy2 tuic anytls"

# kanno_kernel_supports <kernel> <type> -> returns 0 if the protocol is supported
kanno_kernel_supports() {
    local list
    case "$1" in
        singbox) list=" ${KANNO_CAP_SINGBOX} " ;;
        *)       list=" ${KANNO_CAP_MIHOMO} " ;;
    esac
    case "$list" in
        *" $2 "*) return 0 ;;
        *)        return 1 ;;
    esac
}

# kanno_node_incompat <kernel> <uci-section>
#
# Echoes a human-readable reason and returns 1 when the node is INCOMPATIBLE
# with the kernel; prints nothing and returns 0 when the node is usable.
# Catches both unsupported protocols and unsupported feature combinations that
# pass a plain `-t` config check but fail at runtime (e.g. mihomo anytls+reality).
kanno_node_incompat() {
    local kernel="$1" sec="$2" type security
    type=$(uci -q get "kanno.${sec}.type" 2>/dev/null)
    security=$(uci -q get "kanno.${sec}.security" 2>/dev/null)

    [ -z "$type" ] && { echo "missing protocol type"; return 1; }

    if ! kanno_kernel_supports "$kernel" "$type"; then
        echo "${kernel} has no '${type}' outbound"
        return 1
    fi

    # Protocol supported, but this specific option combination is not.
    if [ "$kernel" != "singbox" ] && [ "$type" = "anytls" ] && [ "$security" = "reality" ]; then
        echo "mihomo does not support anytls+reality — use sing-box, or a vless/trojan reality node"
        return 1
    fi

    return 0
}
