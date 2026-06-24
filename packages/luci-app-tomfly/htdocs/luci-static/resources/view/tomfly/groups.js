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

return view.extend({
	load: function () {
		return Promise.all([
			L.resolveDefault(api.call('get_groups'), { groups: [] }),
			L.resolveDefault(api.call('get_nodes'), { nodes: [] }),
			L.resolveDefault(api.call('get_global'), {})
		]);
	},

	groupCard: function (g, gi) {
		var self = this;

		var name = E('input', { 'class': 'tomfly-input', 'value': g.name || '' });
		name.addEventListener('change', function () { g.name = this.value; });

		var type = E('select', { 'class': 'tomfly-select' }, [
			E('option', { 'value': 'url-test' }, _('URL Test (auto)')),
			E('option', { 'value': 'fallback' }, _('Fallback')),
			E('option', { 'value': 'load-balance' }, _('Load Balance')),
			E('option', { 'value': 'select' }, _('Manual Select'))
		]);
		type.value = g.type || 'url-test';
		type.addEventListener('change', function () { g.type = this.value; });

		var interval = E('input', { 'class': 'tomfly-input', 'type': 'number', 'value': g.interval || 300 });
		interval.addEventListener('change', function () { g.interval = parseInt(this.value, 10) || 300; });

		var members = E('div', { 'class': 'tomfly-members' }, (g.proxies || []).map(function (p) {
			return E('span', { 'class': 'tomfly-member' }, [
				p,
				E('button', { 'title': _('Remove'), 'click': function () { g.proxies.splice(g.proxies.indexOf(p), 1); self.refresh(); } },
					widgets.icon('close', 13))
			]);
		}));

		var adder = E('select', { 'class': 'tomfly-member-add' }, [
			E('option', { 'value': '' }, _('+ add node'))
		].concat(this.nodeNames.map(function (n) { return E('option', { 'value': n }, n); })));
		adder.addEventListener('change', function () {
			if (this.value && (g.proxies || (g.proxies = [])).indexOf(this.value) < 0) {
				g.proxies.push(this.value);
				self.refresh();
			}
			this.value = '';
		});
		members.appendChild(adder);

		return E('div', { 'class': 'tomfly-card tomfly-group' }, [
			E('div', { 'class': 'tomfly-group-grid' }, [
				E('div', {}, [E('div', { 'class': 'tomfly-flabel', 'style': 'margin-top:0' }, _('Name')), name]),
				E('div', {}, [E('div', { 'class': 'tomfly-flabel', 'style': 'margin-top:0' }, _('Type')), type]),
				E('div', {}, [E('div', { 'class': 'tomfly-flabel', 'style': 'margin-top:0' }, _('Interval (s)')), interval]),
				E('div', {
					'class': 'tomfly-iconbtn danger', 'title': _('Delete group'),
					'click': function () { self.groups.splice(gi, 1); self.refresh(); }
				}, widgets.icon('trash', 16))
			]),
			E('div', { 'class': 'tomfly-flabel', 'style': 'margin:18px 0 9px' }, _('Nodes in this group')),
			members
		]);
	},

	refresh: function () {
		var box = document.getElementById('tomfly-groups');
		if (box) dom.content(box, this.renderList());
	},

	renderList: function () {
		if (!this.groups.length)
			return E('div', { 'class': 'tomfly-card tomfly-empty' }, _('No groups yet.'));
		return E('div', { 'class': 'tomfly-groups' }, this.groups.map(this.groupCard, this));
	},

	render: function (data) {
		this.groups = ((data[0] || {}).groups) || [];
		this.nodeNames = (((data[1] || {}).nodes) || []).map(function (n) { return n.name; }).filter(Boolean);
		var kernel = (data[2] || {}).kernel || 'mihomo';
		var self = this;

		return E('div', { 'class': 'tomfly-app' }, [
			widgets.nav('groups', [kprof.badge(kernel)]),
			widgets.banner('warn', [
				E('strong', {}, kprof.profile(kernel).label + ': '),
				_('Custom groups on this page are saved to UCI but not yet applied to the running config. ' +
					'Both kernels auto-generate AUTO (url-test) and PROXY (selector) groups.')
			]),
			E('div', { 'class': 'tomfly-page-head' }, [
				E('div', { 'class': 'tomfly-page-head-l' }, [
					E('h2', { 'class': 'tomfly-h1' }, _('Proxy Groups')),
					kprof.badge(kernel)
				]),
				E('button', {
					'class': 'tomfly-btn tomfly-btn-primary',
					'click': function () {
						self.groups.push({ id: '', name: _('New Group'), type: 'url-test', proxies: [], interval: 300, tolerance: 50 });
						self.refresh();
					}
				}, [widgets.icon('plus', 15), _('New Group')])
			]),
			E('div', { 'id': 'tomfly-groups' }, this.renderList()),
			E('div', { 'class': 'tomfly-actions-end' }, [
				E('button', { 'class': 'tomfly-btn tomfly-btn-primary', 'click': ui.createHandlerFn(this, 'handleSaveGroups') }, _('Save Groups'))
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
