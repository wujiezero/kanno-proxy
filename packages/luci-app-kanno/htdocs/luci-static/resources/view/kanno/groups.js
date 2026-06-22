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

return view.extend({
	load: function () {
		return Promise.all([
			L.resolveDefault(api.call('get_groups'), { groups: [] }),
			L.resolveDefault(api.call('get_nodes'), { nodes: [] })
		]);
	},

	groupCard: function (g, gi) {
		var self = this;

		var name = E('input', { 'class': 'cbi-input-text', 'value': g.name || '', 'style': 'min-width:140px' });
		name.addEventListener('change', function () { g.name = this.value; });

		var type = E('select', { 'class': 'cbi-input-select' }, [
			E('option', { 'value': 'url-test' }, _('URL Test (auto)')),
			E('option', { 'value': 'fallback' }, _('Fallback')),
			E('option', { 'value': 'load-balance' }, _('Load Balance')),
			E('option', { 'value': 'select' }, _('Manual Select'))
		]);
		type.value = g.type || 'url-test';
		type.addEventListener('change', function () { g.type = this.value; });

		var interval = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'value': g.interval || 300, 'style': 'width:90px' });
		interval.addEventListener('change', function () { g.interval = parseInt(this.value, 10) || 300; });

		var tags = E('div', { 'class': 'kanno-tags' }, (g.proxies || []).map(function (p) {
			return E('span', { 'class': 'kanno-tag' }, [
				p,
				E('button', { 'click': function () { g.proxies.splice(g.proxies.indexOf(p), 1); self.refresh(); } }, '×')
			]);
		}));

		var adder = E('select', { 'class': 'cbi-input-select', 'style': 'width:auto' }, [
			E('option', { 'value': '' }, _('+ add node'))
		].concat(this.nodeNames.map(function (n) { return E('option', { 'value': n }, n); })));
		adder.addEventListener('change', function () {
			if (this.value && (g.proxies || (g.proxies = [])).indexOf(this.value) < 0) {
				g.proxies.push(this.value);
				self.refresh();
			}
			this.value = '';
		});
		tags.appendChild(adder);

		return E('div', { 'class': 'kanno-card' }, [
			E('div', { 'class': 'kanno-row', 'style': 'align-items:flex-end;gap:14px' }, [
				E('div', { 'class': 'kanno-field', 'style': 'margin:0' }, [E('label', {}, _('Name')), name]),
				E('div', { 'class': 'kanno-field', 'style': 'margin:0' }, [E('label', {}, _('Type')), type]),
				E('div', { 'class': 'kanno-field', 'style': 'margin:0' }, [E('label', {}, _('Interval (s)')), interval]),
				E('button', { 'class': 'cbi-button cbi-button-remove', 'click': function () { self.groups.splice(gi, 1); self.refresh(); } }, _('Delete'))
			]),
			E('div', { 'class': 'kanno-field', 'style': 'margin:12px 0 0' }, [
				E('label', {}, _('Nodes in this group')),
				tags
			])
		]);
	},

	refresh: function () {
		var box = document.getElementById('kanno-groups');
		if (box) dom.content(box, this.renderList());
	},

	renderList: function () {
		if (!this.groups.length)
			return E('div', { 'class': 'kanno-card kanno-empty' }, _('No groups yet.'));
		return E('div', {}, this.groups.map(this.groupCard, this));
	},

	render: function (data) {
		this.groups = ((data[0] || {}).groups) || [];
		this.nodeNames = (((data[1] || {}).nodes) || []).map(function (n) { return n.name; }).filter(Boolean);
		var self = this;

		return E('div', { 'class': 'kanno' }, [
			E('div', { 'class': 'kanno-row', 'style': 'margin-bottom:14px' }, [
				E('h3', { 'style': 'margin:0' }, _('Proxy Groups')),
				E('button', {
					'class': 'cbi-button cbi-button-add important',
					'click': function () {
						self.groups.push({ id: '', name: _('New Group'), type: 'url-test', proxies: [], interval: 300, tolerance: 50 });
						self.refresh();
					}
				}, _('New Group'))
			]),
			E('div', { 'id': 'kanno-groups' }, this.renderList()),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', { 'class': 'cbi-button cbi-button-save important', 'click': ui.createHandlerFn(this, 'handleSaveGroups') }, _('Save Groups'))
			])
		]);
	},

	handleSaveGroups: function () {
		return api.call('save_groups', { groups: this.groups }).then(function (r) {
			if (r && r.ok)
				notify(E('p', _('Groups saved — restart to apply')), 3500);
			else
				ui.addNotification(null, E('p', _('Save failed')), 'danger');
		}).catch(function (e) {
			ui.addNotification(null, E('p', _('Save failed: ') + e.message), 'danger');
		});
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
