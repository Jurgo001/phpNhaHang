@extends('layouts.app')
@section('title','Giỏ hàng')
@section('content')
<h1 class="h2 mb-4">Giỏ hàng của bạn</h1>
<div class="cart-update-status small" role="status" aria-live="polite" data-cart-status></div>
<div class="card empty" data-cart-empty @if(count($cart)!==0) hidden @endif><p>Giỏ hàng đang trống.</p><a href="{{ route('menu') }}" class="btn btn-primary align-self-center">Chọn món ngay</a></div>
@if(count($cart)!==0)
<div class="row g-4" data-cart-content><div class="col-lg-8"><div class="card table-responsive"><table class="table mb-0 cart-table"><thead><tr><th scope="col">Món ăn</th><th scope="col" class="ui-numeric">Đơn giá</th><th scope="col" class="ui-numeric">Số lượng</th><th scope="col" class="ui-numeric">Thành tiền</th></tr></thead><tbody class="ui-table-body">
@foreach($cart as $id=>$quantity)<tr data-cart-item="{{ $id }}" data-unit-price="{{ isset($dishes[$id]) ? \App\Support\Money::cents($dishes[$id]->price) : 0 }}">
<td>
    <!-- BỔ SUNG KHỐI HIỂN THỊ HÌNH ẢNH MÓN ĂN -->
    <div class="d-flex align-items-center gap-3">
        @if(isset($dishes[$id]))
            <img src="{{ $dishes[$id]->imageUrl() }}" alt="{{ $dishes[$id]->name }}" style="width: 50px; height: 50px; object-fit: cover; border-radius: 6px;">
        @endif
        <div>
            {{ $dishes[$id]->name ?? 'Món đã bị xóa' }}
            @if(!isset($dishes[$id]) || !$dishes[$id]->is_available)
                <small class="d-block text-danger">Không còn phục vụ. Vui lòng giảm về 0 để bỏ món.</small>
            @endif
        </div>
    </div>
</td>
<td class="ui-numeric" data-unit-price-label>{{ isset($dishes[$id]) ? \App\Support\Money::format($dishes[$id]->price) : '—' }}đ</td>
<td><form method="post" action="{{ route('cart.update',$id) }}" class="quantity-stepper" data-quantity-form data-remove-confirm="Bạn có đồng ý xóa món này khỏi giỏ hàng không?">@csrf @method('PATCH')<button type="button" data-quantity-step="-1" class="btn btn-sm btn-outline-secondary" aria-label="Giảm {{ $dishes[$id]->name??'món' }}">−</button><input class="form-control quantity-value" type="number" name="quantity" value="{{ $quantity }}" min="0" max="99" step="1" inputmode="numeric" required aria-label="Số lượng {{ $dishes[$id]->name??'món' }}"><button type="button" data-quantity-step="1" class="btn btn-sm btn-outline-primary" aria-label="Tăng {{ $dishes[$id]->name??'món' }}" @disabled($quantity>=99)>+</button></form></td>
<td class="ui-numeric price" data-line-total>{{ isset($dishes[$id]) ? \App\Support\Money::format(\App\Support\Money::decimal(\App\Support\Money::cents($dishes[$id]->price)*$quantity)) : '—' }}đ</td></tr>@endforeach
</tbody></table></div><p class="text-muted small mt-3">Bấm −/+ hoặc nhập trực tiếp số lượng (1–99), tổng tiền tự cập nhật khi thay đổi. Nhập 0 cần xác nhận xóa.</p><a href="{{ route('menu') }}">← Tiếp tục chọn món</a></div>
<div class="col-lg-4"><form class="card card-body p-4" data-checkout-form method="post" action="{{ route('checkout') }}">@csrf<input type="hidden" name="checkout_token" value="{{ $token }}"><h2 class="h4 mb-3">Thông tin đặt món</h2><p class="d-flex justify-content-between">Tạm tính <strong class="price" data-cart-subtotal>{{ \App\Support\Money::format($subtotal) }}đ</strong></p>
<x-field name="payment_method" label="Hình thức thanh toán" type="select" :options="['cash'=>'Thanh toán trực tiếp (COD)','transfer'=>'Thanh toán online · QR MB Bank']" required />
<x-field name="address_id" label="Địa chỉ giao hàng" type="select" :options="[''=>'Dùng tại nhà hàng / mang về']+$addresses->mapWithKeys(fn($item)=>[$item->id=>$item->recipient_name.' · '.$item->address])->all()" />
<a class="small mb-3" href="{{ route('addresses.create') }}">+ Thêm địa chỉ giao hàng</a><x-field name="table_number" label="Số bàn đã đặt (nếu dùng tại nhà hàng)" type="number" min="1" max="200" /><small class="text-muted mb-3">Email đặt bàn phải khớp tài khoản đang đăng nhập: {{ auth()->user()->email }}.</small>
<x-field name="voucher_code" label="Voucher đã đổi" type="select" :options="[''=>'Không dùng voucher']+$redemptions->mapWithKeys(fn($item)=>[$item->code=>$item->voucher->name.' · '.$item->code.' · Giảm '.\App\Support\Money::format($item->discount_amount).'đ · Hạn '.$item->expires_at->format('d/m/Y H:i')])->all()" :data-voucher-discounts="$redemptions->mapWithKeys(fn($item)=>[$item->code=>\App\Support\Money::cents($item->discount_amount)])->toJson()" />
@if($redemptions->isEmpty())<p class="small text-muted">Bạn chưa có voucher còn hạn và chưa dùng. <a href="{{ route('vouchers.index') }}">Đổi điểm lấy voucher</a>.</p>@endif
@php($discount=min(\App\Support\Money::cents($subtotal), \App\Support\Money::cents($redemptions->firstWhere('code',old('voucher_code'))?->discount_amount ?? '0')))
<div aria-live="polite" aria-atomic="true"><p class="d-flex justify-content-between">Giảm voucher <strong data-cart-discount>{{ \App\Support\Money::format(\App\Support\Money::decimal($discount)) }}đ</strong></p><p class="d-flex justify-content-between">Tổng tiền <strong class="price" data-cart-total>{{ \App\Support\Money::format(\App\Support\Money::decimal(\App\Support\Money::cents($subtotal)-$discount)) }}đ</strong></p></div><x-field name="note" label="Ghi chú" type="textarea" maxlength="255" />
<p class="small text-muted">Online: sau khi đặt món, quét QR và báo đã chuyển khoản. Nhân viên kiểm tra tiền; đơn vẫn chờ gọi xác nhận.</p><button class="btn btn-primary btn-lg">Xác nhận đặt món</button></form></div></div>
@endif
@endsection