<?php

declare(strict_types=1);

namespace MirrorOrg\HookShield\Tests;

use MirrorOrg\HookShield\Secret;
use MirrorOrg\HookShield\Store\InMemoryNonceStore;
use MirrorOrg\HookShield\Webhook;
use MirrorOrg\HookShield\WebhookVerificationException as Failure;
use PHPUnit\Framework\TestCase;

final class WebhookTest extends TestCase
{
    private const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
    private const NOW = 1_767_225_600;
    private const BODY = '{"event":"order.paid","amount":1250}';

    private function webhook(array|string $secrets = self::SECRET, ?InMemoryNonceStore $nonces = null, int $now = self::NOW): Webhook
    {
        return new Webhook($secrets, 300, $nonces, static fn (): int => $now);
    }

    private function assertFailure(string $reason, callable $fn): void
    {
        try {
            $fn();
            self::fail("Expected verification to fail with {$reason}");
        } catch (Failure $e) {
            self::assertSame($reason, $e->reason);
        }
    }

    public function testMatchesStandardWebhooksReferenceSignature(): void
    {
        // Test vector from the Standard Webhooks specification.
        $wh = new Webhook('whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw');
        $sig = $wh->sign('msg_p5jXN8AQM9LWM0D4loKWxJek', 1614265330, '{"test": 2432232314}');
        self::assertSame('v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=', $sig);
    }

    public function testRoundTripReturnsDecodedPayload(): void
    {
        $wh = $this->webhook();
        $headers = $wh->headers(self::BODY);
        self::assertStringStartsWith('msg_', $headers['webhook-id']);
        self::assertSame((string) self::NOW, $headers['webhook-timestamp']);
        self::assertSame(['event' => 'order.paid', 'amount' => 1250], $wh->verify(self::BODY, $headers));
    }

    public function testHeadersAreCaseInsensitiveAndMayBeArrays(): void
    {
        $wh = $this->webhook();
        $h = $wh->headers(self::BODY, 'msg_1');
        $psr7Style = [
            'Webhook-Id' => [$h['webhook-id']],
            'WEBHOOK-TIMESTAMP' => [$h['webhook-timestamp']],
            'Webhook-Signature' => [$h['webhook-signature']],
        ];
        self::assertIsArray($wh->verify(self::BODY, $psr7Style));
    }

    public function testRejectsTamperedPayload(): void
    {
        $wh = $this->webhook();
        $h = $wh->headers(self::BODY);
        $this->assertFailure(Failure::NO_MATCHING_SIGNATURE, fn () => $wh->verify(str_replace('1250', '9999', self::BODY), $h));
    }

    public function testRejectsWrongSecret(): void
    {
        $h = $this->webhook()->headers(self::BODY);
        $other = $this->webhook(Secret::generate());
        $this->assertFailure(Failure::NO_MATCHING_SIGNATURE, fn () => $other->verify(self::BODY, $h));
    }

    public function testRejectsMissingHeadersAndBadTimestamps(): void
    {
        $wh = $this->webhook();
        $h = $wh->headers(self::BODY);
        $this->assertFailure(Failure::MISSING_HEADERS, fn () => $wh->verify(self::BODY, []));
        $this->assertFailure(Failure::INVALID_TIMESTAMP, fn () => $wh->verify(self::BODY, ['webhook-timestamp' => 'soon'] + $h));

        $old = $wh->headers(self::BODY, null, self::NOW - 301);
        $this->assertFailure(Failure::TIMESTAMP_TOO_OLD, fn () => $wh->verify(self::BODY, $old));

        $future = $wh->headers(self::BODY, null, self::NOW + 301);
        $this->assertFailure(Failure::TIMESTAMP_IN_FUTURE, fn () => $wh->verify(self::BODY, $future));
    }

    public function testAcceptsAnyOfMultipleSignatures(): void
    {
        $wh = $this->webhook();
        $h = $wh->headers(self::BODY);
        $h['webhook-signature'] = 'v1,bm90LXZhbGlk v2,ignored ' . $h['webhook-signature'];
        self::assertIsArray($wh->verify(self::BODY, $h));
    }

    public function testKeyRotationAcceptsOldAndNewSecrets(): void
    {
        $new = Secret::generate();
        $signedWithOld = $this->webhook(self::SECRET)->headers(self::BODY);
        $signedWithNew = $this->webhook([$new, self::SECRET])->headers(self::BODY);

        $receiver = $this->webhook([$new, self::SECRET]);
        self::assertIsArray($receiver->verify(self::BODY, $signedWithOld));
        self::assertIsArray($receiver->verify(self::BODY, $signedWithNew));
    }

    public function testReplayIsRejectedOnlyAfterValidSignature(): void
    {
        $wh = $this->webhook(nonces: new InMemoryNonceStore(static fn (): int => self::NOW));
        $h = $wh->headers(self::BODY, 'msg_replay');

        // A forged request with the same id must not burn the id.
        $forged = ['webhook-signature' => 'v1,Zm9yZ2Vk'] + $h;
        $this->assertFailure(Failure::NO_MATCHING_SIGNATURE, fn () => $wh->verify(self::BODY, $forged));

        self::assertIsArray($wh->verify(self::BODY, $h));
        $this->assertFailure(Failure::REPLAYED, fn () => $wh->verify(self::BODY, $h));
    }

    public function testSecretValidationAndRedaction(): void
    {
        self::assertMatchesRegularExpression('/^whsec_[A-Za-z0-9+\/=]{44}$/', Secret::generate());
        self::assertStringNotContainsString('MfKQ', print_r(Secret::from(self::SECRET), true));

        $this->expectException(\InvalidArgumentException::class);
        Secret::from('too-short');
    }
}
