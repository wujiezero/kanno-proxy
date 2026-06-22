# KannoProxy

A clean, native-LuCI transparent proxy plugin for ImmortalWrt 25.12.0+ / OpenWrt 22.03+,
powered by [mihomo](https://github.com/MetaCubeX/mihomo) and [sing-box](https://github.com/SagerNet/sing-box).

> Languages: English · [简体中文](README.zh-CN.md)

## Features

- **Native LuCI UI** — pure JS views rendered as top tabs under *Services → KannoProxy*, matches the router theme (light/dark)
- **Multiple protocols** — VLESS+Reality, VMess, Trojan, Shadowsocks (incl. 2022), Hysteria2, TUIC v5, AnyTLS
- **One-line import** — paste any `vless://` / `vmess://` / `ss://` / `hy2://` / `tuic://` / `anytls://` … URI
- **Kernel-aware** — a capability matrix skips nodes the active kernel can't run (e.g. mihomo + anytls-reality), and the config is validated before each (re)start so one bad node can't take the service down
- **Two transparent-proxy data-planes** — TPROXY (default) or TUN, switched from the UI and mutually exclusive (see below)
- **Smart routing** — GeoIP + GeoSite + custom force-proxy / force-direct rules
- **Dual kernel** — switch between mihomo and sing-box without reinstalling
- **Online update** — pull kernels and GeoData from the web UI or CLI

## One-click Install

```sh
curl -fsSL https://cdn.jsdelivr.net/gh/wujiezero/kanno-proxy@main/install.sh | sh
```

It installs dependencies (`nftables`, `kmod-nft-tproxy`, `kmod-tun`, `ip-full`, `rpcd-mod-file`, …),
deploys the scripts + web UI, and optionally downloads the mihomo kernel and GeoData.

After install, open: **`http://<router-ip>/cgi-bin/luci/admin/services/kanno`**

To remove it: `curl -fsSL https://cdn.jsdelivr.net/gh/wujiezero/kanno-proxy@main/uninstall.sh | sh`
(add `PURGE=1` to also delete saved nodes, kernels, geodata and logs).

## Kernel & GeoData downloads (manual install / offline)

`kanno update mihomo|singbox|geodata|all` (or the **Kernel** tab) fetches everything automatically and
picks the right architecture for you. If your router has no GitHub access, download the files on another
machine and drop them in via the Kernel tab's **upload** button, or `scp` them to the paths below.

**First, find your architecture** on the router:

```sh
. /etc/openwrt_release; echo "$DISTRIB_ARCH"   # e.g. x86_64, aarch64_cortex-a53, arm_cortex-a7_neon-vfpv4
uname -m                                        # fallback: x86_64, aarch64, armv7l, mips, mipsel
```

**Pick the matching asset** (this is exactly what `detect_arch()` maps to):

| Router arch (`DISTRIB_ARCH` / `uname -m`) | asset arch token |
|---|---|
| `x86_64`                                  | `linux-amd64` |
| `i386*` / `i686`                          | `linux-386` |
| `aarch64*` / `aarch64`                    | `linux-arm64` |
| `arm_*` with neon/vfp (Cortex-A) / `armv7l` | `linux-armv7` |
| older `arm_*` / `armv5*`                  | `linux-armv5` |
| `mipsel_*` / `mipsel`                     | `linux-mipsle-softfloat` |
| `mips_*` / `mips`                         | `linux-mips-softfloat` |
| `mips64el_*`                              | `linux-mips64le` |
| `mips64_*`                                | `linux-mips64` |

> On `x86_64`, the `-compatible` mihomo build runs on every CPU (no AVX requirement) and is the safe pick.

**mihomo** — releases: <https://github.com/MetaCubeX/mihomo/releases>
Asset name: `mihomo-<arch>-<version>.gz` (e.g. `mihomo-linux-arm64-v1.19.27.gz`). Then:

```sh
gzip -d mihomo-linux-arm64-v1.19.27.gz
install -m755 mihomo-linux-arm64-v1.19.27 /usr/bin/mihomo
```

**sing-box** — releases: <https://github.com/SagerNet/sing-box/releases>
Asset name: `sing-box-<version>-<arch>.tar.gz` (e.g. `sing-box-1.13.12-linux-arm64.tar.gz`). Then:

```sh
tar -xzf sing-box-1.13.12-linux-arm64.tar.gz
install -m755 sing-box-*/sing-box /usr/bin/sing-box
```

**GeoData** (arch-independent) — releases: <https://github.com/Loyalsoldier/v2ray-rules-dat/releases>
Download `geoip.dat` and `geosite.dat`, then:

```sh
cp geoip.dat geosite.dat /etc/kanno/geodata/
```

Behind the GFW, prefer the jsDelivr mirror, e.g.
`https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geoip.dat`.

## Supported Protocols

| Protocol | URI Scheme | mihomo | sing-box |
|---|---|---|---|
| VLESS | `vless://` | ✓ (Reality / Vision / ws / grpc) | ✓ |
| VMess | `vmess://` | ✓ | ✓ |
| Trojan | `trojan://` | ✓ | ✓ |
| Shadowsocks | `ss://` | ✓ (2022 / AEAD) | ✓ |
| Hysteria2 | `hy2://` · `hysteria2://` | ✓ | ✓ |
| TUIC v5 | `tuic://` | ✓ | ✓ |
| AnyTLS | `anytls://` | ✓ (**no** Reality) | ✓ (Reality OK) |

> mihomo does **not** support AnyTLS + Reality — such a node is auto-skipped on mihomo; switch to
> sing-box, or use a VLESS/Trojan Reality node. `naive` is not a kernel outbound and is unsupported.

## TPROXY vs TUN

Both transparently proxy the router **and** every LAN device that uses it as gateway — they are just two
mechanisms, and only one runs at a time:

- **TPROXY** (default): kanno's `nftables` redirects traffic to the kernel's tproxy port. Battle-tested.
- **TUN**: the kernel creates a `tun` device and owns routing via `auto-route` + `auto-redirect`; kanno's
  nftables/policy-routing step is skipped. Requires `kmod-tun`. If the TUN interface fails to come up
  (e.g. a virtualized host without `/dev/net/tun`), kanno automatically falls back to TPROXY.

sing-box is always TUN. Toggle TUN for mihomo in *Overview → Quick Settings*.

> **LXC/Proxmox note:** an unprivileged container needs the host to load `tun` and pass the device in —
> on the PVE host: `modprobe tun` (persist via `/etc/modules-load.d/`), and in the container config add
> `lxc.cgroup2.devices.allow: c 10:200 rwm` and
> `lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file`, then restart the container.

## CLI Usage

```sh
kanno add "vless://uuid@host:port?security=reality&..."   # add a node
kanno list                                                # list nodes
kanno test <node-id>                                      # test connectivity
kanno start | stop | restart | status                     # service control
kanno update mihomo | singbox | geodata | all             # online update
```

## Package Structure

```
packages/
├── kanno-core/        # core shell scripts + init.d service
├── luci-app-kanno/    # native LuCI JS views + rpcd ACL
└── kanno-geodata/     # default rule files
```

## Architecture

```
Native LuCI JS views ──ubus(file.exec)/uci──> shell CLI (/usr/bin/kanno)
                                                   │
                                       UCI config ←┘→ gen_mihomo / gen_singbox
                                                   │
                                          mihomo / sing-box kernel
                                                   │
                                    nftables TPROXY  ──or──  kernel TUN
```

## Requirements

- ImmortalWrt 25.12.0+ / OpenWrt 22.03+ (`apk` or `opkg`)
- Architecture: x86_64, aarch64, armv7/armv5, mips(le); 386 / mips64 best-effort
- RAM: ≥64 MB free (128 MB+ recommended for mihomo)
- Storage: ≥16 MB free

## License

MIT
