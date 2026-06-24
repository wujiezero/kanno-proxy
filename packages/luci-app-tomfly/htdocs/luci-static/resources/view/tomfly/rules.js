'use strict';
'require view';
'require ui';
'require tomfly.api as api';
'require tomfly.kernel-profile as kprof';
'require tomfly.widgets as widgets';

widgets.mount();

function notify(content, ms) {
	var el = ui.addNotification(null, content);
	if (ms > 0) window.setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, ms);
}

function policy(id, value) {
	var el = E('select', { 'class': 'tomfly-select', 'id': id }, [
		E('option', { 'value': 'PROXY' }, _('Proxy')),
		E('option', { 'value': 'DIRECT' }, _('Direct'))
	]);
	el.value = value || 'DIRECT';
	return el;
}

function policyRow(label, field, desc) {
	return E('div', { 'class': 'tomfly-setting' }, [
		E('div', {}, [
			E('div', { 'class': 'tomfly-setting-label' }, label),
			desc ? E('div', { 'class': 'tomfly-setting-desc' }, desc) : ''
		]),
		field
	]);
}

return view.extend({
	load: function () {
		return Promise.all([
			L.resolveDefault(api.call('get_rules'), {}),
			L.resolveDefault(api.call('get_global'), {})
		]);
	},

	render: function (data) {
		var r = data[0] || {};
		var kernel = (data[1] || {}).kernel || 'mihomo';
		var kp = kprof.profile(kernel);

		var bannerText = kp.geoRemote
			? [E('strong', {}, _('sing-box: ')), _('Uses local geoip-cn.srs / geosite-cn.srs under /etc/tomfly/geodata/ when present. Upload them on the Kernel page (sing-box Rule-Sets card) if CDN is unreachable.')]
			: [E('strong', {}, _('mihomo: ')), _('GeoSite/GeoIP CN rules use local geodata files under /etc/tomfly/geodata/.')];

		var steps = [
			_('Priority: Force Proxy › Force Direct › GeoSite / GeoIP › Default'),
			_('One entry per line: domain suffix, full domain, or CIDR'),
			_('LAN addresses (192.168.x.x …) are always direct'),
			_('Restart the kernel after saving for changes to take effect')
		];

		return E('div', { 'class': 'tomfly-app' }, [
			widgets.nav('rules', [kprof.badge(kernel)]),
			widgets.banner('info', bannerText),
			E('div', { 'class': 'tomfly-grid-2' }, [
				E('div', { 'class': 'tomfly-card' }, [
					E('div', { 'class': 'tomfly-eyebrow', 'style': 'margin-bottom:14px' }, _('Routing Policy')),
					policyRow(_('GeoSite CN'), policy('k-geosite', r.geosite_cn)),
					policyRow(_('GeoIP CN'), policy('k-geoip', r.geoip_cn)),
					policyRow(_('Default Policy'), policy('k-default', r.default_policy), _('Used when no rule matches.'))
				]),
				E('div', { 'class': 'tomfly-card' }, [
					E('div', { 'class': 'tomfly-eyebrow', 'style': 'margin-bottom:14px' }, _('How rules are applied')),
					E('div', { 'class': 'tomfly-steps' }, steps.map(function (t, i) {
						return E('div', { 'class': 'tomfly-step' }, [
							E('span', { 'class': 'tomfly-step-n' }, String(i + 1)), t
						]);
					}))
				])
			]),
			E('div', { 'class': 'tomfly-grid-2 mt' }, [
				E('div', { 'class': 'tomfly-card' }, [
					E('div', { 'class': 'tomfly-list-head' }, [
						E('span', { 'class': 'tomfly-list-dot proxy' }),
						E('span', { 'class': 'tomfly-card-title' }, _('Force Proxy'))
					]),
					E('textarea', { 'class': 'tomfly-textarea', 'id': 'k-fproxy', 'rows': 9, 'placeholder': 'google.com\n8.8.8.8/32\n*.googleapis.com' },
						(r.force_proxy || []).join('\n'))
				]),
				E('div', { 'class': 'tomfly-card' }, [
					E('div', { 'class': 'tomfly-list-head' }, [
						E('span', { 'class': 'tomfly-list-dot direct' }),
						E('span', { 'class': 'tomfly-card-title' }, _('Force Direct'))
					]),
					E('textarea', { 'class': 'tomfly-textarea', 'id': 'k-fdirect', 'rows': 9, 'placeholder': 'localserver.home\n192.168.100.0/24' },
						(r.force_direct || []).join('\n'))
				])
			]),
			E('div', { 'class': 'tomfly-actions-end' }, [
				E('button', { 'class': 'tomfly-btn tomfly-btn-primary', 'click': ui.createHandlerFn(this, 'handleSaveRules') }, _('Save'))
			])
		]);
	},

	handleSaveRules: function () {
		function lines(id) {
			var el = document.getElementById(id);
			return (el && el.value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
		}
		var payload = {
			geosite_cn: document.getElementById('k-geosite').value,
			geoip_cn: document.getElementById('k-geoip').value,
			default_policy: document.getElementById('k-default').value,
			force_proxy: lines('k-fproxy'),
			force_direct: lines('k-fdirect')
		};
		return api.call('save_rules', payload).then(function (r) {
			if (r && r.ok)
				notify(E('p', _('Rules saved — restart to apply')), 3500);
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
