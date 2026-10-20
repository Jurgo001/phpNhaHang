<?php

namespace Tests\Feature;

use App\Models\Dish;
use App\Models\User;
use App\Models\VoucherRedemption;
use Illuminate\Support\Str;
use Tests\TestCase;

class CartInteractionTest extends TestCase
{
    public function test_async_quantity_update_returns_current_prices_and_precise_totals_without_redirect(): void
    {
        $user = User::factory()->create();
        $dish = Dish::factory()->create(['price' => '1000.25']);
        $other = Dish::factory()->create(['price' => '500.10']);
        $this->actingAs($user)->withSession(['cart' => [$dish->id => 1, $other->id => 2]])
            ->patchJson(route('cart.update', $dish), ['quantity' => 49, 'price' => 1, 'total' => 1])
            ->assertOk()->assertJsonPath('subtotal_cents', 5001245)->assertJsonPath('count', 51)
            ->assertJsonPath('items.'.$dish->id.'.quantity', 49)
            ->assertJsonPath('items.'.$dish->id.'.unit_price_cents', 100025)
            ->assertSessionHas('cart', [$dish->id => 49, $other->id => 2])->assertSessionMissing('success');
        $dish->update(['price' => '2000.50']);
        $this->patchJson(route('cart.update', $dish), ['quantity' => 2])
            ->assertOk()->assertJsonPath('subtotal_cents', 500120);
        $this->get(route('cart.index'))->assertOk()->assertViewHas('subtotal', '5001.20');
    }

    public function test_async_removal_handles_deleted_dishes_and_the_last_item(): void
    {
        $dish = Dish::factory()->create();
        $this->actingAs(User::factory()->create())->withSession(['cart' => [$dish->id => 1]]);
        $dish->delete();
        $this->patchJson(route('cart.update', $dish->id), ['quantity' => 0])
            ->assertOk()->assertJsonPath('subtotal_cents', 0)->assertJsonPath('count', 0)
            ->assertSessionHas('cart', []);
        $this->patchJson(route('cart.update', $dish->id), ['quantity' => 0])->assertOk()->assertJsonPath('count', 0);
    }

    public function test_async_update_rejects_invalid_quantities_and_items_outside_the_cart(): void
    {
        $dish = Dish::factory()->create();
        $other = Dish::factory()->create();
        $this->actingAs(User::factory()->create())->withSession(['cart' => [$dish->id => 3]]);
        foreach ([-1, 100, '1.5', 'abc'] as $quantity) {
            $this->patchJson(route('cart.update', $dish), ['quantity' => $quantity])
                ->assertUnprocessable()->assertJsonValidationErrors('quantity')->assertSessionHas('cart', [$dish->id => 3]);
        }
        $this->patchJson(route('cart.update', $other), ['quantity' => 1])->assertNotFound();
    }

    public function test_cart_dropdown_only_lists_own_unused_unexpired_vouchers(): void
    {
        $user = User::factory()->create();
        $available = VoucherRedemption::factory()->for($user)->create();
        $used = VoucherRedemption::factory()->for($user)->create(['used_at' => now()]);
        $expired = VoucherRedemption::factory()->for($user)->create(['expires_at' => now()]);
        $foreign = VoucherRedemption::factory()->create();
        $dish = Dish::factory()->create();
        $this->actingAs($user)->withSession(['cart' => [$dish->id => 1]])->get(route('cart.index'))
            ->assertOk()->assertViewHas('redemptions', fn ($records): bool => $records->modelKeys() === [$available->id])
            ->assertSee('id="voucher_code" name="voucher_code"', false)->assertSee($available->code)
            ->assertDontSee($used->code)->assertDontSee($expired->code)->assertDontSee($foreign->code)
            ->assertSee('data-cart-total', false);
    }

    public function test_cart_without_vouchers_shows_exchange_link_and_keeps_checkout_optional(): void
    {
        $dish = Dish::factory()->create();
        $this->actingAs(User::factory()->create())->withSession(['cart' => [$dish->id => 1]])->get(route('cart.index'))
            ->assertOk()->assertSee('Không dùng voucher')->assertSee('Đổi điểm lấy voucher');
    }

    public function test_checkout_after_async_update_applies_the_selected_voucher_to_updated_quantity(): void
    {
        $user = User::factory()->create();
        $dish = Dish::factory()->create(['price' => '1000.25']);
        $voucher = VoucherRedemption::factory()->for($user)->create(['discount_amount' => '500.10']);
        $token = (string) Str::uuid();
        $this->actingAs($user)->withSession(['cart' => [$dish->id => 1], 'checkout_token' => $token])
            ->patchJson(route('cart.update', $dish), ['quantity' => 3])->assertOk();
        $this->post(route('checkout'), ['checkout_token' => $token, 'payment_method' => 'cash', 'voucher_code' => $voucher->code])
            ->assertSessionHasNoErrors();
        $this->assertDatabaseHas('orders', ['user_id' => $user->id, 'subtotal' => '3000.75', 'discount' => '500.10', 'total' => '2500.65']);
    }
}
