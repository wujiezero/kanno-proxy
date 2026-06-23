'use strict';
'require view';
'require ui';
'require dom';
'require tomfly.api as api';

document.querySelector('head').appendChild(E('link', {
	'rel': 'stylesheet', 'type': 'text/css',
	'href': L.resource('view/tomfly/style.css')
}));

function notify(content, ms) {
	var el = ui.addNotification(null, content);
	if (ms > 0) window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms);
}

function latClass(ms) {
	if (!ms) return 'tomfly-lat-none';
	if (ms < 150) return 'tomfly-lat-good';
	if (ms < 400) return 'tomfly-lat-ok';
	return 'tomfly-lat-bad';
}

return view.extend({
	load: function () {
		return L.resolveDefault(api.call('get_nodes'), { nodes: [] });
	},

	nodeCard: function (n) {
		return E('div', { 'class': 'tomfly-node' + (n.enabled ? '' : ' off'), 'data-id': n.id }, [
			E('div', { 'class': 'tomfly-node-head' }, [
				E('span', { 'class': 'tomfly-badge ' + (n.type || '') }, (n.type || '?').toUpperCase()),
				E('span', { 'class': 'tomfly-node-name' }, n.name || '(unnamed)'),
				E('span', { 'class': 'tomfly-addr' }, (n.server || '') + ':' + (n.port || '')),
				E('span', { 'class': 'tomfly-meta' }, [
					E('span', {}, (n.security && n.security !== 'none') ? n.security : 'no-tls'),
					E('span', {}, n.transport || 'tcp')
				]),
				E('span', { 'class': 'tomfly-lat ' + latClass(n.latency) }, n.latency ? n.latency + 'ms' : '—')
			]),
			E('div', { 'class': 'tomfly-actions' }, [
				(n.enabled && !n.incompat) ? E('button', { 'class': 'cbi-button cbi-button-positive', 'click': ui.createHandlerFn(this, 'handleSetActive', n) }, _('Use')) : '',
				E('button', { 'class': 'cbi-button cbi-button-action', 'click': ui.createHandlerFn(this, 'handleTest', n.id) }, _('Test')),
				E('button', { 'class': 'cbi-button cbi-button-neutral', 'click': ui.createHandlerFn(this, 'handleEdit', n.id) }, _('Edit')),
				E('button', { 'class': 'cbi-button cbi-button-neutral', 'click': ui.createHandlerFn(this, 'handleToggle', n) }, n.enabled ? _('Disable') : _('Enable')),
				E('button', { 'class': 'cbi-button cbi-button-remove', 'click': ui.createHandlerFn(this, 'handleDelete', n) }, _('Delete'))
			]),
			n.incompat ? E('div', { 'class': 'tomfly-node-warn', 'title': n.incompat }, [
				E('span', {}, '⚠ ' + _('Incompatible with current kernel: ') + n.incompat)
			]) : ''
		]);
	},

	renderList: function (nodes) {
		if (!nodes.length)
			return E('div', { 'class': 'tomfly-card tomfly-empty' }, _('No nodes yet — click "Add Node" to import.'));
		return E('div', {}, nodes.map(this.nodeCard, this));
	},

	reload: function () {
		var self = this;
		return L.resolveDefault(api.call('get_nodes'), { nodes: [] }).then(function (r) {
			var box = document.getElementById('tomfly-node-list');
			if (box) dom.content(box, self.renderList(r.nodes || []));
		});
	},

	render: function (r) {
		var nodes = (r && r.nodes) || [];
		return E('div', { 'class': 'tomfly' }, [
			E('div', { 'class': 'tomfly-row', 'style': 'margin-bottom:14px' }, [
				E('h3', { 'style': 'margin:0' }, _('Proxy Nodes')),
				E('div', { 'class': 'tomfly-actions' }, [
					E('button', { 'class': 'cbi-button cbi-button-action', 'click': ui.createHandlerFn(this, 'handleTestAll') }, _('Test All')),
					E('button', { 'class': 'cbi-button cbi-button-add important', 'click': ui.createHandlerFn(this, 'handleAddDialog') }, _('Add Node'))
				])
			]),
			E('div', { 'id': 'tomfly-node-list' }, this.renderList(nodes))
		]);
	},

	handleAddDialog: function () {
		var self = this;
		ui.showModal(_('Add Proxy Node'), [
			E('p', { 'class': 'tomfly-muted' }, _('Paste node URIs (one per line). Supported: vless:// vmess:// trojan:// ss:// hy2:// tuic:// anytls:// naive+https://')),
			E('textarea', { 'class': 'cbi-input-textarea', 'id': 'tomfly-add-uris', 'rows': 6, 'style': 'width:100%;font-family:var(--font-mono,monospace)' }),
			E('div', { 'class': 'right', 'style': 'margin-top:14px' }, [
				E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('Cancel')), ' ',
				E('button', {
					'class': 'cbi-button cbi-button-add important',
					'click': ui.createHandlerFn(this, 'handleAddSubmit')
				}, _('Import'))
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
		return api.call('select_node', { name: n.name }).then(function (r) {
			notify(E('p', (r && r.ok) ? (_('Active node → ') + n.name) : _('Switch failed (node not in group?)')), 2500);
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
			latEl.className = 'tomfly-lat ' + latClass(latency);
			latEl.textContent = latency + 'ms';
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
		// Test sequentially, updating each card's badge as its result arrives.
		var chain = Promise.resolve();
		ids.forEach(function (id) {
			chain = chain.then(function () {
				return api.call('test_node', { id: id }).then(function (r) {
					self._applyLatency(id, r && r.ok, r && r.latency);
				});
			});
		});
		return chain.then(function () {
			notify(E('p', _('Latency test finished')), 2500);
		});
	},

	handleToggle: function (n) {
		var self = this;
		return api.call('toggle_node', { id: n.id, enabled: !n.enabled }).then(function () {
			return self.reload();
		});
	},

	handleDelete: function (n) {
		var self = this;
		ui.showModal(_('Delete node?'), [
			E('p', {}, _('Delete "%s"? This cannot be undone.').format(n.name || n.id)),
			E('div', { 'class': 'right' }, [
				E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('Cancel')), ' ',
				E('button', {
					'class': 'cbi-button cbi-button-remove important',
					'click': ui.createHandlerFn(this, function () {
						return api.call('del_node', { id: n.id }).then(function () {
							ui.hideModal();
							notify(E('p', _('Node deleted')), 2500);
							return self.reload();
						});
					})
				}, _('Delete'))
			])
		]);
	},

	handleEdit: function (id) {
		var self = this;
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
				return E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title', 'style': 'min-width:120px' }, k),
					E('div', { 'class': 'cbi-value-field' }, [
						E('input', {
							'class': 'cbi-input-text', 'type': 'text',
							'data-field': k, 'value': node[k],
							'style': 'width:100%'
						})
					])
				]);
			});
			ui.showModal(_('Edit Node: ') + (node.name || node.id), [
				E('div', { 'class': 'tomfly-edit-fields', 'style': 'max-height:400px;overflow-y:auto' }, rows),
				E('div', { 'class': 'right', 'style': 'margin-top:14px' }, [
					E('button', { 'class': 'cbi-button', 'click': ui.hideModal }, _('Cancel')), ' ',
					E('button', {
						'class': 'cbi-button cbi-button-save important',
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
									notify(E('p', _('Node updated')), 2500);
									return self.reload();
								}
								ui.addNotification(null, E('p', _('Save failed')), 'danger');
							});
						})
					}, _('Save'))
				])
			]);
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
