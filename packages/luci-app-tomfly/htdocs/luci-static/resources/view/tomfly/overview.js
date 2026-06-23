'use strict';
'require view';
'require ui';
'require poll';
'require dom';
'require tomfly.api as api';
'require tomfly.kernel-profile as kprof';

document.querySelector('head').appendChild(E('link', {
	'rel': 'stylesheet', 'type': 'text/css',
	'href': L.resource('view/tomfly/style.css')
}));

function svg(paths) {
	var s = E('span');
	s.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
		'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">' +
		paths + '</svg>';
	return s.firstChild;
}

var ICON = {
	up:    '<polyline points="17 11 12 6 7 11"/><line x1="12" y1="18" x2="12" y2="6"/>',
	down:  '<polyline points="7 13 12 18 17 13"/><line x1="12" y1="6" x2="12" y2="18"/>',
	link:  '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
	mem:   '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
	total: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'
};

function notify(content, ms) {
	var el = ui.addNotification(null, content);
	if (ms > 0) window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms);
}

var _prevUp = 0, _prevDown = 0, _prevTs = 0;

function fmtSpeed(bps) {
	if (bps < 1024) return bps.toFixed(0) + ' B/s';
	if (bps < 1048576) return (bps / 1024).toFixed(1) + ' KB/s';
	return (bps / 1048576).toFixed(2) + ' MB/s';
}

function fmtBytes(b) {
	if (b < 1024) return b + ' B';
	if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
	if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
	return (b / 1073741824).toFixed(2) + ' GB';
}

