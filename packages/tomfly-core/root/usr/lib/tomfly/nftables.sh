#!/bin/sh
# TomFly - nftables transparent proxy rules (TPROXY mode)
# Supports dual-stack IPv4 + IPv6 when global.ipv6=1.

. /usr/lib/tomfly/common.sh

NFT_TABLE="tomfly"
MARK_BYPASS=0x100
MARK_ROUTE=0x200
# Must equal `routing-mark` in gen_mihomo.sh (768). The kernel stamps every one
# of its own outbound sockets with this fwmark; we return early on it so the
# kernel's DNS lookups and DIRECT connections are never redirected back into
# tproxy (which would loop infinitely).
MARK_SELF=768

nft_add() { nft add "$@" 2>/dev/null; }

# IP sets for bypass / force-direct
PRIVATE_NETS_4="{ 10.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 224.0.0.0/4, 240.0.0.0/4 }"
PRIVATE_NETS_6="{ fc00::/7, fe80::/10, ff00::/8 }"

# Whether to include IPv6 rules
_ipv6_enabled() {
    [ "$(uci -q get tomfly.global.ipv6 2>/dev/null)" = "1" ]
}

load_nftables() {
    nft delete table inet "$NFT_TABLE" 2>/dev/null

    local ipv6_block=""
    if _ipv6_enabled; then
        ipv6_block="
    set bypass_ip6 {
        type ipv6_addr
        flags interval
        elements = ${PRIVATE_NETS_6}
    }

    set force_proxy_ip6 {
        type ipv6_addr
        flags interval
    }

    set force_direct_ip6 {
        type ipv6_addr
        flags interval
    }

    set cn_ip6 {
        type ipv6_addr
        flags interval
    }

    set lan_clients6 {
        type ipv6_addr
        flags interval
    }

    # IPv6 prerouting — tproxy on TPROXY port
    chain prerouting_mangle6 {
        type filter hook prerouting priority mangle; policy accept;
        ip6 daddr @bypass_ip6 return
        ip6 daddr @force_direct_ip6 return
        ip6 daddr @force_proxy_ip6 meta l4proto tcp tproxy ip6 to [::1]:7893 meta mark set ${MARK_ROUTE} accept
        ip6 daddr @force_proxy_ip6 meta l4proto udp tproxy ip6 to [::1]:7893 meta mark set ${MARK_ROUTE} accept
        ip6 daddr @cn_ip6 return
        meta l4proto tcp tproxy ip6 to [::1]:7893 meta mark set ${MARK_ROUTE}
        meta l4proto udp tproxy ip6 to [::1]:7893 meta mark set ${MARK_ROUTE}
    }

    # IPv6 output — skip tomfly self-traffic, proxy the rest
    chain output_mangle6 {
        type route hook output priority mangle; policy accept;
        meta mark ${MARK_SELF} return
        ip6 daddr @bypass_ip6 return
        ip6 daddr @force_direct_ip6 return
        ip6 daddr @force_proxy_ip6 meta mark set ${MARK_ROUTE}
        ip6 daddr @cn_ip6 return
        meta l4proto { tcp, udp } meta mark set ${MARK_ROUTE}
    }"
    fi

    nft -f - <<-NFT
table inet ${NFT_TABLE} {
    set bypass_ip4 {
        type ipv4_addr
        flags interval
        elements = ${PRIVATE_NETS_4}
    }

    set force_proxy_ip4 {
        type ipv4_addr
        flags interval
    }

    set force_direct_ip4 {
        type ipv4_addr
        flags interval
    }

    set cn_ip4 {
        type ipv4_addr
        flags interval
    }

    set lan_clients4 {
        type ipv4_addr
        flags interval
    }
${ipv6_block}
    # IPv4 prerouting — tproxy on TPROXY port (7893)
    chain prerouting_mangle4 {
        type filter hook prerouting priority mangle; policy accept;
        ip daddr @bypass_ip4 return
        ip daddr @force_direct_ip4 return
        ip daddr @force_proxy_ip4 meta l4proto tcp tproxy ip to 127.0.0.1:7893 meta mark set ${MARK_ROUTE} accept
        ip daddr @force_proxy_ip4 meta l4proto udp tproxy ip to 127.0.0.1:7893 meta mark set ${MARK_ROUTE} accept
        ip daddr @cn_ip4 return
        meta l4proto tcp tproxy ip to 127.0.0.1:7893 meta mark set ${MARK_ROUTE}
        meta l4proto udp tproxy ip to 127.0.0.1:7893 meta mark set ${MARK_ROUTE}
    }

    # IPv4 output — skip tomfly self-traffic, proxy the rest
    chain output_mangle4 {
        type route hook output priority mangle; policy accept;
        meta mark ${MARK_SELF} return comment "tomfly kernel self-traffic bypass"
        ip daddr @bypass_ip4 return
        ip daddr @force_direct_ip4 return
        ip daddr @force_proxy_ip4 meta mark set ${MARK_ROUTE}
        ip daddr @cn_ip4 return
        meta l4proto { tcp, udp } meta mark set ${MARK_ROUTE}
    }

    # LAN access-control: drop proxy-eligible traffic from excluded clients.
    # Populate lan_clients4 / lan_clients6 with IPs that should NOT use the
    # proxy (e.g. a smart-TV or IoT device that needs a direct connection).
    # If the sets are empty (default), this chain is a no-op.
    chain prerouting_acl {
        type filter hook prerouting priority raw - 10; policy accept;
        ip saddr @lan_clients4 return
        ip6 saddr @lan_clients6 return
    }
}
NFT
    log_info "nftables rules loaded"
}

