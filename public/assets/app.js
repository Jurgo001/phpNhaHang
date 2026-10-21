let cartQuantityUpdating = false;
const pendingCartUpdates = new Map();
const cartMoney = cents => {
    const whole = Math.floor(cents / 100).toLocaleString('vi-VN');
    const fraction = String(cents % 100).padStart(2, '0').replace(/0+$/, '');
    return whole + (fraction ? ',' + fraction : '') + 'đ';
};
const cartRows = () => [...document.querySelectorAll('[data-cart-item]')];
const renderCartTotals = () => {
    if (!document.querySelector('[data-cart-status]')) { return; }
    let subtotal = 0;
    let count = 0;
    cartRows().forEach(row => {
        const form = row.querySelector('[data-quantity-form]');
        const input = form.elements.quantity;
        const quantity = input.checkValidity() ? Number(input.value) : Number(input.defaultValue);
        const amount = Number(row.dataset.unitPrice) * quantity;
        subtotal += amount;
        count += quantity;
        row.querySelector('[data-line-total]').textContent = cartMoney(amount);
        form.querySelector('[data-quantity-step="1"]').disabled = quantity >= 99 || form.dataset.removing === 'true';
    });
    const voucher = document.querySelector('[name="voucher_code"]');
    const discounts = JSON.parse(voucher?.dataset.voucherDiscounts || '{}');
    const discount = Math.min(subtotal, discounts[voucher?.value] || 0);
    for (const [selector, amount] of [['[data-cart-subtotal]', subtotal], ['[data-cart-discount]', discount], ['[data-cart-total]', subtotal - discount]]) {
        const element = document.querySelector(selector);
        if (element) { element.textContent = cartMoney(amount); }
    }
    document.querySelectorAll('.cart-nav-link').forEach(link => {
        link.querySelector('.badge').textContent = count;
        link.setAttribute('aria-label', 'Giỏ hàng, ' + count + ' phần');
    });
};
const syncCartCheckout = () => {
    const busy = cartQuantityUpdating || pendingCartUpdates.size > 0;
    document.querySelectorAll('[data-checkout-form] button').forEach(button => { button.disabled = busy; });
};
const flushCartUpdates = async () => {
    if (cartQuantityUpdating || !pendingCartUpdates.size) { return; }
    cartQuantityUpdating = true;
    syncCartCheckout();
    const status = document.querySelector('[data-cart-status]');
    status.classList.remove('text-danger');
    status.textContent = 'Đang cập nhật giỏ hàng…';
    try {
        while (pendingCartUpdates.size) {
            const [form, quantity] = pendingCartUpdates.entries().next().value;
            pendingCartUpdates.delete(form);
            const body = new FormData(form);
            body.set('quantity', quantity);
            form.setAttribute('aria-busy', 'true');
            try {
                const response = await fetch(form.action, { method: 'POST', body, credentials: 'same-origin', headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } });
                if (!response.ok || response.redirected) { throw new Error('Cart update failed'); }
                const data = await response.json();
                if (!data.items || !Number.isInteger(data.subtotal_cents)) { throw new Error('Invalid cart response'); }
                cartRows().forEach(row => {
                    const item = data.items[row.dataset.cartItem];
                    if (item) {
                        row.dataset.unitPrice = item.unit_price_cents;
                        row.querySelector('[data-unit-price-label]').textContent = cartMoney(item.unit_price_cents);
                    }
                });
                form.elements.quantity.defaultValue = quantity;
                if (Number(quantity) === 0) {
                    form.closest('[data-cart-item]').remove();
                    pendingCartUpdates.delete(form);
                    if (!cartRows().length) {
                        document.querySelector('[data-cart-content]').hidden = true;
                        document.querySelector('[data-cart-empty]').hidden = false;
                    }
                }
                renderCartTotals();
            } catch (error) {
                if (!pendingCartUpdates.has(form)) { pendingCartUpdates.set(form, quantity); }
                throw error;
            } finally {
                form.removeAttribute('aria-busy');
            }
        }
        status.textContent = 'Đã cập nhật giỏ hàng.';
    } catch (error) {
        status.classList.add('text-danger');
        status.textContent = 'Chưa lưu được số lượng. Vui lòng thử lại trước khi đặt món. ';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn btn-sm btn-outline-danger';
        retry.textContent = 'Thử lại';
        retry.addEventListener('click', flushCartUpdates);
        status.append(retry);
    } finally {
        cartQuantityUpdating = false;
        syncCartCheckout();
    }
};
const queueCartUpdate = form => {
    pendingCartUpdates.set(form, form.elements.quantity.value);
    if (Number(form.elements.quantity.value) === 0) {
        form.dataset.removing = 'true';
        form.querySelectorAll('button, input[name="quantity"]').forEach(control => { control.disabled = true; });
    }
    renderCartTotals();
    flushCartUpdates();
};
window.addEventListener('pageshow', () => { renderCartTotals(); syncCartCheckout(); });
document.querySelector('[name="voucher_code"]')?.addEventListener('change', renderCartTotals);

