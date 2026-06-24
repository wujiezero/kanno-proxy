#!/bin/sh
# TomFly - dnsmasq integration

. /usr/lib/tomfly/common.sh

DNSMASQ_CONF="/tmp/dnsmasq.d/tomfly.conf"   # legacy path, cleaned up on teardown
DNS_PORT=1053   # mihomo/sing-box fake-ip DNS listen port
DNS_BACKUP="/var/run/tomfly/dns_backup"      # original dnsmasq state before takeover

# Modern OpenWrt/ImmortalWrt dnsmasq uses an INSTANCE-specific conf-dir
# (/tmp/dnsmasq.<id>.d), so dropping a file in /tmp/dnsmasq.d is silently
# ignored. Configure through UCI instead so the setting lands in dnsmasq's
# own generated config: forward every query to mihomo's fake-ip resolver.
setup_dns() {
    rm -f "$DNSMASQ_CONF" 2>/dev/null   # remove any stale legacy file

    # Save original dnsmasq state so teardown can restore it EXACTLY
    mkdir -p "$(dirname "$DNS_BACKUP")"
    {
        uci -q get dhcp.@dnsmasq[0].noresolv 2>/dev/null || echo "__UNSET__"
    } > "$DNS_BACKUP"

    uci -q del_list dhcp.@dnsmasq[0].server="127.0.0.1#${DNS_PORT}" 2>/dev/null
    uci add_list dhcp.@dnsmasq[0].server="127.0.0.1#${DNS_PORT}"
    uci set dhcp.@dnsmasq[0].noresolv='1'
    uci commit dhcp

    if /etc/init.d/dnsmasq restart 2>/dev/null; then
        log_info "dnsmasq configured for tomfly DNS (127.0.0.1#${DNS_PORT})"
    else
        log_warn "dnsmasq restart failed"
    fi
}

teardown_dns() {
    rm -f "$DNSMASQ_CONF" 2>/dev/null
    uci -q del_list dhcp.@dnsmasq[0].server="127.0.0.1#${DNS_PORT}" 2>/dev/null

    # Restore original noresolv state from backup
    local orig
    if [ -f "$DNS_BACKUP" ]; then
        orig=$(head -n1 "$DNS_BACKUP" 2>/dev/null)
        case "$orig" in
            __UNSET__|"")
                uci -q delete dhcp.@dnsmasq[0].noresolv 2>/dev/null
                ;;
            *)
                uci set dhcp.@dnsmasq[0].noresolv="$orig"
                ;;
        esac
        rm -f "$DNS_BACKUP" 2>/dev/null
    else
        # No backup — clean slate
        uci -q delete dhcp.@dnsmasq[0].noresolv 2>/dev/null
    fi
    uci commit dhcp
    if /etc/init.d/dnsmasq restart 2>/dev/null; then
        log_info "dnsmasq DNS restored"
    else
        log_warn "dnsmasq restart failed"
    fi
}
