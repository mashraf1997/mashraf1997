<?php

declare(strict_types=1);

namespace MirrorOrg\HookShield\Tests;

use MirrorOrg\HookShield\Dispatcher;
use MirrorOrg\HookShield\RetryPolicy;
use MirrorOrg\HookShield\Store\InMemoryNonceStore;
use MirrorOrg\HookShield\Transport\Response;
use MirrorOrg\HookShield\Transport\Transport;
use MirrorOrg\HookShield\Webhook;
use PHPUnit\Framework\TestCase;

final class DispatcherTest extends TestCase
{
    private const SECRET = 'a-very-long-shared-secret-value';

    /** @param list<Response> $responses */
    private function transport(array $responses): Transport
    {
        return new class ($responses) implements Transport {
            /** @var list<array{url: string, headers: array<string, string>, body: string}> */
            public array $requests = [];

            public function __construct(private array $responses)
            {
            }

            public function post(string $url, array $headers, string $body): Response
            {
                $this->requests[] = compact('url', 'headers', 'body');
                return array_shift($this->responses) ?? new Response(500);
            }
        };
    }

    public function testRetriesUntilSuccessWithBackoff(): void
    {
        $transport = $this->transport([new Response(null, '', 'timeout'), new Response(503), new Response(200)]);
        $sleeps = [];
        $retry = new RetryPolicy(5, 100, 10_000, static fn (int $min, int $max): int => $max);
        $dispatcher = new Dispatcher(new Webhook(self::SECRET), $transport, $retry, function (int $ms) use (&$sleeps): void {
            $sleeps[] = $ms;
        });

        $delivery = $dispatcher->send('https://example.test/hooks', ['event' => 'مرحبا'], 'msg_fixed');

        self::assertTrue($delivery->successful());
        self::assertSame(3, $delivery->attemptCount());
        self::assertSame([100, 200], $sleeps);
        self::assertSame('{"event":"مرحبا"}', $transport->requests[0]['body']);
        foreach ($transport->requests as $request) {
            self::assertSame('msg_fixed', $request['headers']['webhook-id']);
            self::assertSame('application/json', $request['headers']['content-type']);
        }
    }

    public function testDeliveredRequestsVerifyOnTheReceiver(): void
    {
        $transport = $this->transport([new Response(204)]);
        (new Dispatcher(new Webhook(self::SECRET), $transport))->send('https://example.test', ['ok' => true]);

        $receiver = new Webhook(self::SECRET, nonces: new InMemoryNonceStore());
        $req = $transport->requests[0];
        self::assertSame(['ok' => true], $receiver->verify($req['body'], $req['headers']));
    }

    public function testDoesNotRetryClientErrors(): void
    {
        $transport = $this->transport([new Response(400), new Response(200)]);
        $delivery = (new Dispatcher(new Webhook(self::SECRET), $transport, sleep: static function (): void {
        }))->send('https://example.test', 'raw');

        self::assertFalse($delivery->successful());
        self::assertSame(1, $delivery->attemptCount());
        self::assertSame(400, $delivery->lastResponse()?->status);
    }

    public function testHonoursRetryAfterAndGivesUp(): void
    {
        $transport = $this->transport([new Response(429, '', null, 3), new Response(500)]);
        $sleeps = [];
        $retry = new RetryPolicy(2, 100, 60_000, static fn (): int => 0);
        $delivery = (new Dispatcher(new Webhook(self::SECRET), $transport, $retry, function (int $ms) use (&$sleeps): void {
            $sleeps[] = $ms;
        }))->send('https://example.test', 'x');

        self::assertFalse($delivery->successful());
        self::assertSame(2, $delivery->attemptCount());
        self::assertSame([3000], $sleeps);
    }

    public function testRetryPolicyCapsDelay(): void
    {
        $policy = new RetryPolicy(10, 1000, 5000, static fn (int $min, int $max): int => $max);
        self::assertSame(1000, $policy->delayMs(1));
        self::assertSame(4000, $policy->delayMs(3));
        self::assertSame(5000, $policy->delayMs(9));
        self::assertTrue($policy->isRetryable(null));
        self::assertTrue($policy->isRetryable(429));
        self::assertFalse($policy->isRetryable(404));
    }
}
