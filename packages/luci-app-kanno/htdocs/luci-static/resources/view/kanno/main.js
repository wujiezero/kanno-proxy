'use strict';
'require view';

// Render KannoProxy SPA embedded in the LuCI content area via iframe.
// Using window.location.replace() was wrong — it replaced the entire page.
return view.extend({
    handleSave: null,
    handleSaveApply: null,
    handleReset: null,

    render: function() {
        // Negative margin cancels LuCI's content-area padding so the iframe
        // runs edge-to-edge. Adjust if the LuCI version uses different padding.
        var wrap = E('div', {
            'style': 'margin: -2rem -2rem -2rem; padding: 0; overflow: hidden;'
        });

        var frame = E('iframe', {
            'src': '/luci-static/kanno/',
            'id': 'kanno-spa',
            'style': [
                'width: 100%',
                'border: none',
                'display: block',
                // Subtract ~55 px for LuCI's fixed top bar
                'height: ' + Math.max(500, window.innerHeight - 55) + 'px'
            ].join('; ')
        });

        // Keep iframe height in sync with window resize
        window.addEventListener('resize', function() {
            frame.style.height = Math.max(500, window.innerHeight - 55) + 'px';
        });

        wrap.appendChild(frame);
        return wrap;
    }
});
