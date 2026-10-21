<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Mail\Transport\ArrayTransport;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Password;
use Mockery;
use PHPUnit\Framework\Attributes\DataProvider;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\Transport\TransportInterface;
use Tests\TestCase;

class AuthenticationTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        config([
            'mail.default' => 'smtp',
            'mail.mailers.smtp.host' => 'smtp.gmail.com',
            'mail.mailers.smtp.username' => 'sender@gmail.com',
            'mail.mailers.smtp.password' => 'test-app-password',
            'mail.from.address' => 'sender@gmail.com',
        ]);
        Mail::mailer()->setSymfonyTransport(new ArrayTransport);
    }

    public function test_customer_logs_in_with_hashed_password(): void
    {
        $user = User::factory()->create();
        $this->post(route('login.store'), ['email' => $user->email, 'password' => 'Demo@12345'])->assertRedirect(route('menu'));
        $this->assertAuthenticatedAs($user);
        $this->assertTrue(Hash::check('Demo@12345', $user->password));
    }

    public function test_admin_is_redirected_to_dashboard(): void
    {
        $user = User::factory()->admin()->create();
        $this->post(route('login.store'), ['email' => $user->email, 'password' => 'Demo@12345'])->assertRedirect(route('admin.orders.index'));
        $this->assertAuthenticatedAs($user);
    }

    public function test_wrong_password_is_rejected_in_vietnamese(): void
    {
        $user = User::factory()->create();
        $this->post(route('login.store'), ['email' => $user->email, 'password' => 'wrong-password'])->assertSessionHasErrors(['email' => 'Email hoặc mật khẩu không đúng.']);
        $this->assertGuest();
    }

    public function test_registration_cannot_select_admin_role(): void
    {
        $this->post(route('register.store'), ['name' => 'Khách mới', 'email' => 'new@gmail.com', 'phone' => '0901234567', 'password' => 'New@12345', 'password_confirmation' => 'New@12345', 'role_id' => 3, 'role' => 'owner', 'user_id' => 999])->assertRedirect(route('login'));
        $user = User::query()->where('email', 'new@gmail.com')->sole();
        $this->assertSame('user', $user->role->code);
        $this->assertTrue(Hash::check('New@12345', $user->password));
    }

    public function test_duplicate_registration_email_does_not_create_account(): void
    {
        $user = User::factory()->create(['email' => 'taken@gmail.com']);
        $this->post(route('register.store'), ['name' => 'Khách mới', 'email' => $user->email, 'phone' => '0901234567', 'password' => 'New@12345', 'password_confirmation' => 'New@12345'])->assertSessionHasErrors(['email' => 'Email đã tồn tại.']);
        $this->assertDatabaseCount('users', 1);
    }

    public function test_logout_clears_cart_and_authentication(): void
    {
        $user = User::factory()->create();
        $this->actingAs($user)->withSession(['cart' => [1 => 2], 'checkout_token' => 'old'])->post(route('logout'))->assertRedirect(route('login'))->assertSessionMissing('cart')->assertSessionMissing('checkout_token');
        $this->assertGuest();
    }

    public function test_valid_reset_token_changes_hashed_password(): void
    {
        $user = User::factory()->create();
        $token = Password::createToken($user);
        $this->post(route('password.update'), ['token' => $token, 'email' => $user->email, 'password' => 'Changed@123', 'password_confirmation' => 'Changed@123'])->assertRedirect(route('login'));
        $this->assertTrue(Hash::check('Changed@123', $user->fresh()->password));
    }

    #[DataProvider('nonDeliveringMailers')]
    public function test_password_reset_does_not_claim_email_was_sent_with_a_non_delivering_mailer(string $mailer): void
    {
        Mail::fake();
        config(['mail.default' => $mailer]);
        $user = User::factory()->create();

        $this->from(route('password.request'))
            ->post(route('password.email'), ['email' => $user->email])
            ->assertRedirect(route('password.request'))
            ->assertSessionHasErrors(['email' => __('passwords.unavailable')])
            ->assertSessionMissing('success');

        Mail::assertNothingSent();
        $this->assertDatabaseCount('password_reset_tokens', 0);
    }

    /**
     * @return array<string, array{string}>
     */
    public static function nonDeliveringMailers(): array
    {
        return ['log' => ['log'], 'array' => ['array']];
    }

    public function test_password_reset_rejects_missing_gmail_credentials(): void
    {
        Mail::fake();
        config(['mail.mailers.smtp.password' => '']);
        $user = User::factory()->create();

        $this->post(route('password.email'), ['email' => $user->email])
            ->assertSessionHasErrors(['email' => __('passwords.unavailable')])
            ->assertSessionMissing('success');

        Mail::assertNothingSent();
        $this->assertDatabaseCount('password_reset_tokens', 0);
    }

    public function test_repeated_password_reset_requests_show_the_throttle_error(): void
    {
        $user = User::factory()->create();

        $this->post(route('password.email'), ['email' => $user->email])->assertSessionHas('success');
        $this->post(route('password.email'), ['email' => $user->email])
            ->assertSessionHasErrors(['email' => __('passwords.throttled')])
            ->assertSessionMissing('success');

        $this->assertCount(1, Mail::mailer()->getSymfonyTransport()->messages());
    }

    public function test_unknown_password_reset_email_has_the_same_public_response(): void
    {
        Mail::fake();

        $this->post(route('password.email'), ['email' => 'missing@gmail.com'])
            ->assertSessionHas('success', 'Nếu email đã đăng ký, bạn sẽ nhận được mật khẩu mới qua email. Vui lòng kiểm tra cả thư rác.')
            ->assertSessionHasNoErrors();

        Mail::assertNothingSent();
        $this->assertDatabaseCount('password_reset_tokens', 0);
    }

    public function test_smtp_failure_shows_an_error_and_allows_an_immediate_retry(): void
    {
        $user = User::factory()->create();
        $transport = Mockery::mock(TransportInterface::class);
        $transport->shouldReceive('send')->once()->andThrow(new TransportException('SMTP unavailable'));
        Mail::mailer()->setSymfonyTransport($transport);

        $this->post(route('password.email'), ['email' => $user->email])
            ->assertSessionHasErrors(['email' => __('passwords.failed')])
            ->assertSessionMissing('success');

        $this->assertDatabaseCount('password_reset_tokens', 0);
        $this->assertTrue(Hash::check('Demo@12345', $user->fresh()->password));

        $retryTransport = new ArrayTransport;
        Mail::mailer()->setSymfonyTransport($retryTransport);
        $this->post(route('password.email'), ['email' => $user->email])
            ->assertSessionHas('success')
            ->assertSessionHasNoErrors();
        $this->assertCount(1, $retryTransport->messages());
    }

    public function test_emailed_password_logs_in_and_can_be_changed_in_profile(): void
    {
        $user = User::factory()->create(['email' => 'customer@gmail.com', 'remember_token' => 'old-token']);
        $oldResetToken = Password::createToken($user);
        $this->travel(61)->seconds();
        $transport = new ArrayTransport;
        Mail::mailer()->setSymfonyTransport($transport);

        $this->post(route('password.email'), ['email' => $user->email])->assertSessionHas('success');
        $this->assertCount(1, $transport->messages());
        $message = $transport->messages()->first()->getOriginalMessage();
        $this->assertSame($user->email, $message->getTo()[0]->getAddress());
        $this->assertSame(1, preg_match('/Mật khẩu mới của bạn: (\S+)/u', $message->getTextBody(), $matches));
        $password = $matches[1];
        $this->assertSame(16, strlen($password));
        $this->assertStringNotContainsString('/dat-lai-mat-khau/', $message->getTextBody());
        $this->assertTrue(Hash::check($password, $user->fresh()->password));
        $this->assertFalse(Hash::check('Demo@12345', $user->fresh()->password));
        $this->assertNotSame('old-token', $user->fresh()->remember_token);
        $this->assertFalse(Password::tokenExists($user, $oldResetToken));
        $this->post(route('login.store'), ['email' => $user->email, 'password' => 'Demo@12345'])->assertSessionHasErrors('email');
        $this->post(route('login.store'), ['email' => $user->email, 'password' => $password])->assertRedirect(route('menu'));
        $this->assertAuthenticatedAs($user);
        $this->put(route('profile.update'), [
            'name' => $user->name,
            'email' => $user->email,
            'current_password' => $password,
            'password' => 'Personal@123',
            'password_confirmation' => 'Personal@123',
        ])->assertSessionHasNoErrors();
        $this->assertTrue(Hash::check('Personal@123', $user->fresh()->password));
        $this->assertFalse(Hash::check($password, $user->fresh()->password));
    }

    public function test_login_is_rate_limited(): void
    {
        for ($i = 0; $i < 5; $i++) {
            $this->post(route('login.store'), ['email' => 'missing@example.test', 'password' => 'wrong'])->assertSessionHasErrors('email');
        }
        $this->post(route('login.store'), ['email' => 'missing@example.test', 'password' => 'wrong'])->assertTooManyRequests();
    }
}
