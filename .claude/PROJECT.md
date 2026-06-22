# KannoProxy — Project Notes

## 项目概述
ImmortalWrt 25.12.0 透明代理插件，基于 mihomo / sing-box 双内核。

## 仓库
- Remote: git@github.com:wujiezero/kanno-proxy.git
- 一键安装: `curl -fsSL https://raw.githubusercontent.com/wujiezero/kanno-proxy/main/install.sh | sh`

## 目录结构
```
packages/kanno-core/       # 核心脚本包
  root/usr/lib/kanno/
    common.sh              # 共享变量和工具函数
    uri_parser.sh          # URI 解析（vless/vmess/trojan/ss/hy2/tuic/naive）
    gen_mihomo.sh          # 生成 mihomo config.yaml
    gen_singbox.sh         # 生成 sing-box config.json
    nftables.sh            # 透明代理 nftables 规则
    dns.sh                 # dnsmasq 集成
    updater.sh             # 内核 & geodata 更新
  root/usr/bin/kanno       # 主控制命令
  root/etc/init.d/kanno   # procd init 脚本
  root/etc/config/kanno   # UCI 默认配置

packages/luci-app-kanno/   # Web UI 包
  htdocs/luci-static/kanno/
    index.html             # 主 SPA（Alpine.js）
    style.css              # 暗色主题 CSS
    app.js                 # Alpine.js 应用逻辑
    alpine.min.js          # Alpine.js 3.14.1（本地，无 CDN 依赖）
  luasrc/rpc/kanno.lua    # rpcd JSON-RPC 后端
  root/usr/share/rpcd/acl.d/  # rpcd 权限控制
  root/usr/share/luci/menu.d/ # LuCI 菜单注册

packages/kanno-geodata/    # 规则文件包
  root/etc/kanno/rules/
    force_proxy.txt        # 强制走代理的域名/IP
    force_direct.txt       # 强制直连的域名/IP
```

## UCI 配置 Schema
Package: `kanno`

```
config global 'global'     # 全局设置
  enabled, kernel, mode, log_level, ipv6

config dns 'dns'           # DNS 设置
  enabled, mode, listen_port, domestic_dns[], foreign_dns[]

config rules 'rules'       # 路由规则
  geosite_cn, geoip_cn, default_policy

config proxy 'proxy_XXXXXXXX'   # 代理节点（8位hex ID）
  name, type, server, port, enabled
  + 协议特定字段 (uuid/password/flow/security/sni/pbk/sid/...)

config proxygroup 'group_NAME'  # 代理分组
  name, type, proxies[], url, interval, tolerance
```

## rpcd API 方法（Lua → luasrc/rpc/kanno.lua）
通过 ubus 调用，前端通过 POST /ubus 访问：
- get_status / get_nodes / add_node(uri) / del_node(id) / toggle_node(id, enabled)
- test_node(id) / test_all_nodes
- get_groups / save_groups
- get_rules / save_rules
- get_dns / save_dns
- get_global / save_global
- get_kernels / update_kernel(target)
- restart / stop / get_logs(lines)

## 透明代理实现
- 模式：TUN（首选）+ TPROXY 回退
- nftables 创建 `inet kanno` 表
- 规则优先级：LAN直连 → 强制直连集 → 强制代理集 → CN IP直连 → 全部代理
- policy routing: fwmark 0x200 → table 100 → local default dev lo

## 内核管理
- mihomo: `/usr/bin/mihomo`, config `/etc/kanno/mihomo/config.yaml`
  - API: `http://127.0.0.1:9090`
  - 热重载: `kill -HUP <pid>`
- sing-box: `/usr/bin/sing-box`, config `/etc/kanno/singbox/config.json`
- GeoData: `/etc/kanno/geodata/{geoip,geosite}.dat`
- 版本文件: `/etc/kanno/{mihomo,singbox,geodata/version}`

## 开发/调试
```sh
# 测试 URI 解析
. /usr/lib/kanno/uri_parser.sh && parse_uri "vless://..."

# 生成配置并检查
. /usr/lib/kanno/gen_mihomo.sh && generate_mihomo_config

# 检查 nftables 规则
nft list table inet kanno

# 查看日志
tail -f /var/log/kanno.log

# 手动添加节点
kanno add "vless://uuid@host:port?..."

# rpcd 测试
ubus call kanno get_status
```

## 已知问题 / TODO
- [ ] LightGBM 节点评分服务（Phase 7）
- [ ] vmess URI 解析在部分非标格式时可能失败（已加宽松处理）
- [ ] install.sh 的 uhttpd alias 命令在部分版本不支持，需测试
- [ ] sing-box 的 TUN auto-route 与 nftables 规则可能冲突，需在路由器上实测
- [ ] 节点测速用 nc，对 UDP 节点（hy2/tuic）不准确
