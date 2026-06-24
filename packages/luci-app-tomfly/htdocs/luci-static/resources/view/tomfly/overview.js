'use strict';
'require view';
'require ui';
'require poll';
'require dom';
'require tomfly.api as api';
'require tomfly.kernel-profile as kprof';
'require tomfly.widgets as widgets';

widgets.mount();

function notify(content, ms) {
	var el = ui.addNotification(null, content);
	if (ms > 0) window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms);
}

var _prevUp = 0, _prevDown = 0, _prevTs = 0;
/* Traffic chart — tracks last 60 samples (~3 min at 3s poll) */
var _chartUp = [], _chartDown = [], _chartMax = 60;
var _chartResizeBound = false;
/* Polls are registered once for the page's lifetime (survives soft-nav
   re-renders); callbacks no-op when their tab isn't mounted. */
var _pollsAdded = false;

function cssVar(name, fb) {
	try {
		var v = getComputedStyle(document.documentElement).getPropertyValue(name);
		return (v && v.trim()) || fb;
	} catch (e) { return fb; }
}

function hexToRgba(hex, a) {
	var h = hex.replace('#', '');
	if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	var r = parseInt(h.substring(0, 2), 16);
	var g = parseInt(h.substring(2, 4), 16);
	var b = parseInt(h.substring(4, 6), 16);
	return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

function chartColors() {
	var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
	return {
		dark: dark,
		grid: cssVar('--tf-border', dark ? '#243049' : '#e5e9f0'),
		text: cssVar('--tf-text3', dark ? '#65718a' : '#9aa6b6'),
		up:   '#10b981',
		down: cssVar('--tf-accent', dark ? '#7c83f7' : '#5b5bf0')
	};
}

/* Format a rate for the Y-axis. Unit is chosen from the axis max so labels
   stay consistent; decimals keep low-traffic labels distinct (no "1 K" dupes). */
function fmtRate(bps, max) {
	if (max >= 1048576) {
		var m = bps / 1048576;
		return (m >= 10 ? m.toFixed(0) : m.toFixed(1)) + ' M';
	}
	var k = bps / 1024;
	return (k >= 10 ? k.toFixed(0) : k.toFixed(1)) + ' K';
}

function drawChart() {
	var cvs = document.getElementById('tomfly-chart');
	if (!cvs) return;
	var ctx = cvs.getContext('2d');

	if (!_chartResizeBound) {
		window.addEventListener('resize', function () { drawChart(); });
		_chartResizeBound = true;
	}

	/* Match the backing store to the display size × devicePixelRatio so the
	   line stays crisp instead of being stretched from a fixed buffer. */
	var dpr = window.devicePixelRatio || 1;
	var cssW = cvs.clientWidth || 900;
	var cssH = cvs.clientHeight || 210;
	var needW = Math.round(cssW * dpr), needH = Math.round(cssH * dpr);
	if (cvs.width !== needW)  cvs.width = needW;
	if (cvs.height !== needH) cvs.height = needH;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

	var w = cssW, h = cssH;
	var pad = 10, graphH = h - pad * 2;
	var c = chartColors();

	ctx.clearRect(0, 0, w, h);

	var max = 1, i;
	for (i = 0; i < _chartUp.length; i++) {
		if (_chartUp[i] > max) max = _chartUp[i];
		if (_chartDown[i] > max) max = _chartDown[i];
	}
	if (max < 1024) max = 1024;   // floor at 1 KB/s so the axis never collapses
	max = max * 1.15;             // a little headroom above the peak

	/* 3 grid lines with de-duplicated Y labels */
	var grids = 2;
	ctx.lineWidth = 1;
	ctx.strokeStyle = c.grid;
	ctx.font = '11px ui-monospace, monospace';
	ctx.textAlign = 'left';
	var lastLabel = null;
	for (i = 0; i <= grids; i++) {
		var y = pad + graphH * i / grids;
		ctx.beginPath();
		ctx.moveTo(0, y); ctx.lineTo(w, y);
		ctx.stroke();
		var label = fmtRate(max * (grids - i) / grids, max);
		if (label !== lastLabel) {
			ctx.fillStyle = c.text;
			ctx.fillText(label, 4, y + (i === 0 ? 11 : -4));
			lastLabel = label;
		}
	}

	var step = (w - pad - 2) / (_chartMax - 1);

	function plot(data, color) {
		if (data.length < 2) return;
		var x0 = w - pad - (data.length - 1) * step;
		var pts = [], j;
		for (j = 0; j < data.length; j++) {
			var x = x0 + j * step;
			var py = pad + graphH - (data[j] || 0) / max * graphH;
			if (py > pad + graphH) py = pad + graphH;
			if (py < pad) py = pad;
			pts.push([x, py]);
		}
		var grad = ctx.createLinearGradient(0, pad, 0, pad + graphH);
		grad.addColorStop(0, hexToRgba(color, c.dark ? 0.30 : 0.22));
		grad.addColorStop(1, hexToRgba(color, 0));
		ctx.beginPath();
		ctx.moveTo(pts[0][0], pad + graphH);
		for (j = 0; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
		ctx.lineTo(pts[pts.length - 1][0], pad + graphH);
		ctx.closePath();
		ctx.fillStyle = grad;
		ctx.fill();
		ctx.beginPath();
		ctx.strokeStyle = color;
		ctx.lineWidth = 2.5;
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';
		ctx.moveTo(pts[0][0], pts[0][1]);
		for (j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
		ctx.stroke();
	}
	plot(_chartDown, c.down);
	plot(_chartUp, c.up);
}

function fmtSpeed(bps) {
	if (bps < 1024) return bps.toFixed(0) + ' B/s';
	if (bps < 1048576) return (bps / 1024).toFixed(1) + ' KB/s';
	return (bps / 1048576).toFixed(2) + ' MB/s';
}
function splitSpeed(bps) {
	if (bps < 1024) return [bps.toFixed(0), 'B/s'];
	if (bps < 1048576) return [(bps / 1024).toFixed(1), 'KB/s'];
	return [(bps / 1048576).toFixed(2), 'MB/s'];
}

function fmtBytes(b) {
	if (b < 1024) return b + ' B';
	if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
	if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
	return (b / 1073741824).toFixed(2) + ' GB';
}
function splitBytes(b) {
	if (b < 1024) return [String(b), 'B'];
	if (b < 1048576) return [(b / 1024).toFixed(1), 'KB'];
	if (b < 1073741824) return [(b / 1048576).toFixed(1), 'MB'];
	return [(b / 1073741824).toFixed(2), 'GB'];
}

function metric(iconName, iconCls, valParts, label, opts) {
	opts = opts || {};
	var val = Array.isArray(valParts)
		? E('div', { 'class': 'tomfly-metric-val' }, [valParts[0], ' ', E('span', { 'class': 'tomfly-metric-unit' }, valParts[1])])
		: E('div', { 'class': 'tomfly-metric-val' }, String(valParts));
	return E('div', {
		'class': 'tomfly-metric' + (opts.click ? ' clickable' : ''),
		'title': opts.title || null,
		'click': opts.click || null
	}, [
		E('div', { 'class': 'tomfly-metric-icon ' + iconCls }, widgets.icon(iconName, 20)),
		E('div', {}, [val, E('div', { 'class': 'tomfly-metric-label' }, label)])
	]);
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
			E('div', { 'class': 'tomfly-hero-l' }, [
				E('div', { 'class': 'tomfly-eyebrow' }, _('Service Status')),
				E('div', { 'class': 'tomfly-hero-row' }, [
					E('span', { 'class': 'tomfly-pill ' + (running ? 'tomfly-pill-on' : 'tomfly-pill-off') }, [
						E('span', { 'class': 'tomfly-dot' }), running ? _('Running') : _('Stopped')
					]),
					s.version ? E('span', { 'class': 'tomfly-hero-ver' }, s.version) : ''
				])
			]),
			E('div', { 'class': 'tomfly-hero-r' }, [
				running ? E('button', {
					'class': 'tomfly-active-node',
					'title': _('Click to switch the active node'),
					'click': ui.createHandlerFn(this, 'handleSwitchNode')
				}, [
					_('Outbound') + '：' + (activeNode || _('(auto)')),
					widgets.icon('swap', 15)
				]) : '',
				E('button', {
					'class': 'tomfly-btn tomfly-btn-accent',
					'click': ui.createHandlerFn(this, 'handleAction', 'restart')
				}, running ? _('Restart') : _('Start')),
				running ? E('button', {
					'class': 'tomfly-btn tomfly-btn-danger',
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

		_chartUp.push(upSpd); _chartDown.push(dnSpd);
		while (_chartUp.length > _chartMax) _chartUp.shift();
		while (_chartDown.length > _chartMax) _chartDown.shift();
		drawChart();

		return [
			metric('up', 'tomfly-mi-green', splitSpeed(upSpd), _('Upload') + ' · ' + fmtBytes(t.up || 0)),
			metric('down', 'tomfly-mi-accent', splitSpeed(dnSpd), _('Download') + ' · ' + fmtBytes(t.down || 0)),
			metric('link', 'tomfly-mi-amber', String(t.conns || 0), _('Connections'), {
				click: ui.createHandlerFn(this, 'handleShowConnections'),
				title: _('Click to view connection details')
			}),
			metric('mem', 'tomfly-mi-purple', splitBytes(t.mem || 0), _('Memory')),
			metric('clock', 'tomfly-mi-red', splitBytes((t.up || 0) + (t.down || 0)), _('Total Traffic'))
		];
	},

	render: function (data) {
		var s = data[0] || {}, traffic = data[1] || {};
		var global = data[2] || {}, dns = data[3] || {};
		var kernel = kprof.normalize(global.kernel || s.kernel, s.version);
		var kp = kprof.profile(kernel, s.version);

		var hero = E('div', { 'id': 'tomfly-status', 'class': 'tomfly-card tomfly-hero' },
			this.statusInner(s, traffic.activeNode));

		var metrics = E('div', { 'id': 'tomfly-traffic', 'class': 'tomfly-metrics' },
			this.trafficInner(traffic));

		var chartCard = E('div', { 'class': 'tomfly-card tomfly-chart-card tomfly-mt' }, [
			E('div', { 'class': 'tomfly-chart-top' }, [
				E('div', { 'class': 'tomfly-card-title' }, _('Realtime Traffic')),
				E('div', { 'class': 'tomfly-chart-legend' }, [
					E('span', { 'class': 'tomfly-legend-item' }, [E('span', { 'class': 'tomfly-legend-swatch tomfly-legend-up' }), _('Upload')]),
					E('span', { 'class': 'tomfly-legend-item' }, [E('span', { 'class': 'tomfly-legend-swatch tomfly-legend-down' }), _('Download')])
				])
			]),
			E('canvas', { 'id': 'tomfly-chart', 'width': '900', 'height': '210' })
		]);

		/* Access check */
		var accessSites = [
			{ name: 'Baidu', url: 'https://www.baidu.com' },
			{ name: 'Google', url: 'https://www.google.com/generate_204' },
			{ name: 'YouTube', url: 'https://www.youtube.com' }
		];
		var accessCard = E('div', { 'class': 'tomfly-card' }, [
			E('div', { 'class': 'tomfly-chart-top', 'style': 'margin-bottom:2px' }, [
				E('div', { 'class': 'tomfly-card-title' }, _('Access Check')),
				E('button', {
					'class': 'tomfly-btn tomfly-btn-xs tomfly-btn-accent', 'id': 'tomfly-check-btn',
					'click': ui.createHandlerFn(this, 'handleCheck')
				}, _('Check All'))
			]),
			E('div', { 'id': 'tomfly-access' },
				accessSites.map(L.bind(function (site) {
					return E('div', { 'class': 'tomfly-access-item' }, [
						E('span', { 'class': 'tomfly-access-name' }, [
							E('span', { 'class': 'tomfly-access-dot' }), site.name
						]),
						E('div', { 'class': 'tomfly-access-r' }, [
							E('span', { 'class': 'tomfly-access-result', 'data-site': site.name }, '—'),
							E('button', {
								'class': 'tomfly-btn tomfly-btn-xs tomfly-btn-ghost',
								'click': ui.createHandlerFn(this, 'handleCheckSite', site)
							}, _('Check'))
						])
					]);
				}, this))
			),
			E('div', { 'class': 'tomfly-access-add' }, [
				E('input', { 'class': 'tomfly-input', 'id': 'tomfly-custom-url', 'type': 'text', 'placeholder': 'https://example.com' }),
				E('button', {
					'class': 'tomfly-btn tomfly-btn-ghost', 'style': 'padding:9px 16px',
					'click': ui.createHandlerFn(this, 'handleCheckCustom')
				}, _('Check'))
			])
		]);

		/* Quick settings */
		var modeSelect = E('select', { 'class': 'tomfly-select', 'id': 'tomfly-mode' }, [
			E('option', { value: 'rule' }, _('Rule')),
			E('option', { value: 'global' }, _('Global')),
			E('option', { value: 'direct' }, _('Direct'))
		]);
		modeSelect.value = global.mode || 'rule';

		var dnsSelect = E('select', { 'class': 'tomfly-select', 'id': 'tomfly-dns-mode' }, [
			E('option', { value: 'fake-ip' }, 'Fake-IP'),
			E('option', { value: 'redir-host' }, 'Redir-Host')
		]);
		dnsSelect.value = dns.mode || 'fake-ip';

		var settingRows = [
			E('div', { 'class': 'tomfly-setting' }, [
				E('div', { 'class': 'tomfly-setting-label' }, _('Proxy Mode')),
				modeSelect
			]),
			E('div', { 'class': 'tomfly-setting' }, [
				E('div', { 'class': 'tomfly-setting-label' }, _('DNS Mode')),
				dnsSelect
			])
		];

		if (kp.tunConfigurable) {
			settingRows.push(E('div', { 'class': 'tomfly-setting' }, [
				E('div', {}, [
					E('div', { 'class': 'tomfly-setting-label' }, _('TUN Mode')),
					E('div', { 'class': 'tomfly-setting-desc' }, _('Kernel manages routing, replacing TPROXY'))
				]),
				widgets.toggle('tomfly-tun', global.tun !== false)
			]));
		} else {
			settingRows.push(E('div', { 'class': 'tomfly-setting' }, [
				E('div', {}, [
					E('div', { 'class': 'tomfly-setting-label' }, _('Data Plane')),
					E('div', { 'class': 'tomfly-setting-desc' }, _('sing-box always captures traffic via TUN — TPROXY is not available.'))
				]),
				E('span', { 'class': 'tomfly-kbadge' }, 'TUN')
			]));
		}

		settingRows.push(E('div', { 'class': 'tomfly-setting' }, [
			E('div', {}, [
				E('div', { 'class': 'tomfly-setting-label' }, _('Start on Boot')),
				E('div', { 'class': 'tomfly-setting-desc' }, _('Auto-start the proxy when the router boots'))
			]),
			widgets.toggle('tomfly-autostart', global.autostart === true)
		]));

		settingRows.push(E('div', { 'class': 'tomfly-setting' }, [
			E('div', {}, [
				E('div', { 'class': 'tomfly-setting-label' }, _('Traffic Stats')),
				E('div', { 'class': 'tomfly-setting-desc' }, _('Track per-node monthly traffic'))
			]),
			widgets.toggle('tomfly-traffic-stats', global.traffic_stats !== false)
		]));

		var settingsCard = E('div', { 'class': 'tomfly-card' }, [
			E('div', { 'class': 'tomfly-card-head' }, [
				E('div', { 'class': 'tomfly-card-title' }, _('Quick Settings')),
				kprof.badge(kernel, s.version)
			])
		].concat(settingRows).concat([
			E('div', { 'class': 'tomfly-setting', 'style': 'justify-content:flex-end' }, [
				E('button', {
					'class': 'tomfly-btn tomfly-btn-primary',
					'click': ui.createHandlerFn(this, 'handleSaveSettings')
				}, _('Save & Restart'))
			])
		]));

		/* Monthly per-node traffic */
		var nodeTrafficCard = E('div', { 'class': 'tomfly-card tomfly-mt' }, [
			E('div', { 'class': 'tomfly-card-head', 'style': 'margin-bottom:12px' }, [
				E('div', { 'class': 'tomfly-card-title' }, _('Monthly Node Traffic'))
			]),
			E('div', { 'id': 'tomfly-node-traffic' }, E('span', { 'class': 'tomfly-muted' }, _('Loading...')))
		]);

		/* Quick add */
		var quick = E('div', { 'class': 'tomfly-card tomfly-mt' }, [
			E('div', { 'class': 'tomfly-card-title' }, _('Quick Add Node')),
			E('div', { 'class': 'tomfly-card-desc', 'style': 'margin:4px 0 13px' },
				_('Paste a share link — vless / vmess / trojan / ss / hy2 / tuic / anytls')),
			E('div', { 'class': 'tomfly-access-add', 'style': 'border:none;padding:0' }, [
				E('input', {
					'class': 'tomfly-input mono', 'id': 'tomfly-quick', 'type': 'text',
					'placeholder': 'vless://  vmess://  trojan://  ss://  hy2://  tuic://  anytls://',
					'keydown': L.bind(function (ev) { if (ev.keyCode === 13) this.handleQuickAdd(ev); }, this)
				}),
				E('button', {
					'class': 'tomfly-btn tomfly-btn-primary', 'style': 'padding:11px 22px',
					'click': ui.createHandlerFn(this, 'handleQuickAdd')
				}, _('Add'))
			])
		]);

		if (!_pollsAdded) {
		_pollsAdded = true;
		poll.add(L.bind(function () {
			if (!document.getElementById('tomfly-traffic')) return;  // tab not mounted
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

		poll.add(L.bind(function () {
			var box = document.getElementById('tomfly-node-traffic');
			if (!box) return;  // tab not mounted
			return L.resolveDefault(api.call('get_node_traffic'), {}).then(L.bind(function (r) {
				var box = document.getElementById('tomfly-node-traffic');
				if (!box) return;
				var nodes = r.nodes || {};
				var keys = Object.keys(nodes);
				if (!keys.length) {
					dom.content(box, E('span', { 'class': 'tomfly-muted' },
						r.running ? _('No traffic data yet') : _('Service not running')));
					return;
				}
				keys.sort(function (a, b) { return (nodes[b] || 0) - (nodes[a] || 0); });
				var maxBytes = 0;
				keys.forEach(function (name) { if ((nodes[name] || 0) > maxBytes) maxBytes = nodes[name] || 0; });
				var rows = keys.map(function (name) {
					var bytes = nodes[name] || 0;
					var gb = bytes / 1073741824;
					var isZero = bytes <= 0;
					var width = isZero ? 0 : Math.max(4, maxBytes > 0 ? (bytes / maxBytes * 100) : 0);
					return E('div', { 'class': 'tomfly-traffic-row' }, [
						E('span', { 'class': 'tomfly-traffic-name' }, name),
						E('span', { 'class': 'tomfly-traffic-bar-bg' },
							E('span', { 'class': 'tomfly-traffic-bar' + (isZero ? ' zero' : ''), 'style': 'width:' + width + '%' })),
						E('span', { 'class': 'tomfly-traffic-gb' + (isZero ? ' zero' : '') }, gb.toFixed(2) + ' GB')
					]);
				});
				var month = r.month || '';
				dom.content(box, [
					month ? E('div', { 'style': 'margin-bottom:8px' }, E('span', { 'class': 'tomfly-kbadge' }, month)) : '',
					E('div', {}, rows)
				]);
			}, this));
		}, this), 10);
		}

		return E('div', { 'class': 'tomfly-app' }, [
			widgets.nav('overview', [kprof.badge(kernel, s.version)]),
			hero, metrics, chartCard,
			E('div', { 'class': 'tomfly-grid-2 mt' }, [accessCard, settingsCard]),
			nodeTrafficCard,
			quick,
			E('div', { 'class': 'tomfly-foot' }, 'Powered by LuCI · ImmortalWrt')
		]);
	},

	connectionsModalInner: function (conns) {
		if (!conns.length)
			return E('p', { 'class': 'tomfly-muted' }, _('No active connections'));
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
				E('div', { 'class': 'tomfly-modal' }, [
					self.connectionsModalInner(conns),
					E('div', { 'class': 'tomfly-modal-actions' }, [
						E('button', { 'class': 'tomfly-btn tomfly-btn-ghost', 'click': ui.hideModal }, _('Close'))
					])
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
				E('div', { 'class': 'tomfly-modal' }, [
					E('p', { 'class': 'tomfly-muted' }, _('Choose what the PROXY group uses. "AUTO" always picks the fastest node.')),
					E('div', { 'class': 'tomfly-node-picker' }, opts.map(function (name) {
						return E('button', {
							'class': 'tomfly-pick' + (name === now ? ' on' : ''),
							'click': ui.createHandlerFn(self, 'doSelectNode', name)
						}, (name === now ? '✓ ' : '') + name);
					})),
					E('div', { 'class': 'tomfly-modal-actions' }, [
						E('button', { 'class': 'tomfly-btn tomfly-btn-ghost', 'click': ui.hideModal }, _('Close'))
					])
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
			notify(E('p', act === 'stop' ? _('Service stopped') : _('Service is (re)starting…')), 3000);
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
			if (nameEl && nameEl.textContent.trim() === name) {
				var dot = items[i].querySelector('.tomfly-access-dot');
				var res = items[i].querySelector('.tomfly-access-result');
				if (dot) dot.className = 'tomfly-access-dot ' + (ok ? 'ok' : 'fail');
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
		}).catch(function () { if (btn) btn.disabled = false; });
	},

	handleCheckSite: function (site, ev) {
		var self = this;
		var btn = ev.currentTarget || ev.target;
		if (btn) btn.disabled = true;
		return api.call('check_site', { name: site.name, url: site.url }).then(function (r) {
			if (r) self._updateSiteResult(r.name, r.ok, r.latency);
			if (btn) btn.disabled = false;
		}).catch(function () { if (btn) btn.disabled = false; });
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
					E('span', { 'class': 'tomfly-access-name' }, [
						E('span', { 'class': 'tomfly-access-dot ' + (r.ok ? 'ok' : 'fail') }), name
					]),
					E('div', { 'class': 'tomfly-access-r' }, [
						E('span', { 'class': 'tomfly-access-result ' + (r.ok ? 'ok' : 'fail'), 'data-site': name },
							r.ok ? r.latency + ' ms' : 'Timeout')
					])
				]));
			}
		});
	},

	handleSaveSettings: function () {
		var mode = document.getElementById('tomfly-mode').value;
		var dnsMode = document.getElementById('tomfly-dns-mode').value;
		var tunEl = document.getElementById('tomfly-tun');
		var autostartEl = document.getElementById('tomfly-autostart');
		var trafficStatsEl = document.getElementById('tomfly-traffic-stats');
		var payload = { mode: mode, dns_mode: dnsMode };
		if (tunEl && !tunEl.disabled) payload.tun = tunEl.checked;
		if (autostartEl) payload.autostart = autostartEl.checked;
		if (trafficStatsEl) payload.traffic_stats = trafficStatsEl.checked;
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
