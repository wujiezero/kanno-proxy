'use strict';
'require view';

// Redirect to the self-contained KannoProxy SPA
return view.extend({
    handleSave: null,
    handleSaveApply: null,
    handleReset: null,

    render: function() {
        window.location.replace('/luci-static/kanno/');
        return E('p', { 'style': 'padding:2em;color:#8b949e' }, [
            'Redirecting to KannoProxy… ',
            E('a', { 'href': '/luci-static/kanno/' }, 'click here if not redirected')
        ]);
    }
});