const pendingConfirmations = new WeakSet();
const approvedConfirmations = new WeakSet();


document.addEventListener('submit', async function (event) {
    if (event.defaultPrevented) { return; }
    const form = event.target;
    if (pendingConfirmations.has(form) || form.dataset.uiSubmitting === 'true') { event.preventDefault(); return; }
    if (form.matches('[data-checkout-form]')) {
        const changed = [...document.querySelectorAll('[data-quantity-form]')].filter(item => item.elements.quantity.value !== item.elements.quantity.defaultValue);
        if (changed.length || cartQuantityUpdating || pendingCartUpdates.size) {
            event.preventDefault();
            changed.forEach(item => item.requestSubmit());
            return;
        }
    }
    const quantityForm = form.matches('[data-quantity-form]');
    const input = quantityForm ? form.elements.quantity : null;
    if (quantityForm && (!input.reportValidity() || (input.value === input.defaultValue && !cartQuantityUpdating && !pendingCartUpdates.has(form)))) { event.preventDefault(); return; }
    const removing = quantityForm && Number(input.value) === 0;
    const message = removing ? form.dataset.removeConfirm : event.submitter?.dataset.confirm || form.dataset.confirm;
    const approved = approvedConfirmations.delete(form);
    if (message && !approved) {
        event.preventDefault();pendingConfirmations.add(form);
        const submitter = event.submitter;
        const options = { danger: /xóa|hủy/i.test(message), trigger: submitter || document.activeElement, name: window.RestaurantUI?.confirmationName(form) || '' };
        let accepted = false;
        try { accepted = await (window.RestaurantUI ? RestaurantUI.confirm(message, options) : window.confirm(message)); }
        finally { pendingConfirmations.delete(form); }
        if (!accepted) { if (removing) { input.value = input.defaultValue; renderCartTotals(); } return; }
        approvedConfirmations.add(form);
        if (submitter?.isConnected) { form.requestSubmit(submitter); } else { form.requestSubmit(); }
        return;
    }
    if (quantityForm) {
        event.preventDefault();
        queueCartUpdate(form);
        return;
    }
    window.RestaurantUI?.markSubmitting(form, event.submitter);
});

document.addEventListener('click', function (event) {
    const button = event.target.closest('[data-quantity-step]');
    if (!button || button.disabled) { return; }
    const form = button.closest('[data-quantity-form]');
    const input = form.elements.quantity;
    if (!input.checkValidity()) { input.reportValidity(); return; }
    input.value = String(Math.max(0, Math.min(99, Number(input.value) + Number(button.dataset.quantityStep))));
    form.requestSubmit();
});

document.addEventListener('change', function (event) {
    if (event.target.matches('[data-quantity-form] input[name="quantity"]')) {
        if (event.target.checkValidity()) { event.target.form.requestSubmit(); }
        else { event.target.reportValidity(); }
    }
    if (event.target.matches('[data-check-all]')) {
        document.querySelectorAll('input[form="' + event.target.dataset.checkAll + '"][name="ids[]"]').forEach(function (box) { box.checked = event.target.checked; });
    }
    if (event.target.matches('[data-search-filter]')) {
        const form = event.target.closest('form');
        if (form.hasAttribute('data-live-search')) { return; }
        const query = form.elements.q;
        if (query && !query.value.trim()) { query.disabled = true; }
        form.submit();
    }
});

