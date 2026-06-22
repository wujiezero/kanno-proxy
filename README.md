# KannoProxy

A beautiful and simple transparent proxy plugin for ImmortalWrt 25.12.0+, powered by [mihomo](https://github.com/MetaCubeX/mihomo) and [sing-box](https://github.com/SagerNet/sing-box).

## Features

- **Beautiful dark UI** — Alpine.js + pure CSS, no build step required
- **Multiple protocols** — VLESS+Reality, VMess, Trojan, Shadowsocks, Hysteria2, TUIC v5, NaïveProxy
- **One-line node import** — paste any `vless://` / `vmess://` / ... URI directly
- **Smart routing** — GeoIP + GeoSite + custom force-proxy / force-direct rules
- **Failover & load-balance** — url-test / fallback / load-balance proxy groups
- **Dual kernel** — switch between mihomo and sing-box without reinstalling
- **Online update** — update kernels and GeoData from the web UI or command line
- **Zero dependencies** — no Node.js, no Python; pure shell + Lua on the router

## One-click Install

```sh
curl -fsSL https://raw.githubusercontent.com/wujiezero/kanno-proxy/main/install.sh | sh
```

The script will:
1. Install system dependencies (`curl`, `nftables`, `ip-full`, etc.) via opkg
2. Deploy all scripts and web UI files
3. Optionally download the mihomo kernel and GeoData
4. Enable the service and open the Web UI

After installation, open: `http://<router-ip>/luci-static/kanno/`

## Supported Protocols

| Protocol | URI Scheme | Notes |
|---|---|---|
| VLESS | `vless://` | Reality / Vision / WebSocket / gRPC |
| VMess | `vmess://` | WebSocket / gRPC / H2 |
| Trojan | `trojan://` | TLS / WebSocket / gRPC |
| Shadowsocks | `ss://` | 2022 / AEAD ciphers |
| Hysteria2 | `hy2://` or `hysteria2://` | QUIC-based |
| TUIC v5 | `tuic://` | QUIC-based |
| NaïveProxy | `naive+https://` | HTTP/2 camouflage |

## CLI Usage

```sh
# Add a node
kanno add "vless://uuid@host:port?encryption=none&flow=xtls-rprx-vision&..."

# List nodes
kanno list

# Test a node
kanno test <node-id>

# Start / stop / restart
kanno start
kanno stop
kanno restart

# Update kernel
kanno update mihomo
kanno update singbox
kanno update geodata
kanno update all

# Check status
kanno status
```

## Package Structure

```
packages/
├── kanno-core/          # Core scripts and service
├── luci-app-kanno/      # LuCI web UI + rpcd backend
└── kanno-geodata/       # GeoIP/GeoSite + rule files
```

## Architecture

```
Web UI (Alpine.js) → JSON-RPC (rpcd/ubus) → Lua backend
                                            ↓
                              UCI config ←→ Shell scripts
                                            ↓
                              mihomo / sing-box kernel
                                            ↓
                              nftables → TUN transparent proxy
```

## Requirements

- ImmortalWrt 23.05+ or OpenWrt 22.03+
- Architecture: aarch64, armv7, x86_64, mips, mipsle
- RAM: ≥64 MB free (128 MB+ recommended for mihomo)
- Storage: ≥16 MB free

## License

MIT
