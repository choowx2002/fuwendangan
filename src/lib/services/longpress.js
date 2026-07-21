export function longpress(node, options = {}) {
    let timer;

    // Fallback to 500ms if no duration is specified
    const duration = options.duration || 500;
    const callback = options.onLongPress;

    function handleStart(event) {
        // Prevent launching on right clicks
        if (event.type === 'mousedown' && event.button !== 0) return;

        timer = setTimeout(() => {
            if (typeof callback === 'function') {
                callback(event);
            } else {
                // Svelte 3/4 custom event fallback
                node.dispatchEvent(new CustomEvent('longpress', { detail: event }));
            }
        }, duration);
    }

    function handleCancel() {
        clearTimeout(timer);
    }

    // Mouse events for desktop
    node.addEventListener('mousedown', handleStart);
    node.addEventListener('mouseup', handleCancel);
    node.addEventListener('mouseleave', handleCancel);

    // Touch events for mobile devices
    node.addEventListener('touchstart', handleStart, { passive: true });
    node.addEventListener('touchend', handleCancel);
    node.addEventListener('touchcancel', handleCancel);

    return {
        destroy() {
            node.removeEventListener('mousedown', handleStart);
            node.removeEventListener('mouseup', handleCancel);
            node.removeEventListener('mouseleave', handleCancel);
            node.removeEventListener('touchstart', handleStart);
            node.removeEventListener('touchend', handleCancel);
            node.removeEventListener('touchcancel', handleCancel);
            clearTimeout(timer);
        }
    };
}
