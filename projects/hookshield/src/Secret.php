<?php

declare(strict_types=1);

namespace MirrorOrg\HookShield;

/**
 * A signing secret. Accepts the Standard Webhooks "whsec_<base64>" format or a
 * raw string, and never leaks its value through var_dump() or string casts.
 */
final class Secret
{
    private const PREFIX = 'whsec_';

    private function __construct(private readonly string $key)
    {
        if (strlen($key) < 16) {
            throw new \InvalidArgumentException('Webhook secrets must be at least 16 bytes long.');
        }
    }

    public static function from(string $secret): self
    {
        if (str_starts_with($secret, self::PREFIX)) {
            $decoded = base64_decode(substr($secret, strlen(self::PREFIX)), true);
            if ($decoded === false) {
                throw new \InvalidArgumentException('Invalid base64 in whsec_ secret.');
            }
            return new self($decoded);
        }
        return new self($secret);
    }

    /** Generates a new random secret, returned in "whsec_" form for storage. */
    public static function generate(int $bytes = 32): string
    {
        return self::PREFIX . base64_encode(random_bytes(max(16, $bytes)));
    }

    public function sign(string $content): string
    {
        return base64_encode(hash_hmac('sha256', $content, $this->key, true));
    }

    public function __debugInfo(): array
    {
        return ['key' => '***'];
    }

    public function __serialize(): array
    {
        throw new \LogicException('Secrets must not be serialized.');
    }
}
