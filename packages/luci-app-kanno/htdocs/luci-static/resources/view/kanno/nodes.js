'use strict';
'require view';
'require ui';
'require dom';
'require kanno.api as api';

document.querySelector('head').appendChild(E('link', {
	'rel': 'stylesheet', 'type': 'text/css',
	'href': L.resource('view/kanno/style.css')
}));

function notify(content, ms) {
	var el = ui.addNotification(null, content);
	if (ms > 0) window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms);
}

function latClass(ms) {
	if (!ms) return 'kanno-lat-none';
	if (ms < 150) return 'kanno-lat-good';
	if (ms < 400) return 'kanno-lat-ok';
	return 'kanno-lat-bad';
}

return view.extend({
	load: function () {
		return L.resolveDefault(api.call('get_nodes'), { nodes: [] });
	},

	nodeCard: function (n) {
		var self = this;
		return E('div', { 'class': 'kanno-node' + (n.enabled ? '' : ' off'), 'data-id': n.id }, [
			E('div', { 'class': 'kanno-node-head' }, [
				E('span', { 'class': 'kanno-badge ' + (n.type || '') }, (n.type || '?').toUpperCase()),
				E('span', { 'class': 'kanno-node-name' }, n.name || '(unnamed)'),
				E('span', { 'class': 'kanno-lat ' + latClass(n.latency) }, n.latency ? n.latency + 'ms' : '—')
			]),
			E('div', { 'class': 'kanno-addr' }, (n.server || '') + ':' + (n.port || '')),
			E('div', { 'class': 'kanno-meta' }, [
				E('span', {}, (n.security && n.security !== 'none') ? n.security : 'no-tls'),
				E('span', {}, n.transport || 'tcp')
			]),
			E('div', { 'class': 'kanno-actions', 'style': 'justify-content:flex-end' }, [
				E('button', { 'class': 'cbi-button cbi-button-action', 'click': ui.createHandlerFn(this, 'handleTest', n.id) }, _('Test')),
				E('button', { 'class': 'cbi-button cbi-button-neutral', 'click': ui.createHandlerFn(this, 'handleToggle', n) }, n.enabled ? _('Disable') : _('Enable')),
				E('button', { 'class': 'cbi-button cbi-button-remove', 'click': ui.createHandlerFn(this, 'handleDelete', n) }, _('Delete'))
			])
		]);
	},

	renderList: function (nodes) {
		if (!nodes.length)
			return E('div', { 'class': 'kanno-card kanno-empty' }, _('No nodes yet — click "Add Node" to import.'));
		return E('div', {}, nodes.map(this.nodeCard, this));
	},

	reload: function () {
		var self = this;
		return L.resolveDefault(api.call('get_nodes'), { nodes: [] }).then(function (r) {
			var box = document.getElementById('kanno-node-list');
			if (box) dom.content(box, self.renderList(r.nodes || []));
		});
	},

	render: function (r) {
		var nodes = (r && r.nodes) || [];
		return E('div', { 'class': 'kanno' }, [
			E('div', { 'class': 'kanno-row', 'style': 'margin-bottom:14px' }, [
				E('h3', { 'style': 'margin:0' }, _('Proxy Nodes')),
				E('div', { 'class': 'kanno-actions' }, [
					E('button', { 'class': 'cbi-button cbi-button-action', 'click': ui.createHandlerFn(this, 'handleTestAll') }, _('Test All')),
					E('button', { 'class': 'cbi-button cbi-button-add important', 'click': ui.createHandlerFn(this, 'handleAddDialog') }, _('Add Node'))
				])
			]),
			E('div', { 'id': 'kanno-node-list' }, this.renderList(nodes))
		]);
	},

	handleAddDialog: function () {
		var self = this;
		ui.showModal(_('Add Proxy Node'), [
			E('p', { 'class': 'kanno-muted' }, _('Paste node URIs (one per line). Supported: vless:// vmess:// trojan:// ss:// hy2:// tuic:// naive+https://')),
			E('textarea', { 'class': 'cbi-input-textarea', 'id': 'kanno-add-uris', 'rows': 6, 'style': 'width:100%;font-family:var(--font-mono,monospace)' }),
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
		var ta = document.getElementById('kanno-add-uris');
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

	handleTest: function (id) {
		var self = this;
		return api.call('test_node', { id: id }).then(function (r) {
			notify(E('p', (r && r.ok) ? _('Latency: %dms').format(r.latency) : _('Connection timed out')), 3000);
			return self.reload();
		});
	},

	handleTestAll: function () {
		var self = this;
		return api.call('test_all_nodes').then(function () {
			notify(E('p', _('Latency test finished')), 3000);
			return self.reload();
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

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
