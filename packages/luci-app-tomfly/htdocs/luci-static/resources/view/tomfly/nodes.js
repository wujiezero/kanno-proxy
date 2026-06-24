'use strict';
'require view';
'require ui';
'require dom';
'require tomfly.api as api';
'require tomfly.kernel-profile as kprof';
'require tomfly.widgets as widgets';

widgets.mount();

function notify(content, ms) {
	var el = ui.addNotification(null, content);
	if (ms > 0) window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms);
}

var _menuBound = false;
function closeMenus(except) {
	var menus = document.querySelectorAll('.tomfly-menu');
	for (var i = 0; i < menus.length; i++)
		if (menus[i] !== except) menus[i].style.display = 'none';
}
function bindOutsideClose() {
	if (_menuBound) return;
	_menuBound = true;
	document.addEventListener('mousedown', function (e) {
		if (!(e.target.closest && e.target.closest('[data-menu]'))) closeMenus(null);
	});
}

return view.extend({
	load: function () {
		return Promise.all([
			L.resolveDefault(api.call('get_nodes'), { nodes: [] }),
			L.resolveDefault(api.call('get_proxy_options'), { now: '', all: [] })
		]);
	},

	nodeCard: function (n) {
		var self = this;
		var isActive = n.enabled && !n.incompat && n.name && n.name === this.active;

		var menu = E('div', { 'class': 'tomfly-menu', 'data-menu': '1', 'style': 'display:none' }, [
			E('div', { 'class': 'tomfly-menu-item', 'click': ui.createHandlerFn(this, 'handleEdit', n.id) },
				[widgets.icon('edit', 15), _('Edit')]),
			E('div', { 'class': 'tomfly-menu-item', 'click': ui.createHandlerFn(this, 'handleToggle', n) },
				[widgets.icon('power', 15), n.enabled ? _('Disable') : _('Enable')]),
			E('div', { 'class': 'tomfly-menu-item danger', 'click': ui.createHandlerFn(this, 'handleDelete', n) },
				[widgets.icon('trash', 15), _('Delete')])
		]);

		var chips = [];
		if (n.security && n.security !== 'none') chips.push(E('span', { 'class': 'tomfly-chip' }, n.security));
		chips.push(E('span', { 'class': 'tomfly-chip' }, n.transport || 'tcp'));

		var nameTags = [E('span', { 'class': 'tomfly-node-name' }, n.name || '(unnamed)')];
		if (isActive) nameTags.push(E('span', { 'class': 'tomfly-tag-on' }, _('In use')));
		if (!n.enabled) nameTags.push(E('span', { 'class': 'tomfly-tag-off' }, _('Disabled')));

		var right = [
			E('span', { 'class': 'tomfly-lat tomfly-lat-' + (n.latency ? (n.latency < 150 ? 'good' : (n.latency < 400 ? 'ok' : 'bad')) : 'none') },
				n.latency ? n.latency + ' ms' : '—')
		];
		if (isActive) {
			right.push(E('span', { 'class': 'tomfly-btn tomfly-btn-sm tomfly-btn-soft', 'style': 'cursor:default' },
				[widgets.icon('check', 14), _('In use')]));
		} else if (n.enabled && !n.incompat) {
			right.push(E('button', { 'class': 'tomfly-btn tomfly-btn-sm tomfly-btn-primary', 'click': ui.createHandlerFn(this, 'handleSetActive', n) }, _('Use')));
		}
		right.push(E('button', { 'class': 'tomfly-btn tomfly-btn-sm tomfly-btn-ghost', 'click': ui.createHandlerFn(this, 'handleTest', n.id) }, _('Test')));
		right.push(E('button', {
			'class': 'tomfly-iconbtn', 'data-menu': '1', 'title': _('More'),
			'click': function (ev) {
				ev.stopPropagation();
				var open = menu.style.display !== 'none';
				closeMenus(null);
				menu.style.display = open ? 'none' : 'block';
			}
		}, widgets.icon('dots', 18)));

		return E('div', { 'class': 'tomfly-node' + (isActive ? ' active' : '') + (n.enabled ? '' : ' off'), 'data-id': n.id }, [
			E('div', { 'class': 'tomfly-node-main' }, [
				E('span', { 'class': 'tomfly-reorder' }, [
					E('button', { 'title': _('Move up'), 'click': ui.createHandlerFn(this, 'handleReorder', n.id, 'up') }, '▲'),
					E('button', { 'title': _('Move down'), 'click': ui.createHandlerFn(this, 'handleReorder', n.id, 'down') }, '▼')
				]),
				widgets.typeBadge(n.type),
				E('div', { 'class': 'tomfly-node-body' }, [
					E('div', { 'class': 'tomfly-node-name-row' }, nameTags),
					E('div', { 'class': 'tomfly-node-sub' }, [
						E('span', { 'class': 'tomfly-node-addr' }, (n.server || '') + ':' + (n.port || ''))
					].concat(chips))
				]),
				E('div', { 'class': 'tomfly-node-r' }, right)
			]),
			n.incompat ? E('div', { 'class': 'tomfly-node-warn', 'title': n.incompat }, [
				widgets.icon('warn', 16),
				_('Incompatible with current kernel: ') + n.incompat
			]) : '',
			menu
		]);
	},

	renderList: function (nodes) {
		if (!nodes.length)
			return E('div', { 'class': 'tomfly-card tomfly-empty' }, _('No nodes yet — click "Add Node" to import.'));
		return E('div', { 'class': 'tomfly-nodes' }, nodes.map(this.nodeCard, this));
	},

	reload: function () {
		var self = this;
		return Promise.all([
			L.resolveDefault(api.call('get_nodes'), { nodes: [] }),
			L.resolveDefault(api.call('get_proxy_options'), { now: '', all: [] })
		]).then(function (r) {
			self.active = (r[1] && r[1].now) || '';
			var box = document.getElementById('tomfly-node-list');
			if (box) dom.content(box, self.renderList((r[0] || {}).nodes || []));
		});
	},

	render: function (data) {
		var r = data[0] || {};
		var nodes = r.nodes || [];
		var kernel = r.kernel || 'mihomo';
		this.active = (data[1] && data[1].now) || '';
		bindOutsideClose();

		return E('div', { 'class': 'tomfly-app' }, [
			widgets.nav('nodes', [kprof.badge(kernel)]),
			widgets.banner('info', [
				E('strong', {}, _('Node test: ')),
				_('tries direct TCP to the node server first; if that is blocked, probes the node outbound via the running kernel (not via AUTO/PROXY).')
			]),
			E('div', { 'class': 'tomfly-page-head' }, [
				E('div', { 'class': 'tomfly-page-head-l' }, [
					E('h2', { 'class': 'tomfly-h1' }, _('Proxy Nodes')),
					kprof.badge(kernel),
					E('span', { 'class': 'tomfly-count' }, _('%d total').format(nodes.length))
				]),
				E('div', { 'class': 'tomfly-actions' }, [
					E('button', { 'class': 'tomfly-btn tomfly-btn-ghost', 'click': ui.createHandlerFn(this, 'handleTestAll') },
						[widgets.icon('bolt', 15), _('Test All')]),
					E('button', { 'class': 'tomfly-btn tomfly-btn-primary', 'click': ui.createHandlerFn(this, 'handleAddDialog') },
						[widgets.icon('plus', 15), _('Add Node')])
				])
			]),
			E('div', { 'id': 'tomfly-node-list' }, this.renderList(nodes))
		]);
	},

	handleAddDialog: function () {
		ui.showModal(_('Add Proxy Node'), [
			E('div', { 'class': 'tomfly-modal' }, [
				E('p', { 'class': 'tomfly-muted' }, _('Paste node URIs (one per line). Supported: vless:// vmess:// trojan:// ss:// hy2:// tuic:// anytls:// naive+https://')),
				E('textarea', { 'class': 'tomfly-textarea', 'id': 'tomfly-add-uris', 'rows': 6, 'style': 'margin-top:10px' }),
				E('div', { 'class': 'tomfly-modal-actions' }, [
					E('button', { 'class': 'tomfly-btn tomfly-btn-ghost', 'click': ui.hideModal }, _('Cancel')),
					E('button', { 'class': 'tomfly-btn tomfly-btn-primary', 'click': ui.createHandlerFn(this, 'handleAddSubmit') }, _('Import'))
				])
			])
		]);
	},

	handleAddSubmit: function () {
		var ta = document.getElementById('tomfly-add-uris');
		var uris = (ta && ta.value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
		if (!uris.length) { ui.hideModal(); return; }
		var self = this, ok = 0, fail = 0;
		var chain = Promise.resolve();
		uris.forEach(function (uri) {
			chain = chain.then(function () {
				return api.call('add_node', { uri: uri }).then(function (r) {
					(r && r.ok) ? ok++ : fail++;
				}).catch(function () { fail++; });
			});
		});
		return chain.then(function () {
			ui.hideModal();
			notify(E('p', _('Imported %d node(s), %d failed').format(ok, fail)), 3500);
			return self.reload();
		});
	},

	handleSetActive: function (n) {
		var self = this;
		return api.call('select_node', { name: n.name }).then(function (r) {
			notify(E('p', (r && r.ok) ? (_('Active node → ') + n.name) : _('Switch failed (node not in group?)')), 2500);
			if (r && r.ok) return self.reload();
		});
	},

	_setTesting: function (id) {
		var card = document.querySelector('.tomfly-node[data-id="' + id + '"]');
		var latEl = card && card.querySelector('.tomfly-lat');
		if (latEl) { latEl.className = 'tomfly-lat tomfly-lat-none'; latEl.textContent = '…'; }
	},

	_applyLatency: function (id, ok, latency) {
		var card = document.querySelector('.tomfly-node[data-id="' + id + '"]');
		var latEl = card && card.querySelector('.tomfly-lat');
		if (!latEl) return;
		if (ok && latency != null) {
			latEl.className = 'tomfly-lat tomfly-lat-' + (latency < 150 ? 'good' : (latency < 400 ? 'ok' : 'bad'));
			latEl.textContent = latency + ' ms';
		} else {
			latEl.className = 'tomfly-lat tomfly-lat-bad';
			latEl.textContent = _('timeout');
		}
	},

	handleTest: function (id) {
		var self = this;
		this._setTesting(id);
		return api.call('test_node', { id: id }).then(function (r) {
			self._applyLatency(id, r && r.ok, r && r.latency);
		});
	},

	handleTestAll: function () {
		var self = this;
		var cards = document.querySelectorAll('.tomfly-node[data-id]');
		var ids = [];
		for (var i = 0; i < cards.length; i++) {
			var id = cards[i].getAttribute('data-id');
			ids.push(id);
			self._setTesting(id);
		}
		var chain = Promise.resolve();
		ids.forEach(function (id) {
			chain = chain.then(function () {
				return api.call('test_node', { id: id }).then(function (r) {
					self._applyLatency(id, r && r.ok, r && r.latency);
				});
			});
		});
		return chain.then(function () { notify(E('p', _('Latency test finished')), 2500); });
	},

	handleReorder: function (id, dir) {
		var self = this;
		closeMenus(null);
		return api.call('reorder_node', { id: id, dir: dir }).then(function (r) {
			if (r && r.ok) return self.reload();
			ui.addNotification(null, E('p', _('Reorder failed: ') + ((r && r.error) || 'unknown')), 'danger');
		});
	},

	handleToggle: function (n) {
		var self = this;
		closeMenus(null);
		return api.call('toggle_node', { id: n.id, enabled: !n.enabled }).then(function () {
			return self.reload();
		});
	},

	handleDelete: function (n) {
		var self = this;
		closeMenus(null);
		ui.showModal(_('Delete node?'), [
			E('div', { 'class': 'tomfly-modal' }, [
				E('p', {}, _('Delete "%s"? This cannot be undone.').format(n.name || n.id)),
				E('div', { 'class': 'tomfly-modal-actions' }, [
					E('button', { 'class': 'tomfly-btn tomfly-btn-ghost', 'click': ui.hideModal }, _('Cancel')),
					E('button', {
						'class': 'tomfly-btn tomfly-btn-danger',
						'click': ui.createHandlerFn(this, function () {
							return api.call('del_node', { id: n.id }).then(function () {
								ui.hideModal();
								notify(E('p', _('Node deleted')), 2500);
								return self.reload();
							});
						})
					}, _('Delete'))
				])
			])
		]);
	},

	handleEdit: function (id) {
		var self = this;
		closeMenus(null);
		return api.call('get_node', { id: id }).then(function (node) {
			if (!node || !node.id) {
				ui.addNotification(null, E('p', _('Node not found')), 'danger');
				return;
			}
			var fields = ['name', 'server', 'port', 'uuid', 'password', 'security',
				'sni', 'fp', 'pbk', 'sid', 'flow', 'transport',
				'transport_host', 'transport_path', 'method'];
			var rows = fields.filter(function (k) {
				return node[k] !== undefined && node[k] !== null && node[k] !== '';
			}).map(function (k) {
				var inp = E('input', { 'class': 'tomfly-input', 'type': 'text', 'data-field': k, 'value': node[k] });
				return E('div', { 'style': 'margin-bottom:12px' }, [
					E('div', { 'class': 'tomfly-flabel', 'style': 'margin-top:0' }, k),
					inp
				]);
			});
			ui.showModal(_('Edit Node: ') + (node.name || node.id), [
				E('div', { 'class': 'tomfly-modal' }, [
					E('div', { 'class': 'tomfly-edit-fields', 'style': 'max-height:400px;overflow-y:auto;padding-right:4px' }, rows),
					E('div', { 'class': 'tomfly-modal-actions' }, [
						E('button', { 'class': 'tomfly-btn tomfly-btn-ghost', 'click': ui.hideModal }, _('Cancel')),
						E('button', {
							'class': 'tomfly-btn tomfly-btn-primary',
							'click': ui.createHandlerFn(self, function () {
								var inputs = document.querySelectorAll('.tomfly-edit-fields input[data-field]');
								var changed = {};
								for (var i = 0; i < inputs.length; i++) {
									var k = inputs[i].getAttribute('data-field');
									var v = inputs[i].value;
									if (v !== (node[k] || '')) changed[k] = v;
								}
								if (!Object.keys(changed).length) { ui.hideModal(); return; }
								return api.call('edit_node', { id: id, fields: changed }).then(function (r) {
									ui.hideModal();
									if (r && r.ok) {
										notify(E('p', _('Node updated — restart proxy to apply')), 3500);
										return self.reload();
									}
									var errMsg = (r && r.error) || _('Save failed — check field values and try again');
									ui.addNotification(null,
										E('div', {}, [E('strong', {}, _('Failed to save node: ')), E('span', {}, errMsg)]),
										'danger');
								});
							})
						}, _('Save'))
					])
				])
			]);
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