document.querySelectorAll('form[data-live-search]').forEach(function (form) {
    const results = document.getElementById(form.dataset.liveSearch);
    const status = document.querySelector('[data-search-status="' + form.dataset.liveSearch + '"]');
    if (!results) { return; }
    let timer;
    let controller;
    let version = 0;
    const currentUrl = function () {
        const url = new URL(form.action);
        for (const [key, value] of new FormData(form)) {
            if (typeof value === 'string' && value.trim()) { url.searchParams.set(key, value.trim()); }
        }
        return url;
    };
    const load = async function (url, requestVersion) {
        controller = new AbortController();
        if(window.RestaurantUI) { RestaurantUI.setLoading(results,true); } else { results.setAttribute('aria-busy','true'); }
        if (status) { status.classList.remove('visually-hidden','app-search-error'); status.setAttribute('role','status'); status.textContent = 'Đang tìm món…'; }
        try {
            const response = await fetch(url, { signal: controller.signal, credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'text/html' } });
            if (!response.ok || response.redirected) { throw new Error('Cannot load dishes'); }
            const html = new DOMParser().parseFromString(await response.text(), 'text/html');
            if (requestVersion !== version) { return; }
            const replacement = html.getElementById(results.id);
            if (!replacement) { throw new Error('Missing result list'); }
            window.RestaurantUI?.dispose(results);
            results.innerHTML = replacement.innerHTML;
            window.RestaurantUI?.enhance(results);
            history.replaceState(null, '', url);
            if (status) { status.classList.add('visually-hidden'); status.textContent = results.querySelector('[data-result-count]')?.textContent || 'Đã cập nhật danh sách món.'; }
        } catch (error) {
            if (error.name !== 'AbortError' && requestVersion === version && status) {
                const message='Chưa tải được món ăn. Vui lòng thử tìm kiếm lại.';
                if(window.RestaurantUI) { RestaurantUI.showRetry(status,message,()=>search(0,url)); } else { status.textContent=message; }
            }
        } finally {
            if (requestVersion === version) { if(window.RestaurantUI) { RestaurantUI.setLoading(results,false); } else { results.setAttribute('aria-busy','false'); } }
        }
    };
    const search = function (delay = 0, url = currentUrl()) {
        clearTimeout(timer);
        controller?.abort();
        const requestVersion = ++version;
        timer = setTimeout(() => load(url, requestVersion), delay);
    };
    form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (!form.elements.q.value.trim()) { form.querySelectorAll('select').forEach(select => { select.value = ''; }); }
        search();
    });
    form.elements.q.addEventListener('input', function (event) {
        if (event.isComposing) { return; }
        if (!event.target.value.trim()) { form.querySelectorAll('select').forEach(select => { select.value = ''; }); }
        search(180);
    });
    form.elements.q.addEventListener('compositionend', () => search(180));
    form.querySelectorAll('[data-search-filter]').forEach(select => select.addEventListener('change', () => search()));
    results.addEventListener('click', function (event) {
        const link = event.target.closest('.pagination a');
        if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) { return; }
        event.preventDefault();
        search(0, new URL(link.href));
    });
});

document.querySelectorAll('[data-payment-qr]').forEach(function (element) {
    if (typeof QRCode !== 'undefined') {
        new QRCode(element, { text: element.dataset.paymentQr, width: 256, height: 256, correctLevel: QRCode.CorrectLevel.M });
        element.querySelectorAll('img').forEach(function (img) { img.alt = 'QR chuyển khoản MB Bank theo số tiền và mã đơn'; });
    }
}
);
// Gắn sự kiện lắng nghe toàn bộ trang web (hoạt động kể cả khi phân trang hay tìm kiếm Ajax)
document.addEventListener('submit', function(e) {
    const form = e.target;
    
    // Nếu form được bấm là form "Thêm món" (có chữ /gio-hang/ và không phải nút xóa/cập nhật)
    if (form.tagName === 'FORM' && form.action.includes('/gio-hang/') && !form.querySelector('input[name="_method"]')) {
        e.preventDefault(); // Chặn việc tải lại trang
        
        const btn = form.querySelector('button');
        const originalText = btn.innerText;
        btn.innerText = 'Đang thêm...';
        btn.disabled = true;

        fetch(form.action, {
            method: 'POST',
            body: new FormData(form),
            headers: {
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            }
        })
        .then(response => response.json())
        .then(data => {
            // Đổi chữ nút thành "Đã thêm" trong 1.5 giây
            btn.innerText = 'Đã thêm!';
            setTimeout(() => {
                btn.innerText = originalText;
                btn.disabled = false;
            }, 1500);

            // CẬP NHẬT SỐ GIỎ HÀNG (SỬA LỖI TẠI ĐÂY)
            if (data.success && data.count !== undefined) {
                // Dùng querySelectorAll để tìm TẤT CẢ icon giỏ hàng (cả trên Mobile và PC)
                const badges = document.querySelectorAll('.cart-nav-link .badge');
                
                // Vòng lặp cập nhật số lượng mới cho tất cả các icon tìm được
                badges.forEach(badge => {
                    badge.innerText = data.count;
                });
            }
        })
        .catch(error => {
            console.error('Lỗi khi thêm món:', error);
            btn.innerText = originalText;
            btn.disabled = false;
        });
    }
});