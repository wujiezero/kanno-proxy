/* KannoProxy - Alpine.js application */

function kannoApp() {
  return {
    page: 'dashboard',
    inIframe: window.self !== window.top,
    status: { running: false, kernel: 'mihomo', version: '', connections: 0 },
    nodes: [],
    groups: [],
    rules: { geosite_cn: 'DIRECT', geoip_cn: 'DIRECT', default_policy: 'PROXY',
             force_proxy: [], force_direct: [],
             force_proxy_text: '', force_direct_text: '' },
    dns: { mode: 'fake-ip', listen_port: 1053, domestic_dns: [], foreign_dns: [],
           domestic_text: '', foreign_text: '' },
    global: { enabled: true, kernel: 'mihomo', mode: 'rule', log_level: 'info', ipv6: false },
    kernels: { mihomo: {}, singbox: {}, geodata: {} },
    logs: [],
    quickUri: '', quickMsg: '', quickMsgOk: false,
    showAddNode: false, addUri: '', addMsg: '', addMsgOk: false,
    groupMsg: '', groupMsgOk: false,
    rulesMsg: '', rulesMsgOk: false,
    dnsMsg: '', dnsMsgOk: false,
    globalMsg: '', globalMsgOk: false,
    kernelMsg: '', kernelMsgOk: false,
    updatePending: null,
    actionPending: false,
    toast: { show: false, msg: '', ok: true },

    async init() {
      // Alpine.js v3: set up $watch inside init() — the external
      // _x_dataStack hack used below does not work with Alpine v3.
      this.$watch('page', (newPage) => this.onPageChange(newPage));
      await Promise.all([this.fetchStatus(), this.fetchNodes()]);
      setInterval(() => this.fetchStatus(), 5000);
    },

    async rpc(method, params) {
      const body = JSON.stringify({ method: method, params: params || {} });
      try {
        const r = await fetch('/cgi-bin/kanno', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          credentials: 'include'
        });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || 'RPC error');
        return j.result;
      } catch (e) {
        // Fallback to mock data when backend unavailable (dev mode)
        console.warn('[kanno] RPC fallback for', method, ':', e.message);
        return this._devFallback(method, params);
      }
    },

    _devFallback(method) {
      const mocks = {
        get_status:  { running: true, kernel: 'mihomo', version: 'v1.18.0 dev', connections: 3 },
        get_nodes:   { nodes: [] },
        get_groups:  { groups: [{ id:'proxy', name:'PROXY', type:'url-test', proxies:[], interval:300, tolerance:50 }] },
        get_rules:   { geosite_cn:'DIRECT', geoip_cn:'DIRECT', default_policy:'PROXY', force_proxy:[], force_direct:[] },
        get_dns:     { mode:'fake-ip', listen_port:1053, domestic_dns:['114.114.114.114','223.5.5.5'], foreign_dns:['8.8.8.8','1.1.1.1'] },
        get_global:  { enabled:true, kernel:'mihomo', mode:'rule', log_level:'info', ipv6:false },
        get_kernels: { mihomo:{installed:false,version:''}, singbox:{installed:false,version:''}, geodata:{version:'',geoip:'no',geosite:'no'} },
        get_logs:    { lines: ['[INFO]  KannoProxy dev mode'] },
      };
      return mocks[method] || { ok: true };
    },

    showToast(msg, ok = true) {
      this.toast = { show: true, msg, ok };
      setTimeout(() => { this.toast.show = false; }, 3000);
    },

    async fetchStatus() {
      const r = await this.rpc('get_status');
      if (r) this.status = r;
    },

    async fetchNodes() {
      const r = await this.rpc('get_nodes');
      if (r?.nodes) this.nodes = r.nodes;
    },

    latencyClass(ms) {
      if (!ms) return 'latency-none';
      if (ms < 150) return 'latency-good';
      if (ms < 400) return 'latency-ok';
      return 'latency-bad';
    },

    async quickAdd() {
      this.quickMsg = '';
      if (!this.quickUri.trim()) return;
      const r = await this.rpc('add_node', { uri: this.quickUri.trim() });
      if (r?.ok) {
        this.quickMsgOk = true;
        this.quickMsg = `✓ 节点 "${r.name}" 添加成功`;
        this.quickUri = '';
        await this.fetchNodes();
      } else {
        this.quickMsgOk = false;
        this.quickMsg = '✗ ' + (r?.error || '解析失败，请检查 URI 格式');
      }
    },

    async doAddNode() {
      this.addMsg = '';
      const uris = this.addUri.split('\n').map(s => s.trim()).filter(Boolean);
      let ok = 0, fail = 0;
      for (const uri of uris) {
        const r = await this.rpc('add_node', { uri });
        r?.ok ? ok++ : fail++;
      }
      if (fail === 0) {
        this.addMsgOk = true;
        this.addMsg = `✓ 成功添加 ${ok} 个节点`;
        this.addUri = '';
        await this.fetchNodes();
        setTimeout(() => { this.showAddNode = false; }, 1000);
      } else {
        this.addMsgOk = false;
        this.addMsg = `成功 ${ok} 个，失败 ${fail} 个，请检查失败的 URI`;
        if (ok > 0) await this.fetchNodes();
      }
    },

    async doDelNode(n) {
      if (!confirm(`确认删除节点 "${n.name}"？`)) return;
      const r = await this.rpc('del_node', { id: n.id });
      if (r?.ok) {
        await this.fetchNodes();
        this.showToast(`已删除 ${n.name}`);
      }
    },

    async doToggleNode(n) {
      const r = await this.rpc('toggle_node', { id: n.id, enabled: !n.enabled });
      if (r?.ok) {
        n.enabled = !n.enabled;
        this.showToast(n.enabled ? '节点已启用' : '节点已禁用');
      }
    },

    async doTestNode(n) {
      n.latency = null;
      const r = await this.rpc('test_node', { id: n.id });
      n.latency = r?.latency || null;
      this.showToast(r?.ok ? `延迟 ${r.latency}ms` : '连接超时', r?.ok);
    },

    async doTestAll() {
      const r = await this.rpc('test_all_nodes');
      if (r?.results) {
        for (const item of r.results) {
          const node = this.nodes.find(n => n.id === item.id);
          if (node) node.latency = item.latency;
        }
        this.showToast('测速完成');
      }
    },

    async doStart() {
      this.actionPending = true;
      await this.rpc('restart');
      setTimeout(async () => { await this.fetchStatus(); this.actionPending = false; }, 2000);
      this.showToast('正在启动...');
    },

    async doStop() {
      this.actionPending = true;
      await this.rpc('stop');
      setTimeout(async () => { await this.fetchStatus(); this.actionPending = false; }, 1500);
      this.showToast('已停止服务');
    },

    async doRestart() {
      this.actionPending = true;
      await this.rpc('restart');
      this.showToast('正在重启...');
      setTimeout(async () => { await this.fetchStatus(); this.actionPending = false; }, 3000);
    },

    // Groups page
    async loadGroups() {
      const r = await this.rpc('get_groups');
      if (r?.groups) this.groups = r.groups;
    },

    addGroup() {
      this.groups.push({ id: '', name: '新分组', type: 'url-test', proxies: [], interval: 300, tolerance: 50 });
    },

    addProxyToGroup(g, name) {
      if (name && !g.proxies.includes(name)) g.proxies.push(name);
    },

    async saveGroups() {
      const r = await this.rpc('save_groups', { groups: this.groups });
      this.groupMsgOk = !!r?.ok;
      this.groupMsg = r?.ok ? '✓ 分组已保存' : '✗ 保存失败';
    },

    // Rules page
    async loadRules() {
      const r = await this.rpc('get_rules');
      if (r) {
        this.rules = { ...r,
          force_proxy_text:  (r.force_proxy || []).join('\n'),
          force_direct_text: (r.force_direct || []).join('\n'),
        };
      }
    },

    async saveRules() {
      const payload = {
        geosite_cn:     this.rules.geosite_cn,
        geoip_cn:       this.rules.geoip_cn,
        default_policy: this.rules.default_policy,
        force_proxy:    this.rules.force_proxy_text.split('\n').map(s => s.trim()).filter(Boolean),
        force_direct:   this.rules.force_direct_text.split('\n').map(s => s.trim()).filter(Boolean),
      };
      const r = await this.rpc('save_rules', payload);
      this.rulesMsgOk = !!r?.ok;
      this.rulesMsg = r?.ok ? '✓ 规则已保存，重启后生效' : '✗ 保存失败';
    },

    // DNS page
    async loadDns() {
      const r = await this.rpc('get_dns');
      if (r) {
        this.dns = { ...r,
          domestic_text: (r.domestic_dns || []).join('\n'),
          foreign_text:  (r.foreign_dns || []).join('\n'),
        };
      }
    },

    async saveDns() {
      const payload = {
        enabled:      this.dns.enabled,
        mode:         this.dns.mode,
        listen_port:  this.dns.listen_port,
        domestic_dns: this.dns.domestic_text.split('\n').map(s => s.trim()).filter(Boolean),
        foreign_dns:  this.dns.foreign_text.split('\n').map(s => s.trim()).filter(Boolean),
      };
      const r = await this.rpc('save_dns', payload);
      this.dnsMsgOk = !!r?.ok;
      this.dnsMsg = r?.ok ? '✓ DNS 设置已保存，重启后生效' : '✗ 保存失败';
    },

    // Kernel page
    async loadKernelPage() {
      const [gk, gg] = await Promise.all([this.rpc('get_global'), this.rpc('get_kernels')]);
      if (gk) this.global = gk;
      if (gg) this.kernels = gg;
    },

    async saveGlobal() {
      const r = await this.rpc('save_global', this.global);
      this.globalMsgOk = !!r?.ok;
      this.globalMsg = r?.ok ? '✓ 设置已保存，重启后生效' : '✗ 保存失败';
    },

    async updateKernel(target) {
      this.updatePending = target;
      this.kernelMsgOk = true;
      this.kernelMsg = `${target} 更新中，请稍候（需下载，可能需 1-3 分钟）...`;
      const r = await this.rpc('update_kernel', { target });
      this.updatePending = null;
      this.kernelMsgOk = !!r?.ok;
      this.kernelMsg = r?.ok ? '✓ ' + (r.message || '已发起更新，请检查日志') : '✗ 更新失败';
    },

    async fetchLogs() {
      const r = await this.rpc('get_logs', { lines: 200 });
      if (r?.lines) {
        this.logs = r.lines;
        this.$nextTick(() => {
          if (this.$refs.logbox) {
            this.$refs.logbox.scrollTop = this.$refs.logbox.scrollHeight;
          }
        });
      }
    },

    // Reload page-specific data whenever the active page changes
    async onPageChange(newPage) {
      switch (newPage) {
        case 'nodes':   await this.fetchNodes(); break;
        case 'groups':  await this.loadGroups(); break;
        case 'rules':   await this.loadRules(); break;
        case 'dns':     await this.loadDns(); break;
        case 'kernel':  await this.loadKernelPage(); break;
        case 'logs':    await this.fetchLogs(); break;
      }
    },
  };
}
