#!/bin/sh
# KannoProxy - dnsmasq integration

. /usr/lib/kanno/common.sh

DNSMASQ_CONF="/tmp/dnsmasq.d/kanno.conf"
DNS_PORT=1053   # mihomo/sing-box fake-ip DNS listen port

setup_dns() {
    mkdir -p /tmp/dnsmasq.d

    cat > "$DNSMASQ_CONF" <<-EOF
# KannoProxy DNS config - auto generated
no-resolv
server=127.0.0.1#${DNS_PORT}
min-cache-ttl=3600
EOF

    # Reload dnsmasq
    if /etc/init.d/dnsmasq reload 2>/dev/null; then
        log_info "dnsmasq reloaded with kanno DNS"
    else
        log_warn "dnsmasq reload failed; trying kill -HUP"
        killall -HUP dnsmasq 2>/dev/null
    fi
}

teardown_dns() {
    rm -f "$DNSMASQ_CONF"
    if /etc/init.d/dnsmasq reload 2>/dev/null; then
        log_info "dnsmasq restored"
    else
        killall -HUP dnsmasq 2>/dev/null
    fi
}
