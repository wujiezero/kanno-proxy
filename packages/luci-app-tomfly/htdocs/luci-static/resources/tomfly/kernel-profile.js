'use strict';
'require baseclass';

/* Kernel-specific UI capabilities — keep in sync with tomfly-core dataplane logic. */
return baseclass.extend({
	normalize: function (kernel, versionHint) {
		var k = (kernel || '').toString().toLowerCase().replace(/-/g, '');
		if (k === 'singbox') return 'singbox';
		if (versionHint && /sing-box|singbox/i.test(String(versionHint)))
			return 'singbox';
		return 'mihomo';
	},

	profile: function (kernel, versionHint) {
		var id = this.normalize(kernel, versionHint);
		var sb = id === 'singbox';
		return {
			kernel: id,
			label: sb ? 'sing-box' : 'mihomo',
			tunConfigurable: !sb,
			tunAlwaysOn: sb,
			nodeTestAccurate: !sb,
			geoRemote: sb,
			dnsFirstOnly: sb,
			groupsInConfig: false
		};
	},

	badge: function (kernel, versionHint) {
		var p = this.profile(kernel, versionHint);
		return E('span', {
			'class': 'tomfly-pill tomfly-kernel-pill ' + (p.kernel === 'singbox' ? 'tomfly-pill-sb' : 'tomfly-pill-mh')
		}, p.label);
	}
});
