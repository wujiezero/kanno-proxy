#!/bin/sh
# TomFly - per-node monthly traffic statistics
# Queries the Clash API (works with both mihomo and sing-box) and accumulates
# per-node upload+download into monthly totals.
#
# Accounting is incremental and per connection-id: the Clash /connections
# counters are cumulative-per-connection, so each poll only adds the *delta*
# since the previous poll for the same connection id. This avoids the inflation
# that naive per-poll summing produced.
#
# Output: JSON with per-node bytes for the current month
#   { "month": "2026-06", "nodes": { "Node A": 1073741824, ... }, "_running": true }

. /usr/lib/tomfly/common.sh

TRAFFIC_DB="/var/run/tomfly/traffic_month.json"
# Per connection-id snapshot of the last counted total bytes. One line per id:
#   <connId> <countedBytes>
CONN_SEEN="/var/run/tomfly/conn_seen"
API="http://127.0.0.1:9090"

# Is a kernel currently running? (lightweight pid-file check)
_traffic_running() {
    { [ -f "$MIHOMO_PID" ] && kill -0 "$(cat "$MIHOMO_PID" 2>/dev/null)" 2>/dev/null; } && return 0
    { [ -f "$SINGBOX_PID" ] && kill -0 "$(cat "$SINGBOX_PID" 2>/dev/null)" 2>/dev/null; } && return 0
    return 1
}

tomfly_traffic() {
    local month db stored_month resp tmp cur deltas newseen
    local sec name prev delta total first stats running

    month=$(date +%Y-%m)

    # Load stored monthly totals; reset to empty if the month rolled over.
    db="{}"
    [ -f "$TRAFFIC_DB" ] && db=$(cat "$TRAFFIC_DB" 2>/dev/null || echo "{}")
    stored_month=$(echo "$db" | jsonfilter -e '@.month' 2>/dev/null || echo "")
    [ "$stored_month" != "$month" ] && db="{}"

    running=false
    _traffic_running && running=true

    cur="/tmp/tomfly-traffic-cur-$$"
    deltas="/tmp/tomfly-traffic-delta-$$"
    newseen="${CONN_SEEN}.$$"
    : > "$cur"
    : > "$deltas"

    # Stats switch: '0' disables live accounting and simply re-emits the stored
    # monthly data (lightweight). Unset or '1' (default) = normal accounting.
    stats=$(uci -q get tomfly.global.traffic_stats 2>/dev/null)

    if [ "$stats" != "0" ] && [ "$running" = "true" ]; then
        resp=$(curl -sf --max-time 3 "$API/connections" 2>/dev/null)
        if [ -n "$resp" ]; then
            # Pass 1: parse the connections JSON into "id<TAB>node<TAB>total"
            # in a single awk (no per-connection fork). Splitting the JSON on
            # '}' separates a connection's id (inside the metadata sub-object's
            # record) from its byte counters/chains (the following record), so
            # carry the most recent id forward to the byte-bearing record.
            printf '%s' "$resp" | awk '
                BEGIN { RS="}"; pid="" }
                {
                    if (match($0, /"id":"[^"]*"/))
                        pid = substr($0, RSTART + 6, RLENGTH - 7)
                    up = 0; down = 0; node = ""; hasbytes = 0
                    if (match($0, /"upload":[0-9]+/)) {
                        s = substr($0, RSTART + 9, RLENGTH - 9); gsub(/[^0-9]/, "", s); up = s + 0; hasbytes = 1
                    }
                    if (match($0, /"download":[0-9]+/)) {
                        s = substr($0, RSTART + 11, RLENGTH - 11); gsub(/[^0-9]/, "", s); down = s + 0; hasbytes = 1
                    }
                    if (match($0, /"chains":\[[^]]*\]/)) {
                        arr = substr($0, RSTART + 10, RLENGTH - 11)
                        n = split(arr, parts, "\"")
                        for (i = n; i >= 1; i--) {
                            g = parts[i]; gsub(/^[ ,]+|[ ,]+$/, "", g)
                            if (g != "") { node = g; break }
                        }
                    }
                    if (hasbytes && pid != "" && node != "") {
                        printf "%s\t%s\t%d\n", pid, node, up + down
                        pid = ""
                    }
                }
            ' > "$cur" 2>/dev/null

            # Pass 2: diff this snapshot against the previous conn_seen to get
            # per-node deltas, and write a refreshed snapshot containing ONLY
            # the ids seen this round (drops connections that have disappeared,
            # keeping the state file bounded).
            [ -f "$CONN_SEEN" ] || : > "$CONN_SEEN"
            : > "$newseen"
            awk -v SEEN="$CONN_SEEN" -v DELTAS="$deltas" -v NEWSEEN="$newseen" '
                FILENAME == SEEN {
                    nn = split($0, a, " ")
                    if (nn >= 2) last[a[1]] = a[2] + 0
                    next
                }
                {
                    nn = split($0, b, "\t")
                    if (nn < 3) next
                    id = b[1]; node = b[2]; tot = b[3] + 0
                    p = (id in last) ? last[id] : 0
                    d = tot - p; if (d < 0) d = 0
                    delta[node] += d
                    cur[id] = tot
                }
                END {
                    for (k in delta) printf "%s\t%d\n", k, delta[k] > DELTAS
                    for (k in cur)   printf "%s %d\n", k, cur[k]   > NEWSEEN
                }
            ' "$CONN_SEEN" "$cur" 2>/dev/null
            mv "$newseen" "$CONN_SEEN" 2>/dev/null
        fi
    fi

    # Build output JSON: monthly total per configured node = prev + this delta.
    tmp="/tmp/tomfly-traffic-$$.json"
    {
        printf '{"month":"%s","nodes":{' "$month"
        first=1
        for sec in $(uci show tomfly 2>/dev/null | sed -n "s/^tomfly\.\(proxy_[0-9a-f]*\)\.type=.*/\1/p"); do
            name=$(uci -q get "tomfly.${sec}.name" 2>/dev/null)
            [ -z "$name" ] && continue
            prev=$(echo "$db" | jsonfilter -e "@.nodes[\"${name}\"]" 2>/dev/null)
            prev="${prev:-0}"
            if [ -s "$deltas" ]; then
                delta=$(awk -F'\t' -v n="$name" '$1==n{s+=$2} END{printf "%d", s+0}' "$deltas")
            else
                delta=0
            fi
            total=$(( prev + delta ))
            [ "$first" = "0" ] && printf ','
            printf '"%s":%d' "$(echo "$name" | sed 's/\\/\\\\/g;s/"/\\"/g')" "$total"
            first=0
        done
        printf '}'
        printf ',"_running":%s}\n' "$running"
    } > "$tmp" 2>/dev/null

    if [ -s "$tmp" ]; then
        cat "$tmp"
        cp "$tmp" "$TRAFFIC_DB" 2>/dev/null || true
    else
        printf '{"month":"%s","nodes":{},"_running":%s}\n' "$month" "$running"
    fi
    rm -f "$tmp" "$cur" "$deltas" "$newseen"
}
