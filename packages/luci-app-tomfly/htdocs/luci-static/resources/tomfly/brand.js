'use strict';
'require baseclass';

return baseclass.extend({
	page: function (pageTitle, children) {
		var nodes = Array.isArray(children) ? children : [children];
		return E('div', { 'class': 'tomfly' }, [
			E('img', {
				'class': 'tomfly-logo-corner',
				'src': L.resource('view/tomfly/logo.png'),
				'alt': 'TomFly',
				'width': 100,
				'height': 100
			})
		].concat(nodes));
	}
});
