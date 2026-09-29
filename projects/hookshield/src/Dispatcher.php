<?php

declare(strict_types=1);

namespace MirrorOrg\HookShield;

use MirrorOrg\HookShield\Transport\CurlTransport;
use MirrorOrg\HookShield\Transport\Transport;

/**
 * Delivers signed webhooks with retries. Every attempt reuses the same
 * webhook-id so receivers can deduplicate, but is re-signed with a fresh
 * timestamp so it stays inside the receiver's tolerance window.
 */
final class Dispatcher
{
    private Transport $transport;

    /** @var \Closure(int): void */
    private \Closure $sleep;

    /** @param (\Closure(int): void)|null $sleep receives milliseconds (injectable for tests/queues) */
    public function __construct(
        private readonly Webhook $webhook,
        ?Transport $transport = null,
        private readonly RetryPolicy $retry = new RetryPolicy(),
        ?\Closure $sleep = null,
    ) {
        $this->transport = $transport ?? new CurlTransport();
        $this->sleep = $sleep ?? static function (int $ms): void {
            usleep($ms * 1000);
        };
    }

    /** @param array<mixed>|string $payload arrays are JSON-encoded */
    public function send(string $url, array|string $payload, ?string $id = null): Delivery
    {
        $body = is_string($payload)
            ? $payload
            : json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $id ??= 'msg_' . bin2hex(random_bytes(12));

        $attempts = [];
        for ($attempt = 1; $attempt <= $this->retry->maxAttempts; $attempt++) {
            $headers = $this->webhook->headers($body, $id) + ['content-type' => 'application/json'];
            $response = $this->transport->post($url, $headers, $body);
            $attempts[] = $response;

            if ($response->successful() || !$this->retry->isRetryable($response->status)) {
                break;
            }
            if ($attempt < $this->retry->maxAttempts) {
                $delay = $this->retry->delayMs($attempt);
                if ($response->retryAfterSeconds !== null) {
                    $delay = max($delay, min($response->retryAfterSeconds * 1000, $this->retry->maxDelayMs));
                }
                ($this->sleep)($delay);
            }
        }

        return new Delivery($id, $url, $attempts);
    }
}
