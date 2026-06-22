# KannoProxy

一款简洁、原生 LuCI 的透明代理插件，适用于 ImmortalWrt 25.12.0+ / OpenWrt 22.03+，
由 [mihomo](https://github.com/MetaCubeX/mihomo) 与 [sing-box](https://github.com/SagerNet/sing-box) 驱动。

> 其他语言：[English](README.md) · 简体中文

## 功能特性

- **原生 LuCI 界面** —— 纯 JS 视图，以顶部标签页形式呈现于 *服务 → KannoProxy* 下，自动适配路由器主题（浅色/深色）
- **多协议支持** —— VLESS+Reality、VMess、Trojan、Shadowsocks（含 2022）、Hysteria2、TUIC v5、AnyTLS
- **一行导入** —— 直接粘贴任意 `vless://` / `vmess://` / `ss://` / `hy2://` / `tuic://` / `anytls://` … 链接
- **内核感知** —— 通过能力矩阵自动跳过当前内核无法运行的节点（例如 mihomo + anytls-reality），且每次（重）启动前都会校验配置，避免一个坏节点拖垮整个服务
- **两种透明代理数据平面** —— TPROXY（默认）或 TUN，可在界面中切换，二者互斥（详见下文）
- **智能分流** —— GeoIP + GeoSite + 自定义强制代理 / 强制直连规则
- **双内核** —— 在 mihomo 与 sing-box 之间切换，无需重新安装
- **在线更新** —— 通过 Web 界面或命令行拉取内核与 GeoData

## 一键安装

```sh
curl -fsSL https://cdn.jsdelivr.net/gh/wujiezero/kanno-proxy@main/install.sh | sh
```

安装脚本会安装依赖（`nftables`、`kmod-nft-tproxy`、`kmod-tun`、`ip-full`、`rpcd-mod-file` …），
部署脚本与 Web 界面，并可选择下载 mihomo 内核与 GeoData。

安装完成后，打开：**`http://<路由器IP>/cgi-bin/luci/admin/services/kanno`**

卸载：`curl -fsSL https://cdn.jsdelivr.net/gh/wujiezero/kanno-proxy@main/uninstall.sh | sh`
（追加 `PURGE=1` 可同时删除已保存的节点、内核、geodata 与日志）。

## 内核与 GeoData 下载（手动安装 / 离线）

`kanno update mihomo|singbox|geodata|all`（或 **内核** 标签页）会自动获取所有文件，
并为你挑选正确的架构。如果路由器无法访问 GitHub，可在另一台机器上下载文件，
通过内核标签页的 **上传** 按钮导入，或用 `scp` 拷贝到下列路径。

**首先，在路由器上确认你的架构：**

```sh
. /etc/openwrt_release; echo "$DISTRIB_ARCH"   # 例如 x86_64、aarch64_cortex-a53、arm_cortex-a7_neon-vfpv4
uname -m                                        # 备用：x86_64、aarch64、armv7l、mips、mipsel
```

**选择匹配的资源文件**（这正是 `detect_arch()` 的映射规则）：

| 路由器架构（`DISTRIB_ARCH` / `uname -m`） | 资源架构标识 |
|---|---|
| `x86_64`                                  | `linux-amd64` |
| `i386*` / `i686`                          | `linux-386` |
| `aarch64*` / `aarch64`                    | `linux-arm64` |
| 带 neon/vfp 的 `arm_*`（Cortex-A）/ `armv7l` | `linux-armv7` |
| 较旧的 `arm_*` / `armv5*`                  | `linux-armv5` |
| `mipsel_*` / `mipsel`                     | `linux-mipsle-softfloat` |
| `mips_*` / `mips`                         | `linux-mips-softfloat` |
| `mips64el_*`                              | `linux-mips64le` |
| `mips64_*`                                | `linux-mips64` |

> 在 `x86_64` 上，`-compatible` 版本的 mihomo 可在所有 CPU 上运行（不要求 AVX），是最稳妥的选择。

**mihomo** —— 发布页：<https://github.com/MetaCubeX/mihomo/releases>
资源文件名：`mihomo-<arch>-<version>.gz`（例如 `mihomo-linux-arm64-v1.19.27.gz`）。然后：

```sh
gzip -d mihomo-linux-arm64-v1.19.27.gz
install -m755 mihomo-linux-arm64-v1.19.27 /usr/bin/mihomo
```

**sing-box** —— 发布页：<https://github.com/SagerNet/sing-box/releases>
资源文件名：`sing-box-<version>-<arch>.tar.gz`（例如 `sing-box-1.13.12-linux-arm64.tar.gz`）。然后：

```sh
tar -xzf sing-box-1.13.12-linux-arm64.tar.gz
install -m755 sing-box-*/sing-box /usr/bin/sing-box
```

**GeoData**（与架构无关）—— 发布页：<https://github.com/Loyalsoldier/v2ray-rules-dat/releases>
下载 `geoip.dat` 与 `geosite.dat`，然后：

```sh
cp geoip.dat geosite.dat /etc/kanno/geodata/
```

在 GFW 之后，建议使用 jsDelivr 镜像，例如
`https://cdn.jsdelivr.net/gh/Loyalsoldier/v2ray-rules-dat@release/geoip.dat`。

## 支持的协议

| 协议 | URI 方案 | mihomo | sing-box |
|---|---|---|---|
| VLESS | `vless://` | ✓（Reality / Vision / ws / grpc） | ✓ |
| VMess | `vmess://` | ✓ | ✓ |
| Trojan | `trojan://` | ✓ | ✓ |
| Shadowsocks | `ss://` | ✓（2022 / AEAD） | ✓ |
| Hysteria2 | `hy2://` · `hysteria2://` | ✓ | ✓ |
| TUIC v5 | `tuic://` | ✓ | ✓ |
| AnyTLS | `anytls://` | ✓（**不支持** Reality） | ✓（支持 Reality） |

> mihomo **不**支持 AnyTLS + Reality —— 此类节点在 mihomo 上会被自动跳过；
> 请切换到 sing-box，或改用 VLESS/Trojan Reality 节点。`naive` 不是内核出站，故不受支持。

## TPROXY 对比 TUN

两者都会透明代理路由器**本身**以及所有将其作为网关的局域网设备 —— 它们只是两种不同的
机制，且同一时间只有一种在运行：

- **TPROXY**（默认）：kanno 的 `nftables` 将流量重定向到内核的 tproxy 端口。久经考验。
- **TUN**：内核创建 `tun` 设备，并通过 `auto-route` + `auto-redirect` 接管路由；kanno 的
  nftables/策略路由步骤会被跳过。需要 `kmod-tun`。如果 TUN 接口无法启动
  （例如缺少 `/dev/net/tun` 的虚拟化主机），kanno 会自动回退到 TPROXY。

sing-box 始终使用 TUN。mihomo 的 TUN 开关位于 *概览 → 快速设置*。

> **LXC/Proxmox 提示：** 非特权容器需要宿主机加载 `tun` 并将设备透传进来 ——
> 在 PVE 宿主机上：`modprobe tun`（通过 `/etc/modules-load.d/` 持久化），并在容器配置中加入
> `lxc.cgroup2.devices.allow: c 10:200 rwm` 和
> `lxc.mount.entry: /dev/net/tun dev/net/tun none bind,create=file`，然后重启容器。

## 命令行用法

```sh
kanno add "vless://uuid@host:port?security=reality&..."   # 添加节点
kanno list                                                # 列出节点
kanno test <node-id>                                      # 测试连通性
kanno start | stop | restart | status                     # 服务控制
kanno update mihomo | singbox | geodata | all             # 在线更新
```

## 软件包结构

```
packages/
├── kanno-core/        # 核心 shell 脚本 + init.d 服务
├── luci-app-kanno/    # 原生 LuCI JS 视图 + rpcd ACL
└── kanno-geodata/     # 默认规则文件
```

## 架构

```
原生 LuCI JS 视图 ──ubus(file.exec)/uci──> shell 命令行 (/usr/bin/kanno)
                                                   │
                                       UCI 配置  ←─┘→ gen_mihomo / gen_singbox
                                                   │
                                          mihomo / sing-box 内核
                                                   │
                                    nftables TPROXY  ──或──  内核 TUN
```

## 系统要求

- ImmortalWrt 25.12.0+ / OpenWrt 22.03+（`apk` 或 `opkg`）
- 架构：x86_64、aarch64、armv7/armv5、mips(le)；386 / mips64 尽力支持
- 内存：≥64 MB 空闲（mihomo 建议 128 MB 以上）
- 存储：≥16 MB 空闲

## 许可证

MIT
