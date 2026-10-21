@extends('layouts.app')
@section('title','Quên mật khẩu')
@section('content')
<form method="post" action="{{ route('password.email') }}" class="card card-body p-4 mx-auto app-auth-panel">@csrf<h1 class="h3">Quên mật khẩu</h1><p class="text-muted">Nhập email đã đăng ký để nhận mật khẩu ngẫu nhiên mới. Mật khẩu cũ sẽ được thay thế. Sau khi đăng nhập, bạn có thể đổi mật khẩu trong Hồ sơ cá nhân.</p><x-field name="email" label="Email" type="email" required /><button class="btn btn-primary">Gửi mật khẩu mới</button></form>
@endsection