return view.extend({
	load: function () {
		return Promise.all([
			L.resolveDefault(api.call('get_status'), {}),
			L.resolveDefault(api.call('get_traffic'), {}),
			L.resolveDefault(api.call('get_global'), {}),
			L.resolveDefault(api.call('get_dns'), {})
		]);
	},

	statusInner: function (s, activeNode) {
		s = s || {};
		var running = !!s.running;
		var kp = kprof.profile(s.kernel, s.version);
		return [
			kprof.badge(kp.kernel, s.version),
			E('span', { 'class': 'tomfly-pill ' + (running ? 'tomfly-pill-on' : 'tomfly-pill-off') }, [
				E('span', { 'class': 'tomfly-dot' }), running ? _('Running') : _('Stopped')
			]),
			s.version ? E('span', { 'class': 'tomfly-muted' }, s.version) : '',
			running ? E('button', {
				'class': 'tomfly-active-node',
				'title': _('Click to switch the active node'),
				'click': ui.createHandlerFn(this, 'handleSwitchNode')
			}, [
				E('span', { 'class': 'tomfly-active-label' }, _('Active: ')),
				E('span', { 'class': 'tomfly-active-name' }, activeNode || _('(auto)')),
				E('span', { 'style': 'margin-left:5px;opacity:.55;font-size:12px' }, '⇄')
			]) : '',
			E('div', { 'class': 'tomfly-actions' }, [
				E('button', {
					'class': 'cbi-button cbi-button-save important',
					'click': ui.createHandlerFn(this, 'handleAction', 'restart')
				}, running ? _('Restart') : _('Start')),
				running ? E('button', {
					'class': 'cbi-button cbi-button-remove important',
					'click': ui.createHandlerFn(this, 'handleAction', 'stop')
				}, _('Stop')) : ''
			])
		];
	},

	trafficInner: function (t) {
		t = t || {};
		var now = Date.now();
		var dt = _prevTs ? (now - _prevTs) / 1000 : 0;
		var upSpd  = (dt > 0.5 && (t.up || 0) >= _prevUp)   ? ((t.up || 0) - _prevUp) / dt   : 0;
		var dnSpd  = (dt > 0.5 && (t.down || 0) >= _prevDown) ? ((t.down || 0) - _prevDown) / dt : 0;
		_prevUp = t.up || 0;
		_prevDown = t.down || 0;
		_prevTs = now;

		return [
			E('div', { 'class': 'tomfly-card tomfly-stat' }, [
				E('div', { 'class': 'tomfly-stat-icon tomfly-ic-green' }, svg(ICON.up)),
				E('div', {}, [
					E('div', { 'class': 'tomfly-stat-value' }, fmtSpeed(upSpd)),
					E('div', { 'class': 'tomfly-stat-label' }, _('Upload') + ' · ' + fmtBytes(t.up || 0))
				])
			]),
			E('div', { 'class': 'tomfly-card tomfly-stat' }, [
				E('div', { 'class': 'tomfly-stat-icon tomfly-ic-blue' }, svg(ICON.down)),
				E('div', {}, [
					E('div', { 'class': 'tomfly-stat-value' }, fmtSpeed(dnSpd)),
					E('div', { 'class': 'tomfly-stat-label' }, _('Download') + ' · ' + fmtBytes(t.down || 0))
				])
			]),
			E('div', {
				'class': 'tomfly-card tomfly-stat tomfly-stat-clickable',
				'title': _('Click to view connection details'),
				'click': ui.createHandlerFn(this, 'handleShowConnections')
			}, [
				E('div', { 'class': 'tomfly-stat-icon tomfly-ic-amber' }, svg(ICON.link)),
				E('div', {}, [
					E('div', { 'class': 'tomfly-stat-value' }, String(t.conns || 0)),
					E('div', { 'class': 'tomfly-stat-label' }, _('Connections'))
				])
			]),
			E('div', { 'class': 'tomfly-card tomfly-stat' }, [
				E('div', { 'class': 'tomfly-stat-icon tomfly-ic-indigo' }, svg(ICON.mem)),
				E('div', {}, [
					E('div', { 'class': 'tomfly-stat-value' }, fmtBytes(t.mem || 0)),
					E('div', { 'class': 'tomfly-stat-label' }, _('Memory'))
				])
			]),
			E('div', { 'class': 'tomfly-card tomfly-stat' }, [
				E('div', { 'class': 'tomfly-stat-icon tomfly-ic-red' }, svg(ICON.total)),
				E('div', {}, [
					E('div', { 'class': 'tomfly-stat-value' }, fmtBytes((t.up || 0) + (t.down || 0))),
					E('div', { 'class': 'tomfly-stat-label' }, _('Total Traffic'))
				])
			])
		];
	},

	render: function (data) {
		var s = data[0] || {}, traffic = data[1] || {};
		var global = data[2] || {}, dns = data[3] || {};
		var kernel = kprof.normalize(global.kernel || s.kernel, s.version);
		var kp = kprof.profile(kernel, s.version);

		var statusCard = E('div', { 'class': 'tomfly-card' }, [
			E('div', { 'class': 'tomfly-card-title tomfly-status-title' }, [
				E('img', {
					'class': 'tomfly-status-logo',
					'src': L.resource('view/tomfly/logo.png'),
					'alt': 'TomFly'
				}),
				E('span', {}, _('Service Status'))
			]),
			E('div', { 'id': 'tomfly-status', 'class': 'tomfly-row' }, this.statusInner(s, traffic.activeNode))
		]);

		var trafficGrid = E('div', { 'id': 'tomfly-traffic', 'class': 'tomfly-grid' },
			this.trafficInner(traffic));

		var accessSites = [
			{ name: 'Baidu', url: 'https://www.baidu.com' },
			{ name: 'Google', url: 'https://www.google.com/generate_204' },
			{ name: 'YouTube', url: 'https://www.youtube.com' }
		];
		var accessCard = E('div', { 'class': 'tomfly-card' }, [
			E('div', { 'class': 'tomfly-row', 'style': 'margin-bottom:10px' }, [
				E('span', { 'class': 'tomfly-card-title', 'style': 'margin:0' }, _('Access Check')),
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'style': 'padding:2px 14px;font-size:12px',
					'id': 'tomfly-check-btn',
					'click': ui.createHandlerFn(this, 'handleCheck')
				}, _('Check All'))
			]),
			E('div', { 'id': 'tomfly-access' },
				accessSites.map(L.bind(function (site) {
					return E('div', { 'class': 'tomfly-access-item' }, [
						E('span', { 'class': 'tomfly-access-dot' }),
						E('span', { 'class': 'tomfly-access-name' }, site.name),
						E('span', { 'class': 'tomfly-access-result', 'data-site': site.name }, '—'),
						E('button', {
							'class': 'cbi-button cbi-button-action',
							'style': 'padding:1px 10px;font-size:11px;margin-left:6px',
							'click': ui.createHandlerFn(this, 'handleCheckSite', site)
						}, _('Check'))
					]);
				}, this))
			),
			E('div', { 'class': 'tomfly-row', 'style': 'margin-top:10px' }, [
				E('input', {
					'class': 'cbi-input-text', 'id': 'tomfly-custom-url', 'type': 'text',
					'style': 'flex:1;min-width:160px;font-size:12px',
					'placeholder': 'https://example.com'
				}),
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'style': 'padding:2px 12px;font-size:12px',
					'click': ui.createHandlerFn(this, 'handleCheckCustom')
				}, _('Check'))
			])
		]);

		var modeSelect = E('select', { 'class': 'cbi-input-select', 'id': 'tomfly-mode' }, [
			E('option', { value: 'rule' }, _('Rule')),
			E('option', { value: 'global' }, _('Global')),
			E('option', { value: 'direct' }, _('Direct'))
		]);
		modeSelect.value = global.mode || 'rule';

		var dnsSelect = E('select', { 'class': 'cbi-input-select', 'id': 'tomfly-dns-mode' }, [
			E('option', { value: 'fake-ip' }, 'Fake-IP'),
			E('option', { value: 'redir-host' }, 'Redir-Host')
		]);
		dnsSelect.value = dns.mode || 'fake-ip';

		var tunCheck = null;
		if (kp.tunConfigurable) {
			tunCheck = E('input', { 'type': 'checkbox', 'id': 'tomfly-tun', 'style': 'margin-right:6px' });
			tunCheck.checked = global.tun !== false;
		}

		var settingsRows = [
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Proxy Mode')),
				E('div', { 'class': 'cbi-value-field' }, [modeSelect])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('DNS Mode')),
				E('div', { 'class': 'cbi-value-field' }, [dnsSelect])
			])
		];

		if (kp.tunConfigurable) {
			settingsRows.push(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('TUN Mode')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('label', { 'style': 'display:flex;align-items:flex-start;cursor:pointer' }, [
						tunCheck,
						E('span', {}, _('Use TUN instead of TPROXY (kernel manages routing)'))
					])
				])
			]));
		} else {
			settingsRows.push(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Data Plane')),
				E('div', { 'class': 'cbi-value-field' }, [
					E('div', { 'class': 'tomfly-kernel-note' }, [
						E('strong', {}, _('TUN only')),
						' — ',
						_('sing-box always captures traffic via TUN (interface TomFly). TPROXY is not available.')
					])
				])
			]));
		}

		var settingsCard = E('div', { 'class': 'tomfly-card' }, [
			E('div', { 'class': 'tomfly-card-title' }, [
				_('Quick Settings'),
				' ',
				kprof.badge(kernel, s.version)
			]),
			kp.tunAlwaysOn ? E('div', { 'class': 'tomfly-kernel-banner' }, [
				E('strong', {}, _('sing-box: ')),
				_('No TUN toggle here — sing-box always runs in TUN mode.')
			]) : '',
		].concat(settingsRows).concat([
			E('div', { 'style': 'text-align:right;margin-top:6px' }, [
				E('button', {
					'class': 'cbi-button cbi-button-save important',
					'click': ui.createHandlerFn(this, 'handleSaveSettings')
				}, _('Save & Restart'))
			])
		]));

		var quick = E('div', { 'class': 'tomfly-card' }, [
			E('div', { 'class': 'tomfly-card-title' }, _('Quick Add Node')),
			E('div', { 'class': 'tomfly-row' }, [
				E('input', {
					'class': 'cbi-input-text', 'id': 'tomfly-quick', 'type': 'text',
					'style': 'flex:1;min-width:240px',
					'placeholder': 'vless:// vmess:// trojan:// ss:// hy2:// tuic:// anytls://',
					'keydown': L.bind(function (ev) {
						if (ev.keyCode === 13) this.handleQuickAdd(ev);
					}, this)
				}),
				E('button', {
					'class': 'cbi-button cbi-button-action important',
					'click': ui.createHandlerFn(this, 'handleQuickAdd')
				}, _('Add'))
			])
		]);

		poll.add(L.bind(function () {
			return Promise.all([
				L.resolveDefault(api.call('get_status'), {}),
				L.resolveDefault(api.call('get_traffic'), {})
			]).then(L.bind(function (r) {
				var el = document.getElementById('tomfly-status');
				if (el) dom.content(el, this.statusInner(r[0], r[1].activeNode));
				var tel = document.getElementById('tomfly-traffic');
				if (tel) dom.content(tel, this.trafficInner(r[1]));
			}, this));
		}, this), 3);

		return E('div', { 'class': 'tomfly' }, [
			statusCard, trafficGrid,
			E('div', { 'class': 'tomfly-grid-2' }, [accessCard, settingsCard]),
			quick
		]);
	},

	connectionsModalInner: function (conns) {
		if (!conns.length) {
			return E('p', { 'class': 'tomfly-muted' }, _('No active connections'));
		}
		return E('div', { 'class': 'tomfly-conn-list' }, conns.map(function (c) {
			var meta = c.metadata || {};
			var host = meta.host || meta.destinationIP || '—';
			var chain = (c.chains || []).join(' → ');
			var net = (meta.network || '').toUpperCase();
			var type = meta.type || '';
			var detail = [net, type, chain].filter(function (v) { return v; }).join(' · ');
			return E('div', { 'class': 'tomfly-conn-item' }, [
				E('div', { 'class': 'tomfly-conn-head' }, [
					E('span', { 'class': 'tomfly-conn-host' }, host),
					E('span', { 'class': 'tomfly-conn-traffic' },
						'↑ ' + fmtBytes(c.upload || 0) + '  ↓ ' + fmtBytes(c.download || 0))
				]),
				detail ? E('div', { 'class': 'tomfly-conn-meta' }, detail) : '',
				meta.sourceIP ? E('div', { 'class': 'tomfly-conn-src' },
					meta.sourceIP + (meta.sourcePort ? ':' + meta.sourcePort : '')) : ''
			]);
		}));
	},

	handleShowConnections: function () {
		var self = this;
		return api.call('get_connections').then(function (r) {
			var conns = (r && r.connections) || [];
			ui.showModal(_('Active Connections') + ' (' + conns.length + ')', [
				self.connectionsModalInner(conns),
				E('div', { 'class': 'right', 'style': 'margin-top:10px' }, [
					E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('Close'))
				])
			]);
		});
	},

	handleSwitchNode: function () {
		var self = this;
		return api.call('get_proxy_options').then(function (r) {
			var opts = (r && r.all) || [];
			var now = (r && r.now) || '';
			if (!opts.length) {
				ui.addNotification(null, E('p', _('No selectable nodes (is the service running?)')), 'warning');
				return;
			}
			ui.showModal(_('Switch Active Node'), [
				E('p', { 'class': 'tomfly-muted' }, _('Choose what the PROXY group uses. "AUTO" always picks the fastest node.')),
				E('div', { 'class': 'tomfly-node-picker' }, opts.map(function (name) {
					return E('button', {
						'class': 'cbi-button ' + (name === now ? 'cbi-button-positive' : 'cbi-button-neutral'),
						'style': 'display:block;width:100%;text-align:left;margin-bottom:6px',
						'click': ui.createHandlerFn(self, 'doSelectNode', name)
					}, (name === now ? '✓ ' : '  ') + name);
				})),
				E('div', { 'class': 'right', 'style': 'margin-top:10px' }, [
					E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('Close'))
				])
			]);
		});
	},

	doSelectNode: function (name) {
		var self = this;
		return api.call('select_node', { name: name }).then(function () {
			ui.hideModal();
			notify(E('p', _('Active node → ') + name), 2500);
			return Promise.all([
				L.resolveDefault(api.call('get_status'), {}),
				L.resolveDefault(api.call('get_traffic'), {})
			]).then(function (r) {
				var el = document.getElementById('tomfly-status');
				if (el) dom.content(el, self.statusInner(r[0], r[1].activeNode));
			});
		});
	},

	handleAction: function (act) {
		var self = this;
		return api.call(act).then(function () {
			notify(
				E('p', act === 'stop' ? _('Service stopped') : _('Service is (re)starting…')),
				3000);
			return new Promise(function (res) { window.setTimeout(res, act === 'stop' ? 1500 : 2500); });
		}).then(function () {
			return L.resolveDefault(api.call('get_status'), {});
		}).then(function (st) {
			var el = document.getElementById('tomfly-status');
			if (el) dom.content(el, self.statusInner(st));
		});
	},

	_updateSiteResult: function (name, ok, latency) {
		var items = document.querySelectorAll('#tomfly-access .tomfly-access-item');
		for (var i = 0; i < items.length; i++) {
			var nameEl = items[i].querySelector('.tomfly-access-name');
			if (nameEl && nameEl.textContent === name) {
				var dot = items[i].querySelector('.tomfly-access-dot');
				var res = items[i].querySelector('.tomfly-access-result');
				if (dot) { dot.className = 'tomfly-access-dot ' + (ok ? 'ok' : 'fail'); }
				if (res) {
					res.className = 'tomfly-access-result ' + (ok ? 'ok' : 'fail');
					res.textContent = ok ? latency + ' ms' : 'Timeout';
				}
				break;
			}
		}
	},

	handleCheck: function () {
		var self = this;
		var btn = document.getElementById('tomfly-check-btn');
		if (btn) btn.disabled = true;
		return api.call('check_access').then(function (r) {
			var sites = (r && r.sites) || [];
			sites.forEach(function (s) { self._updateSiteResult(s.name, s.ok, s.latency); });
			if (btn) btn.disabled = false;
		}).catch(function () {
			if (btn) btn.disabled = false;
		});
	},

	handleCheckSite: function (site, ev) {
		var self = this;
		var btn = ev.currentTarget || ev.target;
		if (btn) btn.disabled = true;
		return api.call('check_site', { name: site.name, url: site.url }).then(function (r) {
			if (r) self._updateSiteResult(r.name, r.ok, r.latency);
			if (btn) btn.disabled = false;
		}).catch(function () {
			if (btn) btn.disabled = false;
		});
	},

	handleCheckCustom: function () {
		var self = this;
		var inp = document.getElementById('tomfly-custom-url');
		var url = (inp && inp.value || '').trim();
		if (!url) return;
		if (!/^https?:\/\//.test(url)) url = 'https://' + url;
		var name = url.replace(/^https?:\/\//, '').replace(/\/.*/, '');
		return api.call('check_site', { name: name, url: url }).then(function (r) {
			if (!r) return;
			var el = document.getElementById('tomfly-access');
			if (!el) return;
			var existing = el.querySelector('[data-site="' + name + '"]');
			if (existing) {
				var item = existing.closest('.tomfly-access-item');
				var dot = item && item.querySelector('.tomfly-access-dot');
				if (dot) dot.className = 'tomfly-access-dot ' + (r.ok ? 'ok' : 'fail');
				existing.className = 'tomfly-access-result ' + (r.ok ? 'ok' : 'fail');
				existing.textContent = r.ok ? r.latency + ' ms' : 'Timeout';
			} else {
				el.appendChild(E('div', { 'class': 'tomfly-access-item' }, [
					E('span', { 'class': 'tomfly-access-dot ' + (r.ok ? 'ok' : 'fail') }),
					E('span', { 'class': 'tomfly-access-name' }, name),
					E('span', { 'class': 'tomfly-access-result ' + (r.ok ? 'ok' : 'fail'), 'data-site': name },
						r.ok ? r.latency + ' ms' : 'Timeout')
				]));
			}
		});
	},

	handleSaveSettings: function () {
		var mode = document.getElementById('tomfly-mode').value;
		var dnsMode = document.getElementById('tomfly-dns-mode').value;
		var tunEl = document.getElementById('tomfly-tun');
		var payload = { mode: mode, dns_mode: dnsMode };
		if (tunEl && !tunEl.disabled)
			payload.tun = tunEl.checked;
		return api.call('set_mode', payload).then(function () {
			return api.call('restart');
		}).then(function () {
			notify(E('p', _('Settings saved, restarting…')), 3000);
		}).catch(function (e) {
			ui.addNotification(null, E('p', _('Save failed: ') + e.message), 'danger');
		});
	},

	handleQuickAdd: function () {
		var inp = document.getElementById('tomfly-quick');
		var uri = (inp && inp.value || '').trim();
		if (!uri) return;
		return api.call('add_node', { uri: uri }).then(function (r) {
			if (r && r.ok) {
				notify(E('p', _('Node added: ') + (r.name || uri)), 3000);
				if (inp) inp.value = '';
			} else {
				ui.addNotification(null,
					E('p', _('Add failed: ') + ((r && r.error) || _('parse error'))), 'danger');
			}
		}).catch(function (e) {
			ui.addNotification(null, E('p', _('Add failed: ') + e.message), 'danger');
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
