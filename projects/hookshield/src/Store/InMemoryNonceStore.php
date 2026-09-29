<?php

declare(strict_types=1);

namespace MirrorOrg\HookShield\Store;

use MirrorOrg\HookShield\NonceStore;

/** Per-process store, suitable for tests and long-running workers. */
final class InMemoryNonceStore implements NonceStore
{
    /** @var array<string, int> id => expiry timestamp */
    private array $seen = [];

    /** @param (\Closure(): int)|null $clock */
    public function __construct(private readonly ?\Closure $clock = null)
    {
    }

    public function add(string $id, int $ttlSeconds): bool
    {
        $now = $this->clock ? ($this->clock)() : time();
        $this->seen = array_filter($this->seen, static fn (int $exp) => $exp > $now);
        if (isset($this->seen[$id])) {
            return false;
        }
        $this->seen[$id] = $now + $ttlSeconds;
        return true;
    }
}
