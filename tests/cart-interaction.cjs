const fs = require('node:fs');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
const { test } = require('node:test');

// Runs the real browser scripts with controlled network replies to exercise request races.
test('cart browser interactions', { timeout: 30000 }, async t => {
    const root = path.resolve(__dirname, '..');
    const listener = net.createServer();
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    const chrome = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
        '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu',
        '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=' + port,
        '--user-data-dir=' + path.join(root, '.runtime', 'cart-interaction-chrome'), 'about:blank'
    ], { windowsHide: true, stdio: 'ignore' });
    let socket;
    t.after(() => { socket?.close(); chrome.kill(); });
    let target;
    for (let attempt = 0; attempt < 100; attempt++) {
        try {
            target = await (await fetch('http://127.0.0.1:' + port + '/json/new?about:blank', { method: 'PUT' })).json();
            break;
        } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(target, 'Chrome starts');
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(resolve => { socket.onopen = resolve; });
    let requestId = 0;
    const pending = new Map();
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
    };
    const call = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++requestId;
        pending.set(id, message => message.error ? reject(Error(JSON.stringify(message.error))) : resolve(message.result));
        socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (fn, ...args) => {
        const result = await call('Runtime.evaluate', { expression: '(' + fn + ')(...' + JSON.stringify(args) + ')', awaitPromise: true, returnByValue: true });
        if (result.exceptionDetails) { throw Error(JSON.stringify(result.exceptionDetails)); }
        return result.result?.value;
    };
    const styles = ['bootstrap.min.css', 'ui-tokens.css', 'ui-components.css', 'app.css'].map(file => fs.readFileSync(path.join(root, 'public/assets', file), 'utf8')).join('\n');
    const row = (id, price) => `<tr data-cart-item="${id}" data-unit-price="${price}"><td>Dish ${id}</td><td data-unit-price-label></td><td><form method="post" action="http://localhost/cart/${id}" class="quantity-stepper" data-quantity-form data-remove-confirm="Xóa món?"><input name="_token" type="hidden" value="test-token"><input name="_method" type="hidden" value="PATCH"><button type="button" data-quantity-step="-1">−</button><input type="number" name="quantity" class="quantity-value" value="1" min="0" max="99" required><button type="button" data-quantity-step="1">+</button></form></td><td data-line-total></td></tr>`;
    const html = `<html><head><meta charset="utf-8"><style>${styles} html{scroll-behavior:auto!important}</style></head><body class="ui-app"><a class="cart-nav-link"><span class="badge"></span></a><div data-cart-status class="cart-update-status"></div><div data-cart-empty hidden>Empty cart</div><div data-cart-content style="min-height:1600px"><div class="table-responsive" style="width:760px"><table class="table cart-table"><thead><tr><th>Dish</th><th>Price</th><th>Quantity</th><th>Total</th></tr></thead><tbody>${row(1, 100025)}${row(2, 50010)}</tbody></table></div><form data-checkout-form method="post"><strong data-cart-subtotal></strong><strong data-cart-discount></strong><strong data-cart-total></strong><select name="voucher_code" data-voucher-discounts='{"SMALL":50010,"LARGE":99999999}'><option value="">None</option><option value="SMALL">Small</option><option value="LARGE">Large</option></select><textarea name="note"></textarea><button>Checkout</button></form></div></body></html>`;
    await call('Page.enable');
    const frame = await call('Page.getFrameTree');
    await call('Page.setDocumentContent', { frameId: frame.frameTree.frame.id, html });
    await evaluate(() => {
        window.requests = [];
        window.confirmAccepted = true;
        window.confirm = () => window.confirmAccepted;
        window.fetch = (url, options) => new Promise((resolve, reject) => {
            window.requests.push({ url, quantity: options.body.get('quantity'), options, resolve, reject });
        });
        window.serverCart = { 1: { quantity: 1, unit_price_cents: 100025 }, 2: { quantity: 1, unit_price_cents: 50010 } };
        window.reply = () => {
            const request = window.requests.shift();
            const id = new URL(request.url).pathname.split('/').pop();
            if (Number(request.quantity) === 0) { delete window.serverCart[id]; }
            else { window.serverCart[id].quantity = Number(request.quantity); }
            const items = structuredClone(window.serverCart);
            request.resolve({ ok: true, redirected: false, json: async () => ({ items, subtotal_cents: Object.values(items).reduce((sum, item) => sum + item.quantity * item.unit_price_cents, 0) }) });
        };
    });
    await call('Runtime.evaluate', { expression: fs.readFileSync(path.join(root, 'public/assets/app.js'), 'utf8') });
    await evaluate(() => window.dispatchEvent(new Event('pageshow')));
    const click = selector => evaluate(selector => document.querySelector(selector).click(), selector);
    const quantity = (id, value) => evaluate((id, value) => {
        const input = document.querySelector('[data-cart-item="' + id + '"] input[name="quantity"]');
        input.value = String(value); input.dispatchEvent(new Event('change', { bubbles: true }));
    }, id, value);
    const reply = () => evaluate(async () => { window.reply(); await new Promise(resolve => setTimeout(resolve, 0)); });
    const drain = async () => { for (let i = 0; i < 20 && await evaluate(() => window.requests.length > 0); i++) { await reply(); } };
    const text = selector => evaluate(selector => document.querySelector(selector).textContent, selector);

    await t.test('rapid clicks update immediately, serialize writes, and preserve scroll and form fields', async () => {
        const initial = await evaluate(() => {
            document.querySelector('[name="note"]').value = 'Keep my note';
            window.documentMarker = 'same-document'; scrollTo(0, 120);
            return { y: scrollY, width: document.querySelector('table').getBoundingClientRect().width };
        });
        await evaluate(() => { for (let i = 0; i < 6; i++) { document.querySelector('[data-quantity-step="1"]').click(); } });
        assert.equal(await text('[data-cart-subtotal]'), '7.501,85đ');
        assert.equal(await evaluate(() => window.requests.length), 1);
        assert.equal(await evaluate(() => document.querySelector('[data-checkout-form] button').disabled), true);
        await click('[data-cart-item="2"] [data-quantity-step="1"]');
        await drain();
        assert.deepEqual(await evaluate(() => [window.serverCart[1].quantity, window.serverCart[2].quantity]), [7, 2]);
        assert.equal(await text('[data-cart-total]'), '8.001,95đ');
        assert.equal(await evaluate(() => document.querySelector('[name="note"]').value), 'Keep my note');
        assert.deepEqual(await evaluate(() => ({ y: scrollY, width: document.querySelector('table').getBoundingClientRect().width })), initial);
        assert.equal(await evaluate(() => window.documentMarker), 'same-document');
    });
    await t.test('voucher selection updates discount, caps it at subtotal, and tracks quantity changes', async () => {
        await evaluate(() => { const select = document.querySelector('[name="voucher_code"]'); select.value = 'SMALL'; select.dispatchEvent(new Event('change')); });
        assert.equal(await text('[data-cart-total]'), '7.501,85đ');
        await quantity(1, 49); await drain();
        assert.equal(await text('[data-cart-subtotal]'), '50.012,45đ');
        assert.equal(await text('[data-cart-total]'), '49.512,35đ');
        await evaluate(() => { const select = document.querySelector('[name="voucher_code"]'); select.value = 'LARGE'; select.dispatchEvent(new Event('change')); });
        assert.equal(await text('[data-cart-total]'), '0đ');
    });
    await t.test('latest quantity wins when changed back during a request', async () => {
        await quantity(1, 50); await quantity(1, 49); await drain();
        assert.equal(await evaluate(() => window.serverCart[1].quantity), 49);
        assert.equal(await evaluate(() => document.querySelector('[name="quantity"]').defaultValue), '49');
    });
    await t.test('quantity limit reenables plus after reducing from 99', async () => {
        await quantity(1, 99); await drain();
        assert.equal(await evaluate(() => document.querySelector('[data-quantity-step="1"]').disabled), true);
        await click('[data-quantity-step="-1"]'); await drain();
        assert.equal(await evaluate(() => document.querySelector('[data-quantity-step="1"]').disabled), false);
    });
    await t.test('failed request blocks checkout and retry saves the latest quantity', async () => {
        await click('[data-quantity-step="1"]');
        await evaluate(async () => { window.requests.shift().reject(Error('Offline')); await new Promise(resolve => setTimeout(resolve, 0)); });
        assert.equal(await evaluate(() => document.querySelector('[data-checkout-form] button').disabled), true);
        assert.match(await text('[data-cart-status]'), /Chưa lưu/);
        await click('[data-cart-status] button'); await drain();
        assert.equal(await evaluate(() => document.querySelector('[data-checkout-form] button').disabled), false);
        assert.equal(await evaluate(() => window.serverCart[1].quantity), 99);
    });
    await t.test('canceling deletion restores quantity without a request', async () => {
        await evaluate(() => { window.confirmAccepted = false; });
        await quantity(1, 0);
        assert.equal(await evaluate(() => document.querySelector('[name="quantity"]').value), '99');
        assert.equal(await evaluate(() => window.requests.length), 0);
    });
    await t.test('confirmed deletion removes rows and displays the empty state without navigation', async () => {
        await evaluate(() => { window.confirmAccepted = true; });
        await quantity(1, 0); await drain();
        assert.equal(await evaluate(() => document.querySelectorAll('[data-cart-item]').length), 1);
        await quantity(2, 0); await drain();
        assert.equal(await evaluate(() => document.querySelector('[data-cart-content]').hidden), true);
        assert.equal(await evaluate(() => document.querySelector('[data-cart-empty]').hidden), false);
        assert.equal(await text('.cart-nav-link .badge'), '0');
        assert.equal(await evaluate(() => window.documentMarker), 'same-document');
    });
});
