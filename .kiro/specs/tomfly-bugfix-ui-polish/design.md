# 设计文档：TomFly Bug 修复、防锁死与界面优化

## 背景与验证说明
本设计针对 TomFly（OpenWrt/ImmortalWrt 透明代理插件，mihomo/sing-box 双内核）的若干已确认 bug、一个高危“管理通道被锁死”问题，以及概览页两个流量图的样式优化。

重要前提：由于无法在开发环境直接 SSH 或执行命令，且复现环境已被恢复出厂，本设计中“管理通道被锁死”的微观机制（为何仅 22 端口超时、80 正常）尚未在实机坐实。因此采用“防御性 + 安全网”策略：即使确切机制未完全查清，也要保证不会把用户锁在路由器之外。验证以脚本语法检查（sh -n）与人工核对为主；运行时验证依赖用户按“安全复现协议”在实机抓现场。

已查明的关键事实链（解释“停止无效、重启无效、只有恢复出厂才行”）：
1. 运行中的 sing-box TUN 代理（auto_route/auto_redirect）会堵住到路由器自身 22 端口的访问。
2. `tomfly stop` 未清理 sing-box auto_route 装的 ip rule/独立路由表（只删了 nft 表与 TUN 接口），且 `stop_kernel` SIGTERM 后仅 sleep 1 即 kill -9，sing-box 可能来不及自清。
3. 服务被 enable 且开机自启，重启后 init 又自动拉起代理，把问题重新制造出来。
4. 恢复出厂删掉配置、去掉自启后才恢复。

## 目标
- P0：彻底消除“被代理锁死、只能恢复出厂”的风险。
- P1：修复 5 个已确认 bug；流量统计改为准确版并带开关；OOM 硬化。
- P2：概览页两个流量图美化。
- 新增：UI 提供“开机自启”开关，默认关闭。

## 详细设计

### P0-1 管理通道豁免（sing-box TUN）
文件：`packages/tomfly-core/root/usr/lib/tomfly/gen_singbox.sh`
- 在 TUN inbound 的 `route_exclude_address` 中追加路由器 LAN 子网（由 `network.lan.ipaddr`/`netmask` 推导，IPv4 必加；若启用 IPv6 一并加 LAN6），确保发往 LAN/路由器自身的流量不进入 TUN。
- 保留并确认 route 规则中已有 `{"ip_is_private": true, "outbound": "DIRECT"}`。
- TPROXY 路径已通过 nftables 私网 bypass（含 192.168.0.0/16）放行管理流量，无需额外改动，但在设计中标注其为“已安全”。

### P0-2 完整且优雅的停止与清理
文件：`packages/tomfly-core/root/usr/bin/tomfly`
- `stop_kernel`：改为先 SIGTERM，随后轮询等待进程真正退出（最多约 5 秒），仅在超时后才 `kill -9`，给 sing-box 时间自清 auto_route。
- `tomfly_stop`：在现有清理（teardown_dns / unload_nftables / teardown_routing / 删 nft 表 inet mihomo|sing-box / 删 TUN 接口 Meta|TomFly）基础上，兜底清理 sing-box auto_route 残留：删除指向 TUN 的悬空 ip rule 与自建路由表（IPv4 与 IPv6 均处理）。实现时按安装的 sing-box 版本核对其默认表号/规则优先级（注释中标注需实机确认）。

### P0-3 启动自检 + 自动回滚（mechanism-agnostic 安全网）
文件：`packages/tomfly-core/root/usr/bin/tomfly`（`tomfly_start`）
- 起代理并装好数据面后，做管理通道可达性自检：例如本机 `nc -z -w2 127.0.0.1 22`（dropbear）与 LAN 网关/本机 80 端口可达性；记录“启动前基线”与“启动后”的对比。
- 若自检发现管理通道由通变不通，立即 `tomfly_stop` 回滚，并 `log_error` 明确告知“为保护管理访问已自动回滚”。
- 自检需容错（dropbear 可能未跑在 22、用户改过端口等），以“启动前能通、启动后不通”为触发条件，避免误杀。

### 新增 开机自启开关（默认关闭）
文件：
- `packages/tomfly-core/root/etc/config/tomfly`：在 `config global 'global'` 增加 `option autostart '0'`（默认关闭）。
- `packages/tomfly-core/root/etc/init.d/tomfly`：`start()` 在开机被 procd 调用时，读取 `tomfly.global.autostart`，为 0（默认）则不自动启动（return 0）；保持 `enable` 的 procd 集成存在，使开关可控。手动 `tomfly start` / UI 的启动按钮走 CLI，不受此开关影响。
- UI：`overview.js` 快速设置区新增“开机自启”复选框，默认未勾选；`api.js` 的 `getGlobal/saveGlobal/setMode` 读写 `global.autostart`。

