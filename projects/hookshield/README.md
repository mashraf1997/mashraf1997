# HookShield

**Sign, verify and reliably deliver webhooks in PHP.** HookShield implements the [Standard Webhooks](https://www.standardwebhooks.com/) signature scheme and adds key rotation, replay protection and retries with exponential backoff. It has no runtime dependencies and works with Laravel, Symfony, WordPress or plain PHP.

It grew out of the webhook infrastructure behind [Mersal](https://mersal.it/), our omnichannel messaging platform, where every inbound and outbound event has to be authentic, delivered exactly once, and survive flaky networks.

## Features

- **Standard Webhooks compatible.** It emits and verifies `webhook-id`, `webhook-timestamp` and `webhook-signature` headers, and is verified against the specification's reference test vector.
- **Constant-time verification** with `hash_equals`. It accepts multiple signatures per header.
- **Zero-downtime key rotation.** Sign with the newest secret and accept any configured secret.
- **Replay protection.** Timestamp tolerance plus a nonce store (in-memory or Redis). An ID is only recorded *after* its signature is proven, so forged requests can't burn legitimate IDs.
- **Reliable delivery.** Exponential backoff with full jitter, honoring `Retry-After`. It retries only on network errors, 408, 425, 429 and 5xx responses. Every attempt is re-signed with a fresh timestamp and keeps the same ID so receivers can deduplicate.
- **Safe by default.** Redirects aren't followed (a redirect could leak signed payloads), secrets are redacted from `var_dump` and can't be serialized, and each verification failure has a stable reason code.

## Install

The package is ready for Packagist as `mirrororg/hookshield`. Until it's published there, install it from this repository:

```bash
composer config repositories.hookshield path ../path/to/projects/hookshield
composer require mirrororg/hookshield:@dev
```

## Receiving webhooks

```php
use MirrorOrg\HookShield\Webhook;
use MirrorOrg\HookShield\WebhookVerificationException;

$webhook = new Webhook(getenv('WEBHOOK_SECRET'));   // "whsec_..." or a raw secret

try {
    $event = $webhook->verify(file_get_contents('php://input'), getallheaders());
} catch (WebhookVerificationException $e) {
    http_response_code(401);
    error_log("Rejected webhook: {$e->reason}");   // e.g. timestamp_too_old, no_matching_signature
    exit;
}
```

### Laravel middleware

```php
final class VerifyWebhook
{
    public function __construct(private Webhook $webhook) {}

    public function handle(Request $request, Closure $next)
    {
        try {
            $request->attributes->set('webhook', $this->webhook->verify($request->getContent(), $request->headers->all()));
        } catch (WebhookVerificationException $e) {
            abort(401, $e->reason);
        }
        return $next($request);
    }
}

// AppServiceProvider
$this->app->singleton(Webhook::class, fn () => new Webhook(
    secrets: [config('services.hooks.secret'), config('services.hooks.previous_secret')],
    tolerance: 300,
    nonces: new RedisNonceStore(Redis::connection()->client()),
));
```

## Sending webhooks

```php
use MirrorOrg\HookShield\{Dispatcher, RetryPolicy, Secret, Webhook};

$secret = Secret::generate();   // store it and share it with the receiver once

$dispatcher = new Dispatcher(
    new Webhook($secret),
    retry: new RetryPolicy(maxAttempts: 5, baseDelayMs: 500, maxDelayMs: 30_000),
);

$delivery = $dispatcher->send('https://customer.example/hooks', [
    'type' => 'message.delivered',
    'data' => ['id' => 'wamid.123', 'channel' => 'whatsapp'],
]);

$delivery->successful();          // bool
$delivery->attemptCount();        // e.g. 3
$delivery->lastResponse()?->status;
```

In queued jobs, pass a `sleep` closure that re-dispatches the job with a delay instead of blocking the worker. You can also implement `Transport` to send through Guzzle, Symfony HttpClient or Laravel's HTTP client.

## Verification failure reasons

| Reason | Meaning |
| :--- | :--- |
| `missing_headers` | One of the three `webhook-*` headers is absent |
| `invalid_timestamp` | `webhook-timestamp` isn't an integer |
| `timestamp_too_old` / `timestamp_in_future` | Outside the tolerance window (default ±300 s) |
| `no_matching_signature` | The payload was altered or signed with an unknown secret |
| `replayed` | The `webhook-id` has already been processed |

## Development

```bash
composer install
composer test
```

## License

MIT
