<?php

declare(strict_types=1);

namespace MirrorOrg\HookShield\Store;

use MirrorOrg\HookShield\NonceStore;

/**
 * Shared store for multi-server deployments. Works with phpredis (\Redis)
 * and Predis, using an atomic SET NX EX.
 */
final class RedisNonceStore implements NonceStore
{
    public function __construct(
        private readonly object $redis,
        private readonly string $prefix = 'hookshield:nonce:',
    ) {
    }

    public function add(string $id, int $ttlSeconds): bool
    {
        $key = $this->prefix . hash('sha256', $id);
        if ($this->redis instanceof \Redis) {
            return (bool) $this->redis->set($key, '1', ['nx', 'ex' => $ttlSeconds]);
        }
        // Predis and compatible clients: set(key, value, 'EX', ttl, 'NX')
        return (string) $this->redis->set($key, '1', 'EX', $ttlSeconds, 'NX') === 'OK';
    }
}
