<?php

declare(strict_types=1);

namespace MirrorOrg\HookShield;

use MirrorOrg\HookShield\WebhookVerificationException as Failure;

/**
 * Signs and verifies webhooks using the Standard Webhooks scheme
 * (https://www.standardwebhooks.com):
 *
 *   webhook-id:        msg_2b7f…
 *   webhook-timestamp: 1767225600
 *   webhook-signature: v1,<base64 HMAC-SHA256 of "{id}.{timestamp}.{body}">
 *
 * Multiple secrets may be supplied to rotate keys without downtime: the first
 * signs, all of them are accepted when verifying.
 */
final class Webhook
{
    public const HEADER_ID = 'webhook-id';
    public const HEADER_TIMESTAMP = 'webhook-timestamp';
    public const HEADER_SIGNATURE = 'webhook-signature';

    /** @var list<Secret> */
    private array $secrets;

    /** @var \Closure(): int */
    private \Closure $clock;

    /**
     * @param string|Secret|array<string|Secret> $secrets
     * @param int $tolerance maximum age (and clock skew) in seconds
     * @param (\Closure(): int)|null $clock
     */
    public function __construct(
        string|Secret|array $secrets,
        private readonly int $tolerance = 300,
        private readonly ?NonceStore $nonces = null,
        ?\Closure $clock = null,
    ) {
        $list = is_array($secrets) ? array_values($secrets) : [$secrets];
        if ($list === []) {
            throw new \InvalidArgumentException('At least one secret is required.');
        }
        $this->secrets = array_map(
            static fn (string|Secret $s) => $s instanceof Secret ? $s : Secret::from($s),
            $list,
        );
        $this->clock = $clock ?? static fn (): int => time();
    }

    public function sign(string $id, int $timestamp, string $payload): string
    {
        return 'v1,' . $this->secrets[0]->sign("{$id}.{$timestamp}.{$payload}");
    }

    /**
     * Builds the headers for an outgoing delivery.
     *
     * @return array{webhook-id: string, webhook-timestamp: string, webhook-signature: string}
     */
    public function headers(string $payload, ?string $id = null, ?int $timestamp = null): array
    {
        $id ??= 'msg_' . bin2hex(random_bytes(12));
        $timestamp ??= ($this->clock)();
        return [
            self::HEADER_ID => $id,
            self::HEADER_TIMESTAMP => (string) $timestamp,
            self::HEADER_SIGNATURE => $this->sign($id, $timestamp, $payload),
        ];
    }

    /**
     * Verifies an incoming webhook and returns its decoded JSON body.
     * Header names are matched case-insensitively; values may be arrays
     * (as returned by PSR-7 getHeaders() or Laravel's $request->headers->all()).
     *
     * @param array<string, string|list<string>> $headers
     * @throws WebhookVerificationException
     */
    public function verify(string $payload, array $headers): mixed
    {
        $h = self::normalizeHeaders($headers);
        $id = $h[self::HEADER_ID] ?? '';
        $ts = $h[self::HEADER_TIMESTAMP] ?? '';
        $sigHeader = $h[self::HEADER_SIGNATURE] ?? '';
        if ($id === '' || $ts === '' || $sigHeader === '') {
            throw new Failure(Failure::MISSING_HEADERS, 'Missing webhook-id, webhook-timestamp or webhook-signature header.');
        }
        if (!ctype_digit($ts)) {
            throw new Failure(Failure::INVALID_TIMESTAMP, 'webhook-timestamp must be a Unix timestamp.');
        }

        $timestamp = (int) $ts;
        $now = ($this->clock)();
        if ($timestamp < $now - $this->tolerance) {
            throw new Failure(Failure::TIMESTAMP_TOO_OLD, 'Webhook timestamp is outside the tolerance window.');
        }
        if ($timestamp > $now + $this->tolerance) {
            throw new Failure(Failure::TIMESTAMP_IN_FUTURE, 'Webhook timestamp is too far in the future.');
        }

        $content = "{$id}.{$timestamp}.{$payload}";
        $candidates = [];
        foreach (preg_split('/\s+/', trim($sigHeader)) ?: [] as $entry) {
            [$version, $sig] = array_pad(explode(',', $entry, 2), 2, '');
            if ($version === 'v1' && $sig !== '') {
                $candidates[] = $sig;
            }
        }

        $valid = false;
        foreach ($this->secrets as $secret) {
            $expected = $secret->sign($content);
            foreach ($candidates as $candidate) {
                // Compare every candidate in constant time; never short-circuit on content.
                $valid = hash_equals($expected, $candidate) || $valid;
            }
        }
        if (!$valid) {
            throw new Failure(Failure::NO_MATCHING_SIGNATURE, 'No webhook signature matched.');
        }

        // Only record the id after the signature is proven, so forged requests
        // cannot burn legitimate message ids.
        if ($this->nonces !== null && !$this->nonces->add($id, 2 * $this->tolerance)) {
            throw new Failure(Failure::REPLAYED, "Webhook {$id} was already processed.");
        }

        return $payload === '' ? null : json_decode($payload, true, 512, JSON_THROW_ON_ERROR);
    }

    /**
     * @param array<string, string|list<string>> $headers
     * @return array<string, string>
     */
    private static function normalizeHeaders(array $headers): array
    {
        $out = [];
        foreach ($headers as $name => $value) {
            $out[strtolower((string) $name)] = is_array($value) ? implode(' ', $value) : (string) $value;
        }
        return $out;
    }
}