add_force_proxy_ip() {
    local ip="$1"
    case "$ip" in
        *:*) nft add element inet "$NFT_TABLE" force_proxy_ip6 "{ $ip }" 2>/dev/null ;;
        *)   nft add element inet "$NFT_TABLE" force_proxy_ip4 "{ $ip }" 2>/dev/null ;;
    esac
}

add_force_direct_ip() {
    local ip="$1"
    case "$ip" in
        *:*) nft add element inet "$NFT_TABLE" force_direct_ip6 "{ $ip }" 2>/dev/null ;;
        *)   nft add element inet "$NFT_TABLE" force_direct_ip4 "{ $ip }" 2>/dev/null ;;
    esac
}

add_cn_ip() {
    local ip="$1"
    case "$ip" in
        *:*) nft add element inet "$NFT_TABLE" cn_ip6 "{ $ip }" 2>/dev/null ;;
        *)   nft add element inet "$NFT_TABLE" cn_ip4 "{ $ip }" 2>/dev/null ;;
    esac
}

add_bypass_ip() {
    local ip="$1"
    case "$ip" in
        *:*) nft add element inet "$NFT_TABLE" bypass_ip6 "{ $ip }" 2>/dev/null ;;
        *)   nft add element inet "$NFT_TABLE" bypass_ip4 "{ $ip }" 2>/dev/null ;;
    esac
}

add_lan_client() {
    local ip="$1"
    case "$ip" in
        *:*) nft add element inet "$NFT_TABLE" lan_clients6 "{ $ip }" 2>/dev/null ;;
        *)   nft add element inet "$NFT_TABLE" lan_clients4 "{ $ip }" 2>/dev/null ;;
    esac
}

# Bypass proxy node server IPs so the kernel's own outbound connection to a
# node is reached DIRECTLY and never re-proxied through tproxy. Without this
# the kernel connecting to its own upstream loops infinitely back into 7893.
bypass_node_servers() {
    local ip
    for ip in $(list_node_server_ips); do
        add_bypass_ip "$ip"
    done
    for ip in $(list_node_server_ips6); do
        add_bypass_ip "$ip"
    done
    log_info "node server IPs bypassed (loop prevention)"
}

# Load custom rule lists into nftables sets
load_custom_rules() {
    [ -f "${RULES_DIR}/force_proxy_ip.txt" ] && \
        grep -v '^#' "${RULES_DIR}/force_proxy_ip.txt" | grep -v '^$' | while read -r ip; do
            add_force_proxy_ip "$ip"
        done
    [ -f "${RULES_DIR}/force_direct_ip.txt" ] && \
        grep -v '^#' "${RULES_DIR}/force_direct_ip.txt" | grep -v '^$' | while read -r ip; do
            add_force_direct_ip "$ip"
        done
    [ -f "${RULES_DIR}/lan_clients.txt" ] && \
        grep -v '^#' "${RULES_DIR}/lan_clients.txt" | grep -v '^$' | while read -r ip; do
            add_lan_client "$ip"
        done
    bypass_node_servers
    log_info "custom IP rules loaded"
}

unload_nftables() {
    nft delete table inet "$NFT_TABLE" 2>/dev/null && log_info "nftables rules removed"
}

setup_routing() {
    # Policy routing for IPv4
    ip rule del fwmark "$MARK_ROUTE" table 100 2>/dev/null
    ip route del local default dev lo table 100 2>/dev/null
    ip rule add fwmark "$MARK_ROUTE" table 100
    ip route add local default dev lo table 100

    # Policy routing for IPv6
    if _ipv6_enabled; then
        ip -6 rule del fwmark "$MARK_ROUTE" table 100 2>/dev/null
        ip -6 route del local default dev lo table 100 2>/dev/null
        ip -6 rule add fwmark "$MARK_ROUTE" table 100
        ip -6 route add local default dev lo table 100
    fi
    log_info "policy routing configured"
}

teardown_routing() {
    ip rule del fwmark "$MARK_ROUTE" table 100 2>/dev/null
    ip route del local default dev lo table 100 2>/dev/null
    ip -6 rule del fwmark "$MARK_ROUTE" table 100 2>/dev/null
    ip -6 route del local default dev lo table 100 2>/dev/null
    log_info "policy routing removed"
}
