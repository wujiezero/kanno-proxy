#!/bin/sh
# KannoProxy - nftables transparent proxy rules (TUN mode)

. /usr/lib/kanno/common.sh

NFT_TABLE="kanno"
MARK_BYPASS=0x100
MARK_ROUTE=0x200

nft_add() { nft add "$@" 2>/dev/null; }

# IP sets for bypass / force-direct
PRIVATE_NETS="{ 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 224.0.0.0/4, 240.0.0.0/4 }"

load_nftables() {
    nft delete table inet "$NFT_TABLE" 2>/dev/null

    nft -f - <<-NFT
table inet ${NFT_TABLE} {
    set bypass_ip4 {
        type ipv4_addr
        flags interval
        elements = ${PRIVATE_NETS}
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

    # Mangle for TPROXY (UDP pass-through when needed)
    chain prerouting_mangle {
        type filter hook prerouting priority mangle; policy accept;
        ip daddr @bypass_ip4 return
        ip daddr @force_direct_ip4 return
        ip daddr @force_proxy_ip4 meta l4proto tcp tproxy to 127.0.0.1:7893 meta mark set ${MARK_ROUTE} accept
        ip daddr @force_proxy_ip4 meta l4proto udp tproxy to 127.0.0.1:7893 meta mark set ${MARK_ROUTE} accept
        ip daddr @cn_ip4 return
        meta l4proto tcp tproxy to 127.0.0.1:7893 meta mark set ${MARK_ROUTE}
        meta l4proto udp tproxy to 127.0.0.1:7893 meta mark set ${MARK_ROUTE}
    }

    # Skip traffic from kanno itself (TUN outbound)
    chain output_mangle {
        type route hook output priority mangle; policy accept;
        meta skgid 53690 return comment "kanno process bypass"
        ip daddr @bypass_ip4 return
        ip daddr @force_direct_ip4 return
        ip daddr @force_proxy_ip4 meta mark set ${MARK_ROUTE}
        ip daddr @cn_ip4 return
        meta l4proto { tcp, udp } meta mark set ${MARK_ROUTE}
    }
}
NFT
    log_info "nftables rules loaded"
}

add_force_proxy_ip() {
    local ip="$1"
    nft add element inet "$NFT_TABLE" force_proxy_ip4 "{ $ip }" 2>/dev/null
}

add_force_direct_ip() {
    local ip="$1"
    nft add element inet "$NFT_TABLE" force_direct_ip4 "{ $ip }" 2>/dev/null
}

add_cn_ip() {
    local ip="$1"
    nft add element inet "$NFT_TABLE" cn_ip4 "{ $ip }" 2>/dev/null
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
    log_info "custom IP rules loaded"
}

unload_nftables() {
    nft delete table inet "$NFT_TABLE" 2>/dev/null && log_info "nftables rules removed"
}

setup_routing() {
    # Policy routing: packets marked with MARK_ROUTE go through tun device
    ip rule del fwmark "$MARK_ROUTE" table 100 2>/dev/null
    ip route del local default dev lo table 100 2>/dev/null
    ip rule add fwmark "$MARK_ROUTE" table 100
    ip route add local default dev lo table 100
    log_info "policy routing configured"
}

teardown_routing() {
    ip rule del fwmark "$MARK_ROUTE" table 100 2>/dev/null
    ip route del local default dev lo table 100 2>/dev/null
    log_info "policy routing removed"
}
