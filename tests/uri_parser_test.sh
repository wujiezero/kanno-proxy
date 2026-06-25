#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PARSER="${ROOT}/packages/tomfly-core/root/usr/lib/tomfly/uri_parser.sh"

run_parser() {
    (
        sed 's|^\. /usr/lib/tomfly/common.sh$|log_error() { echo "$*" >&2; }|' "$PARSER"
        printf '\nparse_uri "$1"\n'
    ) | sh -s -- "$1"
}

assert_line() {
    haystack="$1"
    needle="$2"
    if ! printf '%s\n' "$haystack" | grep -Fqx "$needle"; then
        printf 'missing line: %s\nactual output:\n%s\n' "$needle" "$haystack" >&2
        return 1
    fi
}

legacy_vless='vless://YXV0bzpDNzBBNTdCMi01MUVGLTRBQUYtQTQ5Mi0xMDkyNzI3QzZFMDhANjkuNjMuMjExLjg6NDQz?remarks=%E4%B8%93%E5%B1%9E%E7%BA%AF%E5%87%80%E9%9D%99%E6%80%81%E4%BD%8F%E5%AE%85%E8%8A%82%E7%82%B9&tls=1&peer=www.cooper.edu&udp=1&xtls=2&pbk=RUnUX88Oy52Ijgm6JCbHBLcLcrRxzmIHVz1qUFcm0g0&sid=d8456744455b0dc3&fingerprint=chrome'
actual=$(run_parser "$legacy_vless")
assert_line "$actual" 'type=vless'
assert_line "$actual" 'name=专属纯净静态住宅节点'
assert_line "$actual" 'server=69.63.211.8'
assert_line "$actual" 'port=443'
assert_line "$actual" 'uuid=C70A57B2-51EF-4AAF-A492-1092727C6E08'
assert_line "$actual" 'encryption=auto'
assert_line "$actual" 'flow=xtls-rprx-vision'
assert_line "$actual" 'security=reality'
assert_line "$actual" 'sni=www.cooper.edu'
assert_line "$actual" 'fp=chrome'
assert_line "$actual" 'pbk=RUnUX88Oy52Ijgm6JCbHBLcLcrRxzmIHVz1qUFcm0g0'
assert_line "$actual" 'sid=d8456744455b0dc3'

standard_vless='vless://11111111-2222-3333-4444-555555555555@example.com:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.example.com&fp=chrome&pbk=abc&sid=def&type=tcp#std'
actual=$(run_parser "$standard_vless")
assert_line "$actual" 'name=std'
assert_line "$actual" 'server=example.com'
assert_line "$actual" 'port=443'
assert_line "$actual" 'uuid=11111111-2222-3333-4444-555555555555'
assert_line "$actual" 'encryption=none'
assert_line "$actual" 'security=reality'