### OOM 硬化
文件：`packages/tomfly-core/root/usr/bin/tomfly`（`start_kernel`）与/或 `init.d`
- 启动内核后，将 dropbear 的 `oom_score_adj` 调低（如 -800），将代理内核进程 `oom_score_adj` 调高（如 +500），保证内存紧张时优先牺牲代理内核而非 SSH。
- 可选：对内核进程设内存上限（如可用则用 cgroup/`ulimit`），避免吃满内存。注意小内存机型的容错与日志提示。

### P1 已确认 bug
1. 节点排序按钮失效：`packages/luci-app-tomfly/htdocs/luci-static/resources/tomfly/api.js` 的 `reorderNode`，CLI 成功（匹配 /moved|already at/i）后调用 `refresh()`（uci.unload+load）再返回 ok，使前端 uci 缓存刷新，列表按新 order 重渲。
2. IPv6 节点回环防护失效：`packages/tomfly-core/root/usr/lib/tomfly/common.sh` 新增 `list_node_server_ips6()`，镜像 `list_node_server_ips`，输出节点服务器的 IPv6 地址（IPv6 字面量直接输出并去掉 URI 的方括号；域名解析 AAAA；IPv4 跳过）。
3. VLESS 名称二次 URL 解码：`uri_parser.sh` 的 `parse_vless`，将 `echo "name=$(urldecode "$frag")"` 改为 `echo "name=$frag"`（frag 已解码一次），与其他解析器一致。
4. skgid 死规则 + sing-box 自流量：`nftables.sh` 删除两处永不命中的 `meta skgid 53690 return`；`gen_singbox.sh` 给出站设置 socket mark 768（与 mihomo routing-mark 一致），使现有 `meta mark 768 return` 自流量豁免覆盖 sing-box（具体字段随 sing-box 版本核对：routing_mark / route.default_mark 等）。

### P1 流量统计（准确版 + 性能开关）
文件：`packages/tomfly-core/root/usr/lib/tomfly/traffic.sh`、`config/tomfly`、（可选）UI
- 改为按连接 id 增量累计：维护状态文件（如 `/var/run/tomfly/conn_seen.json`）记录每条连接上次累计字节；每次轮询对每条活动连接计算 `delta = max(0, 当前累计 − 上次)`，按 node 汇总 delta 累加进月度总量；刷新状态、剔除已消失连接 id。避免把同一批字节重复计入导致虚高。
- 性能：解析尽量在单次 awk 内完成，控制状态文件大小；若实测开销明显，提供开关 `tomfly.global.traffic_stats`（默认 '1'）。开关为 0 时跳过统计、`tomfly traffic` 返回轻量结果。
- UI（可选）：设置区暴露统计开关。

### P2 概览图表美化
文件：`overview.js`、`style.css`
- 实时折线图（canvas `#tomfly-chart`）：按 `devicePixelRatio` 与容器实际宽度设置画布分辨率并在 resize 重绘，消除拉伸模糊；网格线减到 3 条并修正刻度数值格式，避免重复的“1 K”，低流量时给合理最小量程；折线下加渐变面积、圆角线帽；图例用画布下方 HTML 色块，颜色走主题变量。
- 月度节点流量条（`#tomfly-node-traffic`）：轨道改为浅色、主题自适应中性底（不再用解析成近黑色的 `--border-color`）；填充宽度改为相对当月最大节点值按比例，非零值给最小可见宽度；零值显示淡色基线；优化字号与间距。

## 测试与验证策略
- 所有改动 shell 脚本执行 `sh -n` 语法检查；若环境有 shellcheck 则一并跑。
- JS/CSS 按 LuCI 约定人工核对（无构建链）。
- 运行时验证（无法在本环境进行）依赖用户按下述“安全复现协议”在实机执行：
  1. 复现前留带外退路：优先串口 Console；否则先 `/etc/init.d/tomfly disable`，确保万一被锁可断电重启自救。
  2. 起代理前抓基线：`ip rule; ip -4 route show table all; ip -6 route show table all; nft list ruleset; logread | tail`。
  3. 起代理后从另一台机器测 `nc 路由器IP 22` 与 `:80`；若 22 不通，先别动，再抓一遍上述四样 + `logread`，连同基线发回，用于 diff 出确切机制。

## 风险
- sing-box auto_route 残留清理与 socket mark 字段随版本不同，需实机核对，故实现中以注释标注并保持容错。
- 启动自检逻辑需避免误判（用户自定义 SSH 端口等）。
